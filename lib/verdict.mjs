// 모의매매 판정 — 스코어카드 에피소드(메인 픽 전부, 자금 제약 없음)로 11-05 판정을 낸다.
// 장부는 표본이 작아(10-19: 진입일 10일, 필요 약 257일) 판정 대신 실체결 비용 보정과 무작위 대조에 쓴다.
// 설계: docs/superpowers/specs/2026-10-19-paper-verdict-design.md. 판정 규칙은 결과를 보기 전에 정한 것이다(바꾸지 말 것).
import { clusteredT } from './perf-metrics.mjs'
import { baselineReturn } from './market-baseline.mjs'
import { utcDay } from './datetime.mjs'
import { scoreStrategyOutcome } from './strategy.mjs'

export const VERDICT = {
  FROM: '2026-10-08T00:00:00Z', // 신호 정리(10-07~08) 뒤 픽만 — 그 전은 다른 스캐너다
  T: 2, MIN_DAYS: 5, MIN_EFFECT: 0.005,
  HOLD_WAIT_DAYS: 8, // 7일 보유 + 마지막 일봉 확정(다음 날)
  // 비용 하한 = 기본 왕복 0.3%. 실체결 차이(장부 − 일봉 채점)는 비용 말고도 시간봉/일봉 판정 순서 차이가 섞여 거래당 수 %씩
  // 흔들린다(10-19: 21건 평균 +1.76%, t 1.14). 운 좋은 측정값이 비용을 기본보다 낮추지 못하게 한다(10-19 독립 리뷰).
  DEFAULT_COST: 0.003, MIN_COST: 0.003, MIN_PAIRS: 10,
}
const EXIT_DONE = ['sl', 'tp', 'time']
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// 에피소드 → 진입일별 행. v = 규칙 수익 − 같은 보유 구간 시장 수익 − 비용. 기준선이 없으면 dropped로 센다.
// 결과가 다 나온 진입일만 쓴다: 손절은 빨리 끝나고 기한 청산은 7일 뒤라, 그날 에피소드 중 하나라도 진행 중(open)이면
// 이미 끝난 것은 손절 쪽으로 치우친다(10-19 독립 리뷰: 전체 −2.08% vs 결과가 다 나온 날만 −0.79%). 그런 날은 통째로 빼고
// running으로 센다. 청산 채점이 없는 에피소드(exit 없음)와 최종 상태 no-data는 날을 막지 않는다.
export function ruleRows(episodes, daily, { from = VERDICT.FROM, to = null, cost = VERDICT.DEFAULT_COST } = {}) {
  const inRange = (episodes ?? []).filter((e) => e && !e.lowLiquidity && e.entryTs && e.entryTs >= from && !(to && e.entryTs >= to))
  const openDays = new Set(inRange.filter((e) => e.exit?.reason === 'open').map((e) => utcDay(e.entryTs)))
  const rows = []
  let dropped = 0, running = 0
  for (const e of inRange) {
    const d0 = utcDay(e.entryTs)
    if (openDays.has(d0)) { running++; continue }
    const x = e.exit
    if (!x || !EXIT_DONE.includes(x.reason) || !Number.isFinite(x.ret) || !Number.isFinite(x.exitDay)) continue
    const m = baselineReturn(daily, d0, x.exitDay)
    if (m == null) { dropped++; continue }
    rows.push({ day: d0, v: x.ret - m - cost, score: e.score ?? 0 })
  }
  return { rows, dropped, running }
}

// 진입일 목록의 가운데 날 기준 전반/후반(가운데 날은 후반) — paper-report와 같은 방식.
function halves(rows) {
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b)
  if (days.length < 2) return { first: null, second: null }
  const mid = days[Math.floor(days.length / 2)]
  return {
    first: clusteredT(rows.filter((r) => r.day < mid)).mean,
    second: clusteredT(rows.filter((r) => r.day >= mid)).mean,
  }
}

