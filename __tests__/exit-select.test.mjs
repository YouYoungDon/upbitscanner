import { describe, it, expect } from 'vitest'
import {
  summarizeTrades, cellKey, neighborsOf, pickBest,
  overextensionTable, applyPreRegisteredRule,
} from '../lib/exit-select.mjs'

describe('summarizeTrades', () => {
  it('승률·평균·중앙값·사유분포를 계산 (ret는 분수)', () => {
    const s = summarizeTrades([
      { ret: 0.10, reason: 'tp' }, { ret: -0.05, reason: 'sl' },
      { ret: 0.02, reason: 'time' }, { ret: -0.01, reason: 'time' },
    ])
    expect(s.n).toBe(4)
    expect(s.winRate).toBeCloseTo(0.5)
    expect(s.meanRet).toBeCloseTo(0.015)
    expect(s.medianRet).toBeCloseTo(0.005) // (-0.01 + 0.02)/2
    expect(s.reasons).toEqual({ tp: 1, sl: 1, time: 2 })
  })
  it('홀수 개수의 중앙값', () => {
    expect(summarizeTrades([{ ret: -0.1, reason: 'sl' }, { ret: 0.2, reason: 'tp' }, { ret: 0.05, reason: 'tp' }]).medianRet).toBeCloseTo(0.05)
  })
  it('비유효 거래(null/NaN)는 제외', () => {
    const s = summarizeTrades([{ ret: 0.1, reason: 'tp' }, { ret: null, reason: 'no-data' }, null, { ret: NaN, reason: 'x' }])
    expect(s.n).toBe(1)
  })
  it('빈 입력이면 n=0, 지표는 null', () => {
    const s = summarizeTrades([])
    expect(s).toEqual({ n: 0, winRate: null, meanRet: null, medianRet: null, reasons: {} })
  })
})

describe('neighborsOf', () => {
  const axes = { slPct: [5, 7, 10], tpPct: [8, 12], holdMax: [3, 5, 7] }
  it('각 축 ±1단계, 범위 밖은 제외', () => {
    const n = neighborsOf({ slPct: 7, tpPct: 8, holdMax: 5 }, axes)
    expect(n.map(cellKey).sort()).toEqual(['10/8/5', '5/8/5', '7/12/5', '7/8/3', '7/8/7'].sort())
  })
  it('모서리 셀은 이웃이 적다', () => {
    expect(neighborsOf({ slPct: 5, tpPct: 8, holdMax: 3 }, axes)).toHaveLength(3)
  })
})

describe('pickBest', () => {
  const axes = { slPct: [5, 7, 10], tpPct: [8, 12], holdMax: [3, 5] }
  const cell = (slPct, tpPct, holdMax, meanRet, winRate = 0.5, n = 500, medianRet = meanRet) =>
    ({ params: { slPct, tpPct, holdMax }, summary: { n, winRate, meanRet, medianRet } })
  const baseline = { meanRet: 0.024, medianRet: 0.0 }

  it('minTrades 미달 셀은 후보에서 제외', () => {
    const cells = [cell(5, 8, 3, 0.20, 0.6, 10), cell(7, 8, 3, 0.05)]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.chosen.params.slPct).toBe(7)
  })
  it('후보가 전혀 없으면 passesGate=false', () => {
    const r = pickBest([cell(5, 8, 3, 0.2, 0.6, 10)], axes, { minTrades: 200, baseline })
    expect(r.chosen).toBeNull()
    expect(r.passesGate).toBe(false)
    expect(r.reason).toBe('no-eligible-cells')
  })
  it('이웃이 받쳐주면 최적 셀 채택 (stable)', () => {
    const cells = [
      cell(7, 8, 3, 0.10), cell(5, 8, 3, 0.09), cell(10, 8, 3, 0.08),
      cell(7, 12, 3, 0.09), cell(7, 8, 5, 0.08),
    ]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.chosen.params).toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
    expect(r.stability.stable).toBe(true)
    expect(r.passesGate).toBe(true)
  })
  it('혼자 튀는 봉우리는 불안정 → 충분히 뒷받침되는 셀로 교체', () => {
    const wideAxes = { slPct: [5, 7, 10, 12], tpPct: [8, 12, 18], holdMax: [3, 5, 7] }
    const cells = [
      cell(7, 8, 3, 1.00),                                              // 봉우리(best)
      cell(5, 8, 3, 0.01), cell(10, 8, 3, 0.01),                        // 봉우리의 이웃 4개 = 전부 낮음
      cell(7, 12, 3, 0.01), cell(7, 8, 5, 0.01),
      cell(10, 18, 5, 0.06),                                            // 완만한 고원 중심
      cell(7, 18, 5, 0.06), cell(12, 18, 5, 0.06), cell(10, 12, 5, 0.06),
      cell(10, 18, 3, 0.06), cell(10, 18, 7, 0.06),                     // 고원 중심의 이웃 5개
    ]
    const r = pickBest(cells, wideAxes, { minTrades: 200, baseline })
    expect(r.best.params).toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
    expect(r.bestStability.stable).toBe(false)
    expect(r.bestStability.nbrCount).toBe(4)
    // 고원 중심만 이웃 2개 이상 + 비율 충족 → 결정적으로 선택된다
    expect(r.chosen.params).toEqual({ slPct: 10, tpPct: 18, holdMax: 5 })
    expect(r.stability.stable).toBe(true)
    expect(r.stability.nbrCount).toBe(5)
  })
  it('이웃이 1개뿐인 셀은 비율이 높아도 교체 후보가 되지 않는다', () => {
    const cells = [
      cell(7, 8, 3, 1.00),                                    // 봉우리(best, 불안정)
      cell(5, 8, 3, 0.01), cell(10, 8, 3, 0.01),
      cell(7, 12, 3, 0.01), cell(7, 8, 5, 0.01),
      cell(10, 12, 5, 0.025),                                 // 기준선 통과, 이웃은 1개뿐인데 비율은 0.8로 높음
      cell(10, 12, 3, 0.02),                                  // 위 셀의 유일한 이웃(기준선 미달이라 경쟁 후보는 아님)
    ]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    // (10,12,5)는 비율만 보면 가장 안정적이지만 이웃이 1개뿐이라 교체 후보에서 제외되고,
    // 다른 교체 후보가 없어 불안정한 봉우리가 그대로 유지된다.
    expect(r.chosen.params).not.toEqual({ slPct: 10, tpPct: 12, holdMax: 5 })
    expect(r.chosen.params).toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
  })
  it('기준선을 못 이기면 passesGate=false', () => {
    const cells = [cell(7, 8, 3, 0.01), cell(5, 8, 3, 0.009), cell(10, 8, 3, 0.009), cell(7, 12, 3, 0.009), cell(7, 8, 5, 0.009)]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.passesGate).toBe(false)
    expect(r.reason).toBe('below-baseline')
  })
  it('평균 1위 셀이 중앙값 다리에서 떨어져도, 두 다리를 모두 통과하는 다른 셀을 찾아 채택한다', () => {
    const cells = [
      cell(7, 8, 3, 0.05, 0.5, 500, -0.01),   // 평균 1위지만 중앙값 실패(-0.01 < baseline.medianRet 0.0)
      cell(10, 12, 5, 0.03, 0.5, 500, 0.01),  // 평균은 낮지만 두 다리 모두 통과
    ]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.chosen.params).toEqual({ slPct: 10, tpPct: 12, holdMax: 5 })
    expect(r.passesGate).toBe(true)
  })
})

