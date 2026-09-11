// 거래소 이벤트 방어 스크린 — 공식 공지 제목을 분류해 매수 점수 감점/제외(방어).
// 업비트=주 소스, 바이낸스=보조. 소폰(-86%) 마이그레이션 재발 방지. 최종 판단은 사용자.

import { readJson, writeJson, withLock } from './store.mjs'
import { fetchBinanceAnnouncements } from './binance.mjs'

const DAY_MS = 86400000

// 규칙 순서 중요: 상폐(최강) → 재개/해제(중단/유의보다 먼저) → 유의 → 입출금중단 → 신규상장.
// "유의 종목 지정 해제"가 "유의 종목 지정"보다, "입출금 재개"가 "입출금 중단"보다 먼저 매칭돼야 한다.
export const EVENT_RULES = [
  { type: 'delist',  severity: 'critical', mult: 0,   ttlDays: 90, re: /거래지원\s*종료|상장\s*폐지|디지털\s*자산.*폐지|will\s+delist|delisting/i },
  { type: 'resume',  severity: 'clear',    mult: 1,   ttlDays: 0,  re: /입출금\s*(지원)?\s*재개|거래\s*재개|유의\s*종목\s*지정\s*해제|모니터링\s*(태그)?\s*해제/i },
  { type: 'caution', severity: 'high',     mult: 0.5, ttlDays: 30, re: /유의\s*종목\s*지정|유의\s*촉구|monitoring\s*tag|투자\s*유의/i },
  { type: 'halt',    severity: 'mid',      mult: 0.7, ttlDays: 14, re: /입출금\s*(일시)?\s*중단|네트워크\s*전환|마이그레이션|토큰\s*스왑|migration|token\s*swap/i },
  { type: 'listing', severity: 'neutral',  mult: 1,   ttlDays: 0,  re: /신규\s*거래지원|추가\s*거래지원|will\s+list|seed\s*tag/i },
]

// 제목 → { type, severity, mult, ttlDays } | null. 첫 매칭 규칙 채택.
export function classifyAnnouncement(title) {
  if (typeof title !== 'string') return null
  for (const r of EVENT_RULES) {
    if (r.re.test(title)) return { type: r.type, severity: r.severity, mult: r.mult, ttlDays: r.ttlDays }
  }
  return null
}

// 마켓 표기용 기준통화 코드 — 괄호 안에서 "(BTC 마켓)"·"(KRW, USDT)"처럼 마켓 지정으로 쓰이므로
// 상폐/중단 "대상"이 아니다(업비트가 이들 메가캡을 상폐할 일도 없다). 괄호 티커 오탐 방지로 제외.
const QUOTE_CODES = new Set(['KRW', 'BTC', 'ETH', 'BNB', 'USDT', 'USDC', 'USD'])

// 제목의 괄호 안 대문자 티커 추출: "소폰(SOPH)" → ['SOPH']. 마켓표기 "(KRW, BTC 마켓)"은 미매칭.
// 단독 기준통화 괄호 "(BTC)"·"(KRW)"는 마켓 지정이므로 제외(예: KRW-BTC 헛감점 방지).
export function parseTickers(title) {
  if (typeof title !== 'string') return []
  const out = []
  const re = /\(([A-Z0-9]{2,10})\)/g
  let m
  while ((m = re.exec(title))) { if (!QUOTE_CODES.has(m[1])) out.push(m[1]) }
  return [...new Set(out)]
}

// 티커 → 유니버스에 존재하는 KRW- 마켓만.
export function matchMarkets(tickers, universeSet) {
  const out = []
  for (const t of tickers || []) { const m = `KRW-${t}`; if (universeSet.has(m)) out.push(m) }
  return out
}

const TYPE_KO = { delist: '상폐', caution: '유의지정', halt: '입출금중단' }
const EX_KO = { upbit: '업비트', binance: '바이낸스' }

// 재개/해제 공지가 실제로 해제하는 이벤트 "종류"만 반환. 입출금·거래 재개→halt, 유의/모니터링 해제→caution.
// delist(상폐)는 재개로 되돌지 않으며, 재개는 무관한 다른 종류(예: 유의지정)를 건드리면 안 된다.
export function resumeClears(title) {
  const s = new Set()
  if (/입출금\s*(지원)?\s*재개|거래\s*재개/.test(title)) s.add('halt')
  if (/유의\s*종목\s*지정\s*해제|모니터링\s*(태그)?\s*해제/.test(title)) s.add('caution')
  return s
}

// 종목의 활성 이벤트들 → 가장 강한(min mult) 배수 + 표시 라벨.
export function eventRiskMult(events) {
  if (!events || !events.length) return { mult: 1, label: null }
  let worst = events[0]
  for (const e of events) if (e.mult < worst.mult) worst = e
  const label = `⚠️거래소이벤트(${TYPE_KO[worst.type] || worst.type}·${EX_KO[worst.exchange] || worst.exchange})`
  return { mult: worst.mult, label }
}

// 업비트 공지 API(api-manager) — 최근 pages 페이지. 실패 시 null(부분 성공은 있는 만큼 반환).
export async function fetchUpbitAnnouncements({ pages = 2, timeoutMs = 8000 } = {}) {
  try {
    const out = []
    for (let p = 1; p <= pages; p++) {
      const r = await fetch(`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=30&category=all`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) return out.length ? out : null
      const d = await r.json()
      for (const n of d?.data?.notices || []) out.push({ id: `upbit:${n.id}`, title: n.title, ts: n.first_listed_at || n.listed_at || null })
    }
    return out
  } catch { return null }
}