// 점수 오름차순 3등분 — 하위 k개·상위 k개(k = floor(n/3)), 나머지는 중간. 구간별 진입일 평균.
function terciles(rows) {
  const s = [...rows].sort((a, b) => a.score - b.score)
  const k = Math.floor(s.length / 3)
  if (k < 1) return { low: null, mid: null, high: null, lowDays: 0, highDays: 0 }
  const low = clusteredT(s.slice(0, k)), high = clusteredT(s.slice(-k)), mid = clusteredT(s.slice(k, s.length - k))
  return { low: low.mean, mid: mid.mean, high: high.mean, lowDays: low.days, highDays: high.days }
}

// 3단 판정(사전 등록): pass = t ≥ 2 · 전후반 양 · 점수 상위 > 하위 / fail = t ≤ −2 / 그 밖 inconclusive.
export function decide(rows) {
  const list = rows ?? []
  const c = clusteredT(list)
  const h = halves(list)
  const tr = terciles(list)
  const reasons = []
  let verdict = 'inconclusive'
  if (c.days < VERDICT.MIN_DAYS) reasons.push(`표본 부족(진입일 ${c.days}일 < ${VERDICT.MIN_DAYS})`)
  else if (c.t != null && c.t <= -VERDICT.T) { verdict = 'fail'; reasons.push(`t ${c.t.toFixed(2)} ≤ −${VERDICT.T}`) }
  else if (c.t != null && c.t >= VERDICT.T) {
    const halvesOk = h.first > 0 && h.second > 0
    const scoreOk = tr.lowDays >= 2 && tr.highDays >= 2 && tr.high > tr.low
    if (!halvesOk) reasons.push('전반·후반 중 음(−)인 구간이 있음')
    if (!scoreOk) reasons.push('점수 상위 1/3이 하위 1/3보다 낫지 않음')
    if (halvesOk && scoreOk) { verdict = 'pass'; reasons.push(`t ${c.t.toFixed(2)} ≥ ${VERDICT.T}, 전·후반 양(+), 점수 상위 > 하위`) }
  } else reasons.push(`|t| < ${VERDICT.T}`)
  return { verdict, reasons, mean: c.mean, t: c.t, days: c.days, n: list.length, halves: h, terciles: tr }
}

// 검정력: 진입일 평균의 표준편차로 |t|=2에 필요한 진입일 수와 판정 가능 예상일(UTC 일 인덱스).
// 효과 크기는 지금 평균의 절댓값, 단 0.5%보다 작으면 0.5%(0 근처에서 필요 표본이 무한대로 튀지 않게).
export function power(rows) {
  const byDay = new Map()
  for (const r of rows ?? []) {
    if (!Number.isFinite(r.v)) continue
    const b = byDay.get(r.day) ?? []
    b.push(r.v)
    byDay.set(r.day, b)
  }
  const dm = [...byDay.values()].map(mean)
  if (dm.length < 2) return { sd: null, need: null, etaDay: null, days: dm.length }
  const mu = mean(dm)
  const sd = Math.sqrt(dm.reduce((a, b) => a + (b - mu) ** 2, 0) / (dm.length - 1))
  const delta = Math.max(Math.abs(mu), VERDICT.MIN_EFFECT)
  const need = Math.ceil((2 * sd / delta) ** 2)
  const first = Math.min(...byDay.keys())
  return { sd, need, etaDay: first + need + VERDICT.HOLD_WAIT_DAYS, days: dm.length }
}

