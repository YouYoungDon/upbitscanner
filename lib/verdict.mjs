// 모의매매 판정 — 스코어카드 에피소드(메인 픽 전부, 자금 제약 없음)로 11-05 판정을 낸다.
// 장부는 표본이 작아(10-19: 진입일 10일, 필요 약 257일) 판정 대신 실체결 비용 보정과 무작위 대조에 쓴다.
// 설계: docs/superpowers/specs/2026-10-19-paper-verdict-design.md. 판정 규칙은 결과를 보기 전에 정한 것이다(바꾸지 말 것).
import { clusteredT } from './perf-metrics.mjs'
import { baselineReturn } from './market-baseline.mjs'
import { utcDay } from './datetime.mjs'

export const VERDICT = {
  FROM: '2026-10-08T00:00:00Z', // 신호 정리(10-07~08) 뒤 픽만 — 그 전은 다른 스캐너다
  T: 2, MIN_DAYS: 5, MIN_EFFECT: 0.005, HOLD_WAIT_DAYS: 7,
  DEFAULT_COST: 0.003, MIN_COST: 0.001, MIN_PAIRS: 10,
}
const EXIT_DONE = ['sl', 'tp', 'time']
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// 에피소드 → 진입일별 행. v = 규칙 수익 − 같은 보유 구간 시장 수익 − 비용. 기준선이 없으면 dropped로 센다.
export function ruleRows(episodes, daily, { from = VERDICT.FROM, to = null, cost = VERDICT.DEFAULT_COST } = {}) {
  const rows = []
  let dropped = 0
  for (const e of episodes ?? []) {
    if (!e || e.lowLiquidity || !e.entryTs) continue
    if (e.entryTs < from || (to && e.entryTs >= to)) continue
    const x = e.exit
    if (!x || !EXIT_DONE.includes(x.reason) || !Number.isFinite(x.ret) || !Number.isFinite(x.exitDay)) continue
    const d0 = utcDay(e.entryTs)
    const m = baselineReturn(daily, d0, x.exitDay)
    if (m == null) { dropped++; continue }
    rows.push({ day: d0, v: x.ret - m - cost, score: e.score ?? 0 })
  }
  return { rows, dropped }
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

// 실체결 차이: 메인 장부 청산 거래 ↔ 같은 market·같은 스캔(scanAt = 에피소드 entryTs)의 스코어카드 결과.
// gap = 장부 순수익(수수료·스프레드·손절 슬리피지·시간봉 판정) − 에피소드 일봉 원수익. 음수면 일봉 근사가 낙관적.
export function fillGap(trades, episodes) {
  const byKey = new Map()
  for (const e of episodes ?? []) {
    const x = e?.exit
    if (!x || !EXIT_DONE.includes(x.reason) || !Number.isFinite(x.ret)) continue
    byKey.set(`${e.market}@${Date.parse(e.entryTs)}`, x.ret)
  }
  const rows = []
  for (const t of trades ?? []) {
    const r = byKey.get(`${t.market}@${t.scanAt}`)
    if (r == null || !Number.isFinite(t.net)) continue
    rows.push({ day: Math.floor(t.scanAt / 86400_000), v: t.net - r, model: t.fillModel ?? 1 })
  }
  const c = clusteredT(rows)
  const byModel = {}
  for (const r of rows) { const b = (byModel[r.model] ||= { n: 0, sum: 0 }); b.n++; b.sum += r.v }
  for (const b of Object.values(byModel)) { b.mean = b.sum / b.n; delete b.sum }
  return { n: rows.length, mean: mean(rows.map((r) => r.v)), t: c.t, days: c.days, byModel }
}

// 판정 비용: 짝이 충분하면 측정한 실체결 차이(수수료 0.05%×2보다 낮게 잡지 않음), 아니면 기존 원칙의 왕복 0.3%.
export function costFrom(gap) {
  if (!gap || gap.n < VERDICT.MIN_PAIRS || !Number.isFinite(gap.mean)) return { cost: VERDICT.DEFAULT_COST, source: 'default' }
  return { cost: Math.max(-gap.mean, VERDICT.MIN_COST), source: 'measured' }
}

// 무작위 대조(보조 지표): 같은 스캔에서 메인·무작위가 모두 청산한 경우만, 스캔별 (메인 평균 − 무작위 평균)을 진입일로 묶는다.
export function vsRandom(mainClosed, randomClosed) {
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
  for (const [scanAt, nets] of a) if (b.has(scanAt)) rows.push({ day: Math.floor(scanAt / 86400_000), v: mean(nets) - mean(b.get(scanAt)) })
  const c = clusteredT(rows)
  return { scans: rows.length, mean: c.mean, t: c.t, days: c.days }
}
