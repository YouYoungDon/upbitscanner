import { describe, it, expect } from 'vitest'
import { buildResults, buildInsights, buildVerify, comboDistribution, candleSummary, buildHistory, buildMomentum } from '../server/api.mjs'

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
  it('최신 주차 report를 통과시킨다', () => {
    const weekly = { weeks: [{ timestamp: 't1' }, { timestamp: 't2', report: { topSignals: [{ key: 'A' }] } }] }
    const r = buildVerify(weekly, { A: 1.2 })
    expect(r.report).toEqual({ topSignals: [{ key: 'A' }] })
  })
  it('report 없으면 null', () => {
    const r = buildVerify({ weeks: [{ timestamp: 't1' }] }, {})
    expect(r.report).toBeNull()
  })
})

describe('buildMomentum', () => {
  it('최신 모멘텀 스캔의 추세지속 종목 + KPI', () => {
    const log = { totalScans: 3, scans: [{ timestamp: 't2', picks: [{ market: 'KRW-WLD', korean_name: '월드코인', price: 5, score: 16, signals: ['EMA 완전정배열', '신고가'] }] }] }
    const r = buildMomentum(log)
    expect(r.empty).toBe(false)
    expect(r.kpi.count).toBe(1)
    expect(r.kpi.totalScans).toBe(3)
    expect(r.picks[0].market).toBe('KRW-WLD')
  })
  it('스캔 없으면 empty', () => {
    expect(buildMomentum({ scans: [] }).empty).toBe(true)
  })
})

describe('comboDistribution', () => {
  it('매수 종목 신호에서 콤보/MTF 종목 수 집계', () => {
    const buy = [
      { signals: ['Stoch 과매도 골든크로스 (5)', '[콤보] 반등확인 보너스', '[MTF] 4시간봉 Stoch GC 확인'] },
      { signals: ['BB 하단 지지', '[콤보] 과매도 함정 페널티'] },
      { signals: ['거래량 급증 (2.5x)', '[콤보] 거래량확인 보너스', '[콤보] 반등확인 보너스'] },
    ]
    const r = comboDistribution(buy)
    expect(r.rebound).toBe(2)
    expect(r.trap).toBe(1)
    expect(r.volume).toBe(1)
    expect(r.mtf).toBe(1)
  })
})

describe('candleSummary', () => {
  it('매수 강세형/매도 약세형 종목 수와 대표 패턴', () => {
    const scan = {
      buy: [
        { signals: ['캔들 강세형 (망치형,상승장악형)'] },
        { signals: ['캔들 강세형 (망치형)'] },
      ],
      sell: [{ signals: ['캔들 약세형 (유성형)'] }],
    }
    const r = candleSummary(scan)
    expect(r.bullishCount).toBe(2)
    expect(r.bearishCount).toBe(1)
    expect(r.topBullish[0]).toEqual({ name: '망치형', count: 2 })
  })
})

describe('buildHistory', () => {
  it('최근 스캔별 매수/매도 개수 (limit 적용)', () => {
    const log = { scans: [
      { timestamp: 't1', buy: [{}], sell: [{}, {}] },
      { timestamp: 't2', buy: [{}, {}], sell: [] },
      { timestamp: 't3', buy: [], sell: [{}] },
    ] }
    const r = buildHistory(log, 2)
    expect(r).toEqual([
      { timestamp: 't2', buyCount: 2, sellCount: 0 },
      { timestamp: 't3', buyCount: 0, sellCount: 1 },
    ])
  })
})

import { buildScans, findScanByTimestamp } from '../server/api.mjs'

describe('buildScans', () => {
  const scans = [
    { timestamp: 't1', buy: [{ korean_name: '에이', score: 5 }], sell: [] },
    { timestamp: 't2', buy: [], sell: [{ korean_name: '비' }] },
    { timestamp: 't3', buy: [{ korean_name: '씨', score: 7 }], sell: [] },
  ]
  it('최신순 요약 + total + limit/offset', () => {
    const r = buildScans(scans, { limit: 2, offset: 0 })
    expect(r.total).toBe(3)
    expect(r.items.map((i) => i.timestamp)).toEqual(['t3', 't2'])
  })
  it('offset 적용', () => {
    const r = buildScans(scans, { limit: 2, offset: 2 })
    expect(r.items.map((i) => i.timestamp)).toEqual(['t1'])
  })
})

describe('findScanByTimestamp', () => {
  it('timestamp로 스캔 찾기', () => {
    const scans = [{ timestamp: 't1', buy: [], sell: [] }, { timestamp: 't2', buy: [{ market: 'KRW-A' }], sell: [] }]
    expect(findScanByTimestamp(scans, 't2').buy[0].market).toBe('KRW-A')
    expect(findScanByTimestamp(scans, 'nope')).toBeNull()
  })
})

import { buildFlow } from '../server/api.mjs'

describe('buildFlow', () => {
  it('빈 로그 → empty', () => {
    expect(buildFlow({ scans: [] }).empty).toBe(true)
  })
  it('최신 스캔의 picks·btc·레벨 KPI', () => {
    const log = { totalScans: 2, scans: [{ timestamp: 't', btc: { ret: 0.5, favorable: true }, picks: [
      { market: 'KRW-A', level: 'strong', score: 80 },
      { market: 'KRW-B', level: 'watch', score: 30 },
    ] }] }
    const r = buildFlow(log)
    expect(r.empty).toBe(false)
    expect(r.kpi).toEqual({ strong: 1, attention: 0, watch: 1, totalScans: 2 })
    expect(r.picks.length).toBe(2)
    expect(r.btc.favorable).toBe(true)
  })
})

describe('buildResults 저유동성 분리', () => {
  it('buy를 메인/저유동성으로 가른다', () => {
    const log = { totalScans: 1, scans: [{
      timestamp: 't', regime: null,
      buy: [
        { market: 'KRW-A', korean_name: 'A', price: 1, score: 10, signals: [] },
        { market: 'KRW-B', korean_name: 'B', price: 1, score: 8, signals: [], lowLiquidity: true },
      ],
      sell: [],
    }] }
    const r = buildResults(log)
    expect(r.buy.map((b) => b.market)).toEqual(['KRW-A'])
    expect(r.buyLowLiq.map((b) => b.market)).toEqual(['KRW-B'])
  })
})
