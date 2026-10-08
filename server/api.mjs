import { topSignalsOfScan, bestHitRateSignal, isActiveSignal, MIN_STAT_SAMPLES } from '../lib/insights.mjs'
import { summarizeScans } from '../lib/archive.mjs'
import { aggregateRecommendations } from '../lib/recommend.mjs'
import { sharpe, riskMetrics, dailyPortfolioReturns, clusteredT, strategyPortfolio } from '../lib/perf-metrics.mjs'
import { ROUND_TRIP_COST } from '../lib/costs.mjs'
import { utcDay } from '../lib/datetime.mjs'
import { summarizeTrades } from '../lib/exit-select.mjs'

// 일간(24h)/주간(7일) 누적 추천 — 아카이브 전체를 윈도우로 집계 (최신 스캔 아님).
// 어떤 집계 실패에도 빈 배열 폴백 — 대시보드 무중단.
export function buildRecommendations(scans, now = Date.now()) {
  try {
    const top = (windowMs) => aggregateRecommendations(scans || [], { windowMs, now }).slice(0, 8)
    return { daily: top(86400000), weekly: top(7 * 86400000), totalScans: (scans || []).length }
  } catch {
    return { daily: [], weekly: [], totalScans: (scans || []).length }
  }
}

// 매수 종목 신호 태그에서 콤보/MTF 종목 수 집계
export function comboDistribution(buyList = []) {
  const has = (item, kw) => (item.signals || []).some((s) => s.includes(kw))
  let rebound = 0, trap = 0, volume = 0, mtf = 0
  for (const item of buyList) {
    if (has(item, '반등확인')) rebound++
    if (has(item, '과매도 함정')) trap++
    if (has(item, '거래량확인')) volume++
    if (has(item, '[MTF]')) mtf++
  }
  return { rebound, trap, volume, mtf }
}

// 캔들 강세/약세형 종목 수 + 대표 패턴 (라벨 '캔들 강세형 (망치형,...)'에서 추출)
export function candleSummary(scan = {}) {
  const names = (signals, key) => {
    const label = (signals || []).find((s) => s.startsWith(key))
    if (!label) return []
    const m = label.match(/\(([^)]*)\)/)
    return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : []
  }
  let bullishCount = 0, bearishCount = 0
  const bullCounts = {}, bearCounts = {}
  for (const item of scan.buy || []) {
    const ns = names(item.signals, '캔들 강세형')
    if (ns.length) bullishCount++
    for (const n of ns) bullCounts[n] = (bullCounts[n] || 0) + 1
  }
  for (const item of scan.sell || []) {
    const ns = names(item.signals, '캔들 약세형')
    if (ns.length) bearishCount++
    for (const n of ns) bearCounts[n] = (bearCounts[n] || 0) + 1
  }
  const top = (counts) => Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3)
  return { bullishCount, bearishCount, topBullish: top(bullCounts), topBearish: top(bearCounts) }
}

// 최근 스캔별 매수/매도 개수 추이
export function buildHistory(log, limit = 14) {
  const scans = (log?.scans || []).slice(-limit)
  return scans.map((s) => ({ timestamp: s.timestamp, buyCount: (s.buy || []).length, sellCount: (s.sell || []).length }))
}

export function buildResults(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { buyCount: 0, sellCount: 0, totalScans: log?.totalScans || 0 }, buy: [], buyLowLiq: [], sell: [], comboDist: { rebound: 0, trap: 0, volume: 0, mtf: 0 }, candleSummary: { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] } }
  const buyAll = scan.buy || []
  const buyMain = buyAll.filter((b) => !b.lowLiquidity)
  const buyLowLiq = buyAll.filter((b) => b.lowLiquidity)
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { buyCount: buyAll.length, sellCount: scan.sell.length, totalScans: log.totalScans || 0 },
    buy: buyMain,
    buyLowLiq,
    sell: scan.sell,
    comboDist: comboDistribution(buyAll),
    candleSummary: candleSummary(scan),
    regime: scan.regime || null,
    kimchi: scan.kimchi ?? null,
    funding: scan.funding ?? null,
    cgCoverage: scan.cgCoverage ?? null,
    cgReason: scan.cgReason ?? null,
    cgFetchedAt: scan.cgFetchedAt ?? null,
  }
}

