import { describe, it, expect } from 'vitest'
import { judgeHit, aggregateHitRates, updateWeights, buildWeeklyReport, aggregateReturns } from '../lib/weekly.mjs'

describe('aggregateReturns', () => {
  it('신호별 평균 수익률(%) 집계', () => {
    const records = [
      { signals: ['RSI 과매도 (10)'], ret: 10 },
      { signals: ['RSI 과매도 (12)'], ret: 4 },
      { signals: ['EMA 하락배열'], ret: -2 },
    ]
    const r = aggregateReturns(records)
    expect(r['RSI 과매도']).toBe(7)      // (10+4)/2
    expect(r['EMA 하락배열']).toBe(-2)
  })
  it('ret 없으면 제외', () => {
    expect(aggregateReturns([{ signals: ['X'] }])).toEqual({})
  })
})

describe('judgeHit', () => {
  it('매수: 현재가>신호가면 적중', () => {
    expect(judgeHit('buy', 100, 120)).toBe(true)
    expect(judgeHit('buy', 100, 90)).toBe(false)
  })
  it('매도: 현재가<신호가면 적중', () => {
    expect(judgeHit('sell', 100, 80)).toBe(true)
    expect(judgeHit('sell', 100, 110)).toBe(false)
  })
})

describe('aggregateHitRates', () => {
  it('신호별 적중률 집계', () => {
    const records = [
      { signals: ['RSI 과매도 (10)'], hit: true },
      { signals: ['RSI 과매도 (12)'], hit: false },
      { signals: ['RSI 과매도 (9)'], hit: true },
    ]
    const r = aggregateHitRates(records)
    expect(r['RSI 과매도'].count).toBe(3)
    expect(r['RSI 과매도'].hitRate).toBeCloseTo(2 / 3, 5)
  })
})

describe('updateWeights', () => {
  it('MIN_SAMPLES 미만이면 조정 안 함', () => {
    const weights = { 'RSI 과매도': 0.55 }
    const stats = { 'RSI 과매도': { count: 2, hitRate: 0.1 } }
    expect(updateWeights(weights, stats)['RSI 과매도']).toBe(0.55)
  })
  it('충분한 샘플이면 EWM 갱신', () => {
    const weights = { 'RSI 과매도': 0.55 }
    const stats = { 'RSI 과매도': { count: 5, hitRate: 0.2 } }
    // 0.55*0.8 + 0.7*0.2 = 0.58
    expect(updateWeights(weights, stats)['RSI 과매도']).toBeCloseTo(0.58, 5)
  })
})

describe('buildWeeklyReport', () => {
  const stats = {
    'RSI 과매도': { count: 4, hitRate: 0.5 },
    'EMA 하락배열': { count: 3, hitRate: 1 },
  }
  const records = [
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (10)'], hit: true },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (12)'], hit: true },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (11)'], hit: false },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (9)'], hit: false },
    { market: 'KRW-B', korean_name: '비', side: 'buy', signals: ['Stoch 골든크로스 (5)'], hit: true }, // 표본 1 → 제외
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
  ]
  const oldW = { 'RSI 과매도': 0.55, 'EMA 하락배열': 1.0, '안변함': 1.0 }
  const newW = { 'RSI 과매도': 0.74, 'EMA 하락배열': 0.9, '안변함': 1.0 }

  it('topBuySignals: 매수만, 표본 3+ , 적중률 내림차순', () => {
    const { topBuySignals } = buildWeeklyReport(records, stats, oldW, newW)
    expect(topBuySignals).toEqual([{ key: 'RSI 과매도', count: 4, hitRate: 0.5, hits: 2 }])
  })
  it('topSellSignals: 매도만 집계', () => {
    const { topSellSignals } = buildWeeklyReport(records, stats, oldW, newW)
    expect(topSellSignals).toEqual([{ key: 'EMA 하락배열', count: 3, hitRate: 1, hits: 3 }])
  })
  it('weightChanges: 변화한 key만, 변화량 큰 순, 방향·이유 포함', () => {
    const { weightChanges } = buildWeeklyReport(records, stats, oldW, newW)
    expect(weightChanges.map((w) => w.key)).toEqual(['RSI 과매도', 'EMA 하락배열'])
    expect(weightChanges.find((w) => w.key === 'RSI 과매도')).toEqual({
      key: 'RSI 과매도', old: 0.55, new: 0.74, direction: 'up', reason: '적중률 50% (표본 4) → 상향',
    })
  })
  it('hitCoins / missCoins 집계 (매수·매도 합산)', () => {
    const { hitCoins, missCoins } = buildWeeklyReport(records, stats, oldW, newW)
    expect(hitCoins.map((c) => c.market)).toEqual(['KRW-C', 'KRW-A', 'KRW-B'])
    expect(hitCoins[0]).toEqual({ market: 'KRW-C', korean_name: '씨', hits: 3, total: 3 })
    expect(missCoins).toEqual([])
  })
})
