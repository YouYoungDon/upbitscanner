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
