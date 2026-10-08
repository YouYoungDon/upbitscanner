// 성과 리스크 지표 — 순수 함수. gs-quant econometrics(max_drawdown·sharpe) 수식 참조.
// 수익 배열(number[])만 입력. 곡선 생성은 buildScorecard가 담당.
import { utcDay } from './datetime.mjs'

// 누적곱 자산곡선. curve[i] = ∏(1+r₀..rᵢ). 빈 배열 → [].
export function equityCurve(returns) {
  const out = []
  let eq = 1
  for (const r of returns) { eq *= 1 + r; out.push(eq) }
  return out
}

// 러닝 피크 대비 최대 하락률. mdd ≤ 0. 빈 배열 → {mdd:null,...}.
export function maxDrawdown(returns) {
  const curve = equityCurve(returns)
  if (!curve.length) return { mdd: null, peakIdx: -1, troughIdx: -1 }
  let peak = curve[0], peakIdx = 0, mdd = 0, resPeak = 0, resTrough = 0
  for (let i = 0; i < curve.length; i++) {
    if (curve[i] > peak) { peak = curve[i]; peakIdx = i }
    const dd = curve[i] / peak - 1
    if (dd < mdd) { mdd = dd; resPeak = peakIdx; resTrough = i }
  }
  return { mdd, peakIdx: resPeak, troughIdx: resTrough }
}

// 평균/표본표준편차(n-1). per-trade(연율화 안 함). n<2 또는 std≈0 → null.
// 비유한값(NaN/Infinity)은 걸러내 한 점 오염이 전체를 NaN으로 만들지 않게 함.
export function sharpe(returns, { riskFree = 0 } = {}) {
  const clean = returns.filter(Number.isFinite)
  const n = clean.length
  if (n < 2) return null
  const excess = clean.map((r) => r - riskFree)
  const mean = excess.reduce((a, b) => a + b, 0) / n
  const variance = excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  const std = Math.sqrt(variance)
  if (std < 1e-12) return null
  return mean / std
}

// 청산된(sl/tp/time) 에피소드의 실현수익을 진입일순 정렬. 비유한 ret는 제외.
export function strategyReturns(episodes) {
  return (episodes ?? [])
    .filter((e) => {
      const o = e.strategyOutcome
      return o && (o.reason === 'sl' || o.reason === 'tp' || o.reason === 'time') && Number.isFinite(o.ret)
    })
    .sort((a, b) => String(a.entryTs).localeCompare(String(b.entryTs)))
    .map((e) => e.strategyOutcome.ret)
}

// ret{horizon} 채점된 픽을 진입일(UTC day)별 그룹→일평균, day 오름차순. 비유한 ret는 제외.
export function dailyPortfolioReturns(episodes, horizon = 1) {
  const byDay = new Map()
  for (const e of episodes ?? []) {
    const ret = e[`ret${horizon}`]
    if (!Number.isFinite(ret)) continue
    const day = utcDay(e.entryTs)
    if (!Number.isFinite(day)) continue
    const bucket = byDay.get(day) ?? []
    bucket.push(ret)
    byDay.set(day, bucket)
  }
  return [...byDay.keys()]
    .sort((a, b) => a - b)
    .map((day) => {
      const b = byDay.get(day)
      return b.reduce((x, y) => x + y, 0) / b.length
    })
}

// 수익 배열 → {mdd, sharpe, n}. 곡선 생성 후 두 지표를 한 번에.
export function riskMetrics(returns) {
  const n = returns.length
  return { mdd: maxDrawdown(returns).mdd, sharpe: sharpe(returns), n }
}

// 진입일 군집 평균·t. 같은 날 신호는 서로 독립이 아니므로(시장 전체가 같이 움직인다)
// 하루 평균 하나로 묶고, 날짜 단위 표본으로 t를 낸다. rows: [{day, v}].
// 날짜 2개 미만 또는 분산 0 → t=null.
export function clusteredT(rows) {
  const byDay = new Map()
  for (const { day, v } of rows ?? []) {
    if (!Number.isFinite(v)) continue
    const b = byDay.get(day) ?? []
    b.push(v)
    byDay.set(day, b)
  }
  const dm = [...byDay.values()].map((b) => b.reduce((a, x) => a + x, 0) / b.length)
  const days = dm.length
  if (!days) return { mean: null, t: null, days: 0 }
  const mean = dm.reduce((a, b) => a + b, 0) / days
  if (days < 2) return { mean, t: null, days }
  const sd = Math.sqrt(dm.reduce((a, b) => a + (b - mean) ** 2, 0) / (days - 1))
  return { mean, t: sd < 1e-12 ? null : mean / (sd / Math.sqrt(days)), days }
}

// 전략 실현수익을 포트폴리오 기준으로. 보유가 최대 holdMax일 겹치므로 거래마다 전액을
// 순차 복리하면(strategyReturns) 낙폭이 부풀려진다. 실측 최대 동시 보유 수(slots)로 자금을
// 균등 분할했다고 보고, 거래 수익의 1/slots를 청산일 순서로 적용한다.
export function strategyPortfolio(episodes) {
  const trades = (episodes ?? [])
    .map((e) => ({ o: e.strategyOutcome, d0: utcDay(e.entryTs) }))
    .filter(({ o, d0 }) => o && ['sl', 'tp', 'time'].includes(o.reason) &&
      Number.isFinite(o.ret) && Number.isFinite(o.exitDay) && Number.isFinite(d0))
    .map(({ o, d0 }) => ({ start: d0, end: d0 + o.exitDay, ret: o.ret }))
  if (!trades.length) return { returns: [], slots: 0 }
  const delta = new Map()
  for (const t of trades) {
    delta.set(t.start, (delta.get(t.start) ?? 0) + 1)
    delta.set(t.end + 1, (delta.get(t.end + 1) ?? 0) - 1)
  }
  let open = 0, slots = 0
  for (const d of [...delta.keys()].sort((a, b) => a - b)) { open += delta.get(d); slots = Math.max(slots, open) }
  const returns = trades.sort((a, b) => a.end - b.end || a.start - b.start).map((t) => t.ret / slots)
  return { returns, slots }
}