// 모멘텀 스캔 최신 결과 (추세지속 추천)
export function buildMomentum(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { count: 0, totalScans: log?.totalScans || 0 }, picks: [] }
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { count: (scan.picks || []).length, totalScans: log.totalScans || 0 },
    picks: scan.picks || [],
    chase: scan.chase || [], // 당일 과열로 매수 목록에서 뺀 종목(추격주의)
  }
}

export function buildInsights(log, weekly) {
  const scan = log?.scans?.at(-1)
  const topSignal = scan ? (topSignalsOfScan(scan)[0] || null) : null
  const stats = weekly?.weeks?.at(-1)?.signalStats || {}
  return { topSignal, bestHitRate: bestHitRateSignal(stats) }
}

// 아카이브 스캔(시간 오름차순)을 최신순 요약으로, limit/offset 적용
export function buildScans(scans, { limit = 20, offset = 0 } = {}) {
  const summaries = summarizeScans(scans).slice().reverse() // 최신순
  return { total: summaries.length, items: summaries.slice(offset, offset + limit) }
}

export function findScanByTimestamp(scans, ts) {
  return scans.find((s) => s.timestamp === ts) || null
}

// 자금유입 스캔 최신 결과
export function buildFlow(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { strong: 0, attention: 0, watch: 0, totalScans: log?.totalScans || 0 }, picks: [], btc: null }
  const kpi = { strong: 0, attention: 0, watch: 0, totalScans: log.totalScans || 0 }
  for (const p of scan.picks || []) if (kpi[p.level] != null) kpi[p.level]++
  return { empty: false, timestamp: scan.timestamp, btc: scan.btc || null, kpi, picks: scan.picks || [] }
}

// 신호 통계에 제거됨(removed)·표본 부족(lowSample) 표시를 붙인다. 주간 요약 TOP·가중치 변화에서는
// 제거된 신호를 뺀다 — 지운 신호가 "적중률 97%"로 1위에 오르면 스코어카드(시장 대비)와 정반대로 읽힌다.
export function buildVerify(weekly, weights) {
  const latest = weekly?.weeks?.at(-1) || {}
  const signalStats = Object.fromEntries(Object.entries(latest.signalStats ?? {}).map(([k, s]) =>
    [k, { ...s, removed: !isActiveSignal(k), lowSample: (s.count ?? 0) < MIN_STAT_SAMPLES }]))
  const active = (list) => (list ?? []).filter((x) => isActiveSignal(x.key))
  const report = latest.report ? {
    ...latest.report,
    ...(latest.report.topBuySignals ? { topBuySignals: active(latest.report.topBuySignals) } : {}),
    ...(latest.report.topSellSignals ? { topSellSignals: active(latest.report.topSellSignals) } : {}),
    ...(latest.report.weightChanges ? { weightChanges: active(latest.report.weightChanges) } : {}),
  } : null
  return {
    overallHitRate: latest.overallHitRate ?? null,
    sideStats: latest.sideStats ?? null,
    timedHitRates: latest.timedHitRates ?? null,
    signalStats,
    minSamples: MIN_STAT_SAMPLES,
    weights: weights || {},
    report,
    momentum: latest.momentum ?? null,
    horizonMode: latest.horizonMode ?? 'current-price-mixed',
    history: (weekly?.weeks || []).map((w) => ({ timestamp: w.timestamp, overallHitRate: w.overallHitRate, horizonMode: w.horizonMode ?? 'current-price-mixed' })),
  }
}

// 픽 성과 스코어카드 집계. sc = { updatedAt, episodes } (data/scorecard.json).
const SCORECARD_CUTOVER = Date.parse('2026-07-12T15:00:00Z') // 확정봉 체제 KST 2026-07-13 00:00

