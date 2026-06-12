import { describe, it, expect } from 'vitest'
import { buildResults, buildInsights, buildVerify } from '../server/api.mjs'

const log = {
  totalScans: 5,
  scans: [{
    timestamp: '2026-06-12T00:00:00Z',
    buy: [{ market: 'KRW-A', korean_name: '에이', price: 10, score: 7, signals: ['Stoch 과매도 골든크로스 (5)'] }],
    sell: [{ market: 'KRW-B', korean_name: '비', price: 20, score: 4, signals: ['MACD 하락'] }],
  }],
}

describe('buildResults', () => {
  it('최신 스캔의 매수/매도 + KPI', () => {
    const r = buildResults(log)
    expect(r.kpi.buyCount).toBe(1)
    expect(r.kpi.sellCount).toBe(1)
    expect(r.kpi.totalScans).toBe(5)
    expect(r.buy[0].market).toBe('KRW-A')
  })
  it('스캔 없으면 empty', () => {
    expect(buildResults({ scans: [] }).empty).toBe(true)
  })
})

describe('buildInsights', () => {
  it('최다 신호와 적중률 1위', () => {
    const weekly = { weeks: [{ signalStats: { 'Stoch 과매도 골든크로스': { count: 4, hitRate: 0.7 } } }] }
    const r = buildInsights(log, weekly)
    expect(r.topSignal.key).toBe('Stoch 과매도 골든크로스')
    expect(r.bestHitRate.key).toBe('Stoch 과매도 골든크로스')
  })
})

describe('buildVerify', () => {
  it('최신 주간 분석의 적중률/시간별/가중치 결합', () => {
    const weekly = { weeks: [{ overallHitRate: 0.4, timedHitRates: { '+1일': { hitRate: 0.5 } }, signalStats: { X: { count: 3, hitRate: 0.6 } } }] }
    const weights = { X: 1.2 }
    const r = buildVerify(weekly, weights)
    expect(r.overallHitRate).toBe(0.4)
    expect(r.timedHitRates['+1일'].hitRate).toBe(0.5)
    expect(r.weights.X).toBe(1.2)
  })
})