describe('overextensionTable', () => {
  const rows = [
    { runUpPct: 10, fwd7: 0.05 }, { runUpPct: 25, fwd7: -0.02 },
    { runUpPct: 35, fwd7: -0.10 }, { runUpPct: 45, fwd7: -0.12 },
  ]
  it('임계 초과분만 집계', () => {
    const t = overextensionTable(rows, [20, 40])
    expect(t[0]).toMatchObject({ threshold: 20, n: 3 })
    expect(t[1]).toMatchObject({ threshold: 40, n: 1 })
    expect(t[0].winRate).toBe(0)
  })
  it('해당 없으면 n=0, 지표 null', () => {
    expect(overextensionTable(rows, [100])[0]).toEqual({ threshold: 100, n: 0, winRate: null, medianRet: null })
  })
})

describe('applyPreRegisteredRule', () => {
  const opts = { tier1MedMax: -0.01, tier1MinN: 60, tier2MedMax: -0.08, tier2MinN: 30 }
  it('조건을 만족하는 가장 작은 임계를 고른다 (argmax 아님)', () => {
    const table = [
      { threshold: 20, n: 159, winRate: 0.43, medianRet: -0.015 },
      { threshold: 30, n: 75, winRate: 0.35, medianRet: -0.062 },
      { threshold: 35, n: 59, winRate: 0.32, medianRet: -0.082 },
      { threshold: 50, n: 26, winRate: 0.19, medianRet: -0.137 },
    ]
    const r = applyPreRegisteredRule(table, opts)
    expect(r.tier1Pct).toBe(20)
    expect(r.tier2Pct).toBe(35) // 50은 n=26 < 30 이라 탈락
    expect(r.monotonic).toBe(true)
  })
  it('n 미달이면 그 임계는 선택되지 않는다', () => {
    const table = [{ threshold: 20, n: 10, winRate: 0.4, medianRet: -0.05 }]
    expect(applyPreRegisteredRule(table, opts).tier1Pct).toBeNull()
  })
  it('승률이 중간에 오르면 monotonic=false', () => {
    const table = [
      { threshold: 20, n: 100, winRate: 0.40, medianRet: -0.02 },
      { threshold: 30, n: 80, winRate: 0.48, medianRet: -0.03 },
    ]
    expect(applyPreRegisteredRule(table, opts).monotonic).toBe(false)
  })
  it('단조성 불성립이면 임계값을 반환하지 않는다 (스펙 §3.1 하드 스톱)', () => {
    // 두 임계 모두 중앙값·n 조건을 만족하지만 승률이 중간에 올라 단조성이 깨진다.
    // monotonic을 확인하지 않고 tier*Pct만 읽는 소비자가 거부된 값을 배선하지 못하게 한다.
    const table = [
      { threshold: 20, n: 159, winRate: 0.40, medianRet: -0.09 },
      { threshold: 30, n: 80, winRate: 0.48, medianRet: -0.12 },
    ]
    const r = applyPreRegisteredRule(table, opts)
    expect(r.monotonic).toBe(false)
    expect(r.tier1Pct).toBeNull()
    expect(r.tier2Pct).toBeNull()
  })
})