// 청산 성과(ep.exit) — 소급(backfill)과 라이브 확정(live)을 절대 합산하지 않는다.
// backfill은 규칙 도입 전 픽에 현재 설정값을 소급 적용해 계산한 참고치일 뿐, 실현 성과가 아니다.
// 'open'·'no-data'는 미확정이므로 summarizeTrades가 ret 비유한수(non-finite)로 걸러낸다.
//
// 규칙 수치는 **반드시 비교 기준선과 함께** 내보낸다(스펙 §3.3.2·§8.5). 규칙 행만 보여주면
// 읽는 사람이 그것을 엣지로 받아들이는데, 실측에서 규칙은 평균을 7일단순보유에 내주고 있다.
// 기준선 hold7 = "청산규칙 없이 7일 종가 보유"(e.ret7).
//
// 동일 집합 원칙: exit.ret과 ret7이 **둘 다** 유한한 에피소드만 양쪽에 넣는다. 한쪽에만
// 있는 에피소드를 허용하면 규칙 n과 기준선 n이 어긋나(실측 1603 vs 1557) 비교 자체가
// §3.3.2가 요구하는 "같은 에피소드 집합"이 아니게 된다.
function exitStatsOf(eps) {
  // 적용된 파라미터를 집계에 동봉한다 — buildScorecard는 scorecard.json만 받으므로
  // exit-config.json을 읽을 수 없고, 대시보드 제목을 하드코딩하면 재선정 시 낡는다.
  // 여러 세대가 섞이면(라이브 스탬프는 재채점하지 않으므로 가능) mixed로 드러낸다.
  const paramsOf = (rows) => {
    const seen = new Map()
    for (const e of rows) {
      const { slPct, tpPct, holdMax } = e.exit
      if (![slPct, tpPct, holdMax].every((v) => Number.isFinite(v))) continue
      seen.set(`${slPct}/${tpPct}/${holdMax}`, { slPct, tpPct, holdMax })
    }
    const vals = [...seen.values()]
    return vals.length ? { ...vals.at(-1), mixed: vals.length > 1 } : null
  }
  const pick = (src) => {
    const rows = eps.filter((e) => e.exit?.cfgSource === src &&
      Number.isFinite(e.exit?.ret) && Number.isFinite(e.ret7))
    return {
      ...summarizeTrades(rows.map((e) => ({ ret: e.exit.ret, reason: e.exit.reason }))),
      params: paramsOf(rows),
      hold7: summarizeTrades(rows.map((e) => ({ ret: e.ret7, reason: 'hold7' }))),
    }
  }
  return { live: pick('live'), backfill: pick('backfill') }
}

