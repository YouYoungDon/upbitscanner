import { describe, it, expect } from 'vitest'
import {
  equityCurve, maxDrawdown, sharpe, strategyReturns, dailyPortfolioReturns,
} from '../lib/perf-metrics.mjs'

describe('equityCurve', () => {
  it('누적곱 자산곡선', () => {
    const c = equityCurve([0.1, -0.2, 0.05])
    expect(c[0]).toBeCloseTo(1.1, 10)
    expect(c[1]).toBeCloseTo(0.88, 10)
    expect(c[2]).toBeCloseTo(0.924, 10)
  })
  it('빈 배열 → 빈 곡선', () => {
    expect(equityCurve([])).toEqual([])
  })
})

describe('maxDrawdown', () => {
  it('러닝 피크 대비 최대 하락률', () => {
    const r = maxDrawdown([0.1, -0.2, 0.05])
    expect(r.mdd).toBeCloseTo(-0.2, 10) // 0.88/1.1 - 1
    expect(r.peakIdx).toBe(0)
    expect(r.troughIdx).toBe(1)
  })
  it('단조 상승 → 낙폭 0', () => {
    expect(maxDrawdown([0.1, 0.1, 0.1]).mdd).toBeCloseTo(0, 10)
  })
  it('빈 배열 → null', () => {
    expect(maxDrawdown([])).toEqual({ mdd: null, peakIdx: -1, troughIdx: -1 })
  })
})

describe('sharpe', () => {
  it('평균/표본표준편차 (per-trade)', () => {
    expect(sharpe([0.1, -0.2, 0.05])).toBeCloseTo(-0.103696, 5)
  })
  it('riskFree 차감', () => {
    // 모든 수익이 0.02 상수 offset이면 std 0이라 별도 케이스로 검증 대신
    // riskFree가 평균을 낮추는지만 확인
    const base = sharpe([0.1, -0.05, 0.08])
    const rf = sharpe([0.1, -0.05, 0.08], { riskFree: 0.02 })
    expect(rf).toBeLessThan(base)
  })
  it('n<2 → null', () => {
    expect(sharpe([0.05])).toBeNull()
    expect(sharpe([])).toBeNull()
  })
  it('표준편차 0 → null', () => {
    expect(sharpe([0.03, 0.03, 0.03])).toBeNull()
  })
})

describe('strategyReturns', () => {
  const ep = (ts, reason, ret) => ({ entryTs: ts, strategyOutcome: reason ? { reason, ret } : undefined })
  it('청산된 매매만 진입일순 정렬', () => {
    const eps = [
      ep('2026-08-03T00:00:00Z', 'tp', 0.18),
      ep('2026-08-01T00:00:00Z', 'sl', -0.1),
      ep('2026-08-02T00:00:00Z', 'time', 0.03),
      ep('2026-08-04T00:00:00Z', 'open', null),   // 진행 중 → 제외
      ep('2026-08-05T00:00:00Z', 'no-data', null), // → 제외
      ep('2026-08-06T00:00:00Z', null, null),       // outcome 없음 → 제외
    ]
    expect(strategyReturns(eps)).toEqual([-0.1, 0.03, 0.18])
  })
  it('빈 입력 → 빈 배열', () => {
    expect(strategyReturns([])).toEqual([])
  })
})

describe('dailyPortfolioReturns', () => {
  const ep = (ts, ret1) => ({ entryTs: ts, ret1 })
  it('진입일별 그룹→일평균, day 오름차순', () => {
    const eps = [
      ep('2026-08-02T01:00:00Z', 0.10),
      ep('2026-08-01T05:00:00Z', 0.20),
      ep('2026-08-02T09:00:00Z', 0.30), // 같은 날 → 평균 (0.1+0.3)/2 = 0.2
      ep('2026-08-01T23:00:00Z', 0.00), // 같은 날 → 평균 (0.2+0.0)/2 = 0.1
    ]
    expect(dailyPortfolioReturns(eps, 1)).toEqual([0.1, 0.2])
  })
  it('채점 안 된(ret null) 픽 제외', () => {
    const eps = [ep('2026-08-01T00:00:00Z', null), ep('2026-08-01T00:00:00Z', 0.05)]
    expect(dailyPortfolioReturns(eps, 1)).toEqual([0.05])
  })
  it('빈 입력 → 빈 배열', () => {
    expect(dailyPortfolioReturns([], 1)).toEqual([])
  })
})
