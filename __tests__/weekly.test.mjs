import { describe, it, expect } from 'vitest'
import { judgeHit, aggregateHitRates, updateWeights, buildWeeklyReport } from '../lib/weekly.mjs'

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
    'RSI 과매도': { count: 4, hitRate: 0.75 },
    'Stoch 골든크로스': { count: 2, hitRate: 1 },
    'EMA 하락배열': { count: 5, hitRate: 0.2 },
  }
  const records = [
    { market: 'KRW-ZKC', korean_name: '바운드리스', side: 'buy', signals: ['RSI 과매도'], hit: true },
    { market: 'KRW-ZKC', korean_name: '바운드리스', side: 'buy', signals: ['Stoch 골든크로스'], hit: true },
    { market: 'KRW-XYZ', korean_name: '엑스', side: 'buy', signals: ['EMA 하락배열'], hit: false },
  ]
  const oldW = { 'RSI 과매도': 1.0, 'EMA 하락배열': 1.0, '안변함': 1.0 }
  const newW = { 'RSI 과매도': 1.1, 'EMA 하락배열': 0.92, '안변함': 1.0 }

  it('topSignals: hits 내림차순, hits=round(count*hitRate)', () => {
    const { topSignals } = buildWeeklyReport(records, stats, oldW, newW)
    expect(topSignals[0]).toEqual({ key: 'RSI 과매도', count: 4, hitRate: 0.75, hits: 3 })
    expect(topSignals.map((s) => s.key)).toEqual(['RSI 과매도', 'Stoch 골든크로스', 'EMA 하락배열'])
  })
  it('weightChanges: 변화한 key만, 방향·이유 포함', () => {
    const { weightChanges } = buildWeeklyReport(records, stats, oldW, newW)
    expect(weightChanges.map((w) => w.key)).toEqual(['RSI 과매도', 'EMA 하락배열'])
    expect(weightChanges.find((w) => w.key === 'RSI 과매도')).toEqual({
      key: 'RSI 과매도', old: 1, new: 1.1, direction: 'up', reason: '적중률 75% (표본 4) → 상향',
    })
  })
  it('hitCoins / missCoins 집계', () => {
    const { hitCoins, missCoins } = buildWeeklyReport(records, stats, oldW, newW)
    expect(hitCoins).toEqual([{ market: 'KRW-ZKC', korean_name: '바운드리스', hits: 2, total: 2 }])
    expect(missCoins).toEqual([{ market: 'KRW-XYZ', korean_name: '엑스', total: 1 }])
  })
})
