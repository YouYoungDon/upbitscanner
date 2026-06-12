import { describe, it, expect } from 'vitest'
import { judgeHit, aggregateHitRates, updateWeights } from '../lib/weekly.mjs'

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
