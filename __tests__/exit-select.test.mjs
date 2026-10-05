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
  const cell = (slPct, tpPct, holdMax, meanRet, winRate = 0.5, n = 500) =>
    ({ params: { slPct, tpPct, holdMax }, summary: { n, winRate, meanRet, medianRet: meanRet } })
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
  it('혼자 튀는 봉우리는 불안정 → 안정성 비율 최대 셀로 교체', () => {
    const cells = [
      cell(7, 8, 3, 1.00),                                   // 봉우리(이웃 대비 과도)
      cell(5, 8, 3, 0.01), cell(10, 8, 3, 0.01),
      cell(7, 12, 3, 0.01), cell(7, 8, 5, 0.01),
      cell(5, 12, 3, 0.05), cell(5, 12, 5, 0.05), cell(10, 12, 3, 0.05), // 완만한 고원
    ]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.best.params).toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
    // stability는 chosen을 서술한다. 거부된 봉우리의 불안정은 bestStability로 노출된다.
    expect(r.bestStability.stable).toBe(false)
    expect(r.chosen.params).not.toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
    expect(r.stability.stable).toBe(true) // 교체된 셀은 안정해야 교체할 이유가 있다
  })
  it('기준선을 못 이기면 passesGate=false', () => {
    const cells = [cell(7, 8, 3, 0.01), cell(5, 8, 3, 0.009), cell(10, 8, 3, 0.009), cell(7, 12, 3, 0.009), cell(7, 8, 5, 0.009)]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.passesGate).toBe(false)
    expect(r.reason).toBe('below-baseline')
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
})