// 코인별 묶음 — 에피소드 표가 날짜순으로 수천 줄이 되어 코인당 한 줄로 요약한다(최근 진입순).
// 평균은 채점된 지평선만, 승률은 비용(ROUND_TRIP_COST) 차감 기준, exc3은 시장 대비 초과 평균.
function coinsOf(eps) {
  const by = new Map()
  for (const e of eps) {
    const l = by.get(e.market) ?? []
    l.push(e)
    by.set(e.market, l)
  }
  const avgOf = (l, k) => {
    const v = l.map((e) => e[k]).filter(Number.isFinite)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  return [...by.values()].map((l) => {
    l.sort((a, b) => String(a.entryTs).localeCompare(String(b.entryTs)))
    const last = l.at(-1)
    const s3 = l.filter((e) => Number.isFinite(e.ret3))
    return {
      market: last.market, korean_name: last.korean_name, lowLiquidity: !!last.lowLiquidity,
      picks: l.length, lastEntry: last.entryTs,
      pending: l.filter((e) => e.status === 'pending' || e.status === 'partial').length,
      avg1: avgOf(l, 'ret1'), avg3: avgOf(l, 'ret3'), avg7: avgOf(l, 'ret7'),
      win3Net: s3.length ? s3.filter((e) => e.ret3 > ROUND_TRIP_COST).length / s3.length : null,
      exc3: avgOf(l, 'exc3'),
    }
  }).sort((a, b) => String(b.lastEntry).localeCompare(String(a.lastEntry)))
}

export function buildScorecard(sc) {
  const eps = sc?.episodes ?? []
  if (!eps.length) return { empty: true }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const agg = (list) => {
    const out = {}
    for (const n of [1, 3, 7]) {
      const scored = list.filter((e) => e[`ret${n}`] != null)
      // 시장 대비 초과(exc): 같은 날 픽은 하루 하나로 묶은 평균과 t — 픽 단위 평균은 신호가 몰린 날에 휘둘린다.
      const withExc = list.filter((e) => Number.isFinite(e[`exc${n}`]))
      const ex = clusteredT(withExc.map((e) => ({ day: utcDay(e.entryTs), v: e[`exc${n}`] })))
      const avgRet = avg(scored.map((e) => e[`ret${n}`]))
      out[`h${n}`] = {
        n: scored.length,
        winRate: scored.length ? scored.filter((e) => e[`ret${n}`] > 0).length / scored.length : null,
        // 비용 차감: 왕복 수수료·슬리피지(ROUND_TRIP_COST)를 넘어야 실제로 남는 거래다
        winRateNet: scored.length ? scored.filter((e) => e[`ret${n}`] > ROUND_TRIP_COST).length / scored.length : null,
        avgRet,
        avgNet: avgRet == null ? null : avgRet - ROUND_TRIP_COST,
        excN: withExc.length, excMean: ex.mean, excT: ex.t, excDays: ex.days,
        avgMfe: avg(scored.map((e) => e[`mfe${n}`]).filter((v) => v != null)),
        sharpe: sharpe(scored.map((e) => e[`ret${n}`])), // per-trade 분포 샤프
      }
    }
    return out
  }
  // 🎯전략(조용한바닥) 픽의 규칙 기준 성적 (SL/TP/시간청산 — scoreStrategyOutcome 채점분). 단일 순회 집계.
  const st = { n: 0, sl: 0, tp: 0, time: 0, open: 0, noData: 0 }
  let stWins = 0, stRetSum = 0, stResolved = 0
  for (const e of eps) {
    const o = e.strategyOutcome
    if (!o) continue
    st.n++
    if (o.reason === 'no-data') st.noData++
    else if (st[o.reason] != null) st[o.reason]++
    if (o.reason === 'sl' || o.reason === 'tp' || o.reason === 'time') {
      stResolved++
      stRetSum += o.ret
      if (o.ret > 0) stWins++
    }
  }
  const strategy = st.n ? {
    ...st,
    winRate: stResolved ? stWins / stResolved : null,
    avgRet: stResolved ? stRetSum / stResolved : null,
  } : null
  // 리스크 곡선: 스코어카드=+1일 비중첩 일별포트폴리오. 전략=실현 청산을 최대 동시 보유 슬롯으로
  // 자금 분할한 포트폴리오(최대 7일 보유가 겹치므로 거래마다 전액 복리하면 낙폭이 부풀려진다).
  const sp = strategyPortfolio(eps)
  const risk = {
    scorecard: riskMetrics(dailyPortfolioReturns(eps, 1)),
    strategy: { ...riskMetrics(sp.returns), slots: sp.slots },
  }
  return {
    updatedAt: sc.updatedAt ?? null,
    total: eps.length,
    cost: ROUND_TRIP_COST,
    pendingCount: eps.filter((e) => e.status === 'pending' || e.status === 'partial').length,
    noDataCount: eps.filter((e) => e.status === 'no-data').length,
    strategy,
    risk,
    exitStats: exitStatsOf(eps),
    horizons: agg(eps),
    regimes: {
      pre: agg(eps.filter((e) => Date.parse(e.entryTs) < SCORECARD_CUTOVER)),
      post: agg(eps.filter((e) => Date.parse(e.entryTs) >= SCORECARD_CUTOVER)),
    },
    // 진입가 기준별(2026-10-07~ 현재가 'live' vs 이전 확정 종가). 두 세대의 수익률은 의미가 달라 따로 본다.
    byBasis: {
      live: agg(eps.filter((e) => e.entryBasis === 'live')),
      confirmed: agg(eps.filter((e) => e.entryBasis !== 'live')),
    },
    coins: coinsOf(eps),
    episodes: [...eps].sort((a, b) => String(b.entryTs).localeCompare(String(a.entryTs))),
  }
}