// 장부 거래를 스코어카드 방식(스캔가 진입, 일봉, 손절 우선)으로 다시 채점한 결과. 손절·익절 %는 거래 자신의 것
// (체결가 대비 비율 — exitRule이 스캔가 비율을 체결가에 옮긴 것이라 스캔가에 되돌려도 같다). 미확정·스캔가 없음은 null.
// 에피소드와 직접 짝짓지 않는 이유: 에피소드는 매수 목록에 '처음 등장한 스캔'에만 생기고, 장부는 목록에 남아 있던
// 종목을 나중 스캔에서 사므로 짝이 거의 안 맞는다(10-19 실측 0/22).
export function idealExit(trade, confirmed, nowMs) {
  if (!(trade?.scanPrice > 0) || !(trade.entryPrice > 0)) return null
  const params = {
    slPct: (1 - trade.stopLoss / trade.entryPrice) * 100,
    tpPct: (trade.takeProfit / trade.entryPrice - 1) * 100,
    holdMax: trade.holdMax,
  }
  if (![params.slPct, params.tpPct, params.holdMax].every(Number.isFinite)) return null
  const r = scoreStrategyOutcome({ entryTs: new Date(trade.scanAt).toISOString(), entryPrice: trade.scanPrice }, confirmed, params, nowMs)
  return EXIT_DONE.includes(r.reason) && Number.isFinite(r.ret) ? { reason: r.reason, ret: r.ret } : null
}

// 실체결 차이: pairs = [{ trade(장부 청산 거래), ideal(idealExit의 ret) }].
// gap = 장부 순수익(수수료·스프레드·손절 슬리피지·시간봉 판정·진입 지연) − 일봉 채점 원수익. 음수면 일봉 근사가 낙관적.
export function fillGap(pairs) {
  const rows = []
  for (const { trade: t, ideal } of pairs ?? []) {
    if (!Number.isFinite(ideal) || !Number.isFinite(t?.net)) continue
    rows.push({ day: Math.floor(t.scanAt / 86400_000), v: t.net - ideal, model: t.fillModel ?? 1 })
  }
  const c = clusteredT(rows)
  const byModel = {}
  for (const r of rows) { const b = (byModel[r.model] ||= { n: 0, sum: 0 }); b.n++; b.sum += r.v }
  for (const b of Object.values(byModel)) { b.mean = b.sum / b.n; delete b.sum }
  return { n: rows.length, mean: mean(rows.map((r) => r.v)), t: c.t, days: c.days, byModel }
}

// 판정 비용: 현재 체결 모델 짝이 충분하면 측정한 실체결 차이, 단 기본 왕복 0.3%보다 낮게 잡지 않는다(MIN_COST 주석). 아니면 0.3%.
export function costFrom(gap) {
  if (!gap || gap.n < VERDICT.MIN_PAIRS || !Number.isFinite(gap.mean)) return { cost: VERDICT.DEFAULT_COST, source: 'default' }
  return { cost: Math.max(-gap.mean, VERDICT.MIN_COST), source: 'measured' }
}

// 무작위 대조(보조 지표): 같은 스캔에서 메인·무작위가 모두 청산한 경우만, 스캔별 (메인 평균 − 무작위 평균)을 진입일로 묶는다.
// open = 두 장부의 보유 포지션 — 그 스캔 보유가 하나라도 남았으면 그 스캔은 뺀다. 일찍 끝나는 건 익절·손절 터치뿐이라
// 결과가 덜 나온 스캔을 넣으면 극단값만 섞인다(판정 표본의 "결과가 다 나온 진입일만"과 같은 원칙, 10-23 독립 리뷰).
export function vsRandom(mainClosed, randomClosed, { open = [] } = {}) {
  const running = new Set((open ?? []).map((p) => p.scanAt))
  const group = (list) => {
    const m = new Map()
    for (const c of list ?? []) {
      if (!Number.isFinite(c.net)) continue
      const b = m.get(c.scanAt) ?? []
      b.push(c.net)
      m.set(c.scanAt, b)
    }
    return m
  }
  const a = group(mainClosed), b = group(randomClosed)
  const rows = []
  for (const [scanAt, nets] of a) if (b.has(scanAt) && !running.has(scanAt)) rows.push({ day: Math.floor(scanAt / 86400_000), v: mean(nets) - mean(b.get(scanAt)) })
  const c = clusteredT(rows)
  return { scans: rows.length, mean: c.mean, t: c.t, days: c.days }
}