// 스캐너 진입점. 어떤 실패에도 스캔 불사침. markets: 스캔 유니버스. positions: 보유(유니버스 밖도 알림).
export async function ensureEvents(markets, { now = Date.now(), positions = [], deps = {} } = {}) {
  const d = { fetchUpbitAnnouncements, fetchBinanceAnnouncements, readJson, writeJson, withLock, ...deps }
  const neutral = (reason) => ({ byMarket: {}, newEvents: [], coverage: 0, reason })
  try {
    const universe = new Set([...(markets || []), ...positions.map((p) => p.market)])
    const [up, bn] = await Promise.all([
      Promise.resolve().then(() => d.fetchUpbitAnnouncements()).catch(() => null),
      Promise.resolve().then(() => d.fetchBinanceAnnouncements()).catch(() => null),
    ])
    // 둘 다 실패해도 조기 반환하지 않는다 — 이미 저장된 active(halt/caution/delist)가
    // 이번 스캔에서 통째로 사라지면 방어가 무력화된다(소폰 재발 방지 취지 위반).
    // 대신 lock 안에서 저장 상태를 읽어 만료만 청소하고 그걸로 byMarket을 구성한다.
    const fetchFailed = !up && !bn
    const raw = [
      ...(up || []).map((a) => ({ ...a, exchange: 'upbit' })),
      ...(bn || []).map((a) => ({ ...a, exchange: 'binance' })),
    ]
    const classified = []
    for (const a of raw) {
      const c = classifyAnnouncement(a.title)
      if (!c) continue
      const mkts = matchMarkets(parseTickers(a.title), universe)
      if (!mkts.length) continue
      classified.push({ srcId: a.id, exchange: a.exchange, title: a.title, ts: a.ts, ...c, markets: mkts })
    }
    return await d.withLock('event-log', async () => {
      const state = await d.readJson('event-log.json', { seenIds: {}, active: {} })
      const seenIds = state.seenIds || {}
      const active = state.active || {}
      // 만료 청소
      for (const m of Object.keys(active)) {
        active[m] = (active[m] || []).filter((e) => !e.expiresAt || Date.parse(e.expiresAt) > now)
        if (!active[m].length) delete active[m]
      }
      const newEvents = []
      // classified를 ts 오름차순 정렬 — 한 스캔 안에서 오래된 이벤트부터 적용해 최신 이벤트가
      // 마지막에 반영되도록 결정적 순서를 보장한다. ts null/파싱불가는 가장 오래된 것으로 취급.
      // (단계적 마이그레이션에서 오래된 resume가 같은 스캔의 새 halt를 지워버리는 사고 방지 — final-review fix)
      const effTs = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) ? t : -Infinity }
      const sortedClassified = [...classified].sort((a, b) => effTs(a.ts) - effTs(b.ts))
      for (const c of sortedClassified) {
        const isNew = !(c.srcId in seenIds)
        for (const m of c.markets) {
          if (c.type === 'resume') {
            // 재개가 실제로 해제하는 "종류"(halt/caution)만, 그리고 그 종류 중에서도 ts가 확실히
            // (finite) resume 이하인 것만 지운다. 보존 대상:
            //   ① 다른 종류(입출금 재개가 무관한 유의지정을 지우면 안 됨) ② delist(재개로 안 풀림)
            //   ③ ts 불명(null, 예: 바이낸스) — 순서 판단 불가하므로 만료(TTL)로만 정리(방어 우선)
            //   ④ resume보다 나중(ts 더 큰) 이벤트(단계적 마이그레이션의 새 halt)
            // resume.ts가 불명이면 무엇을 지울 근거가 없으므로 전체 건너뜀.
            const resumeTs = effTs(c.ts)
            const arr = active[m]
            if (arr && resumeTs !== -Infinity) {
              const clears = resumeClears(c.title)
              const kept = arr.filter((e) => {
                const ets = effTs(e.ts)
                return !(clears.has(e.type) && ets !== -Infinity && ets <= resumeTs)
              })
              if (kept.length) active[m] = kept
              else delete active[m]
            }
          }
          else if (c.type === 'listing') { /* 방어 무관 */ }
          else {
            const ev = { type: c.type, severity: c.severity, mult: c.mult, exchange: c.exchange, srcId: c.srcId, ts: c.ts, expiresAt: new Date(now + c.ttlDays * DAY_MS).toISOString() }
            const arr = active[m] || (active[m] = [])
            if (!arr.some((e) => e.srcId === ev.srcId)) arr.push(ev)
          }
        }
        if (isNew) {
          seenIds[c.srcId] = c.ts || new Date(now).toISOString()
          if (c.type !== 'listing') newEvents.push({ srcId: c.srcId, exchange: c.exchange, type: c.type, title: c.title, ts: c.ts, markets: c.markets })
        }
      }
      // seenIds 90일 초과분 청소(무한 증가 방지)
      for (const [k, v] of Object.entries(seenIds)) { const t = Date.parse(v); if (Number.isFinite(t) && now - t > 90 * DAY_MS) delete seenIds[k] }
      await d.writeJson('event-log.json', { seenIds, active })
      const byMarket = {}
      for (const m of universe) { const evs = active[m]; if (evs && evs.length) byMarket[m] = { ...eventRiskMult(evs), events: evs } }
      // 분모는 universe(스캔마켓 ∪ 보유포지션) — byMarket이 universe로 구성되므로 분자와 일치(1.0 초과 방지).
      const coverage = universe.size ? +(Object.keys(byMarket).length / universe.size).toFixed(2) : 0
      // fetch 실패(둘 다) 여도 저장된 방어는 그대로 반환하되, 신규 조회가 없었음을 reason으로 남긴다(관측용).
      return fetchFailed ? { byMarket, newEvents, coverage, reason: 'fetch-fail' } : { byMarket, newEvents, coverage }
    })
  } catch { return neutral('error') }
}
