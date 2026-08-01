import { describe, it, expect } from 'vitest'
import { judgeHit, aggregateHitRates, updateWeights, buildWeeklyReport, aggregateReturns, judgeAtHorizon, sideSummary, timedHitRates, statsWithReturns } from '../lib/weekly.mjs'

describe('statsWithReturns — 적중률+평균수익 병합 (표시·학습 공용)', () => {
  it('aggregateHitRates에 avgReturn 병합', () => {
    const records = [
      { signals: ['RSI 과매도'], hit: true, ret: 10 },
      { signals: ['RSI 과매도'], hit: false, ret: -4 },
    ]
    const s = statsWithReturns(records)
    expect(s['RSI 과매도'].count).toBe(2)
    expect(s['RSI 과매도'].hitRate).toBeCloseTo(0.5)
    expect(s['RSI 과매도'].avgReturn).toBe(3)
  })
})

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

describe('judgeAtHorizon — +1일 확정종가 판정', () => {
  // closeOf: KRW-A는 dayIdx 101 종가 110, KRW-B는 캔들 없음(미확정/실패)
  const closeOf = (market, dayIdx) => (market === 'KRW-A' && dayIdx === 101 ? 110 : null)
  const base = { market: 'KRW-A', korean_name: '에이', dayIdx: 100, signals: ['RSI 과매도'] }

  it('매수: D0+1 종가>신호가면 적중, ret은 % 수익률', () => {
    const [r] = judgeAtHorizon([{ ...base, side: 'buy', signalPrice: 100 }], closeOf)
    expect(r.hit).toBe(true)
    expect(r.ret).toBeCloseTo(10, 5)
    expect(r.side).toBe('buy')
    expect(r.signals).toEqual(['RSI 과매도'])
  })
  it('매도: D0+1 종가<신호가면 적중, ret은 방향 기준 유리 수익률', () => {
    const [r] = judgeAtHorizon([{ ...base, side: 'sell', signalPrice: 100 }], closeOf)
    expect(r.hit).toBe(false) // 110 > 100 → 매도 미적중
    expect(r.ret).toBeCloseTo((100 / 110 - 1) * 100, 2)
  })
  it('확정종가 없으면(미확정·fetch 실패) 레코드 제외', () => {
    const preds = [
      { ...base, side: 'buy', signalPrice: 100 },
      { ...base, market: 'KRW-B', side: 'buy', signalPrice: 100 },
    ]
    expect(judgeAtHorizon(preds, closeOf)).toHaveLength(1)
  })
  it('horizonDays 지정 시 해당 일 종가로 판정', () => {
    const c3 = (m, d) => (d === 103 ? 90 : null)
    const [r] = judgeAtHorizon([{ ...base, side: 'buy', signalPrice: 100 }], c3, 3)
    expect(r.hit).toBe(false)
    expect(r.ret).toBeCloseTo(-10, 5)
  })
})

describe('sideSummary — 매수/매도 분리 요약', () => {
  it('side별 predictions/hits/hitRate', () => {
    const records = [
      { side: 'buy', hit: true }, { side: 'buy', hit: false }, { side: 'buy', hit: false },
      { side: 'sell', hit: true }, { side: 'sell', hit: true },
    ]
    const s = sideSummary(records)
    expect(s.buy).toEqual({ predictions: 3, hits: 1, hitRate: 0.333 })
    expect(s.sell).toEqual({ predictions: 2, hits: 2, hitRate: 1 })
  })
  it('빈 쪽은 hitRate 0', () => {
    expect(sideSummary([]).buy).toEqual({ predictions: 0, hits: 0, hitRate: 0 })
  })
})

describe('timedHitRates — 확정종가 캐시 기반 +1/+3/+7일', () => {
  const DAY_MS = 86400000
  // 스캔 D0 = dayIdx 100. KRW-A: D+1=110(적중), D+3=90(미적중), D+7 캔들 없음
  const scans = [{ timestamp: new Date(100 * DAY_MS).toISOString(), buy: [{ market: 'KRW-A', price: 100 }] }]
  const closes = { 101: 110, 103: 90 }
  const closeOf = (m, d) => (m === 'KRW-A' ? closes[d] ?? null : null)

  it('창별 hit/total 집계, 데이터 없는 창은 null', () => {
    const t = timedHitRates(scans, (s) => s.buy ?? [], closeOf)
    expect(t['+1일']).toEqual({ hit: 1, total: 1, hitRate: 1 })
    expect(t['+3일']).toEqual({ hit: 0, total: 1, hitRate: 0 })
    expect(t['+7일']).toBeNull()
  })
  it('getItems로 모멘텀 픽(s.picks)도 동일 판정', () => {
    const mom = [{ timestamp: new Date(100 * DAY_MS).toISOString(), picks: [{ market: 'KRW-A', price: 120 }] }]
    const t = timedHitRates(mom, (s) => s.picks ?? [], closeOf)
    expect(t['+1일']).toEqual({ hit: 0, total: 1, hitRate: 0 }) // 110 < 120
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
  it('충분한 샘플이면 갱신', () => {
    const weights = { 'RSI 과매도': 0.55 }
    const stats = { 'RSI 과매도': { count: 8, hitRate: 0.2 } }
    // newWeight(0.55, 0.2) = clampWeight(0.55*0.7 + qualityTarget(0.2, undefined)*0.3)
    // hitComponent(0.2)=0.7(클램프), returnComponent(undefined)=1 → qualityTarget=0.7
    // 0.55*0.7 + 0.7*0.3 = 0.595
    expect(updateWeights(weights, stats)['RSI 과매도']).toBeCloseTo(0.595, 5)
  })
})

describe('updateWeights (avgReturn 반영 + MIN_SAMPLES 8)', () => {
  it('count<8이면 스킵', () => {
    const out = updateWeights({ A: 1 }, { A: { count: 7, hitRate: 0.9, avgReturn: 20 } })
    expect(out.A).toBe(1)
  })
  it('count>=8이면 avgReturn 반영해 갱신', () => {
    const out = updateWeights({ A: 1 }, { A: { count: 8, hitRate: 0.7, avgReturn: 25 } })
    expect(out.A).toBeCloseTo(1.2625, 3) // newWeight(1,0.7,25)
  })
  it('avgReturn 없어도 동작(성분 1)', () => {
    const out = updateWeights({ A: 1 }, { A: { count: 10, hitRate: 0.7 } })
    // newWeight(1, 0.7) = 1*0.7 + 1.5*0.3 = 1.15 (store.test.mjs와 동일 케이스)
    expect(out.A).toBeCloseTo(1.15, 3)
  })
})

describe('buildWeeklyReport', () => {
  const stats = {
    'RSI 과매도': { count: 4, hitRate: 0.5 },
    'EMA 하락배열': { count: 3, hitRate: 1 },
  }
  const records = [
    // MIN_SAMPLES 8 반영: RSI 과매도(buy) 8건(4적중/4미적중=0.5), EMA 하락배열(sell) 8건(전원 적중)
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (10)'], hit: true },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (12)'], hit: true },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (11)'], hit: false },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (9)'], hit: false },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (10)'], hit: true },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (12)'], hit: true },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (11)'], hit: false },
    { market: 'KRW-A', korean_name: '에이', side: 'buy', signals: ['RSI 과매도 (9)'], hit: false },
    { market: 'KRW-B', korean_name: '비', side: 'buy', signals: ['Stoch 골든크로스 (5)'], hit: true }, // 표본 1 → 제외
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
    { market: 'KRW-C', korean_name: '씨', side: 'sell', signals: ['EMA 하락배열'], hit: true },
  ]
  const oldW = { 'RSI 과매도': 0.55, 'EMA 하락배열': 1.0, '안변함': 1.0 }
  const newW = { 'RSI 과매도': 0.74, 'EMA 하락배열': 0.9, '안변함': 1.0 }

  it('topBuySignals: 매수만, 표본 8+ , 적중률 내림차순', () => {
    const { topBuySignals } = buildWeeklyReport(records, stats, oldW, newW)
    expect(topBuySignals).toEqual([{ key: 'RSI 과매도', count: 8, hitRate: 0.5, hits: 4 }])
  })
  it('topSellSignals: 매도만 집계', () => {
    const { topSellSignals } = buildWeeklyReport(records, stats, oldW, newW)
    expect(topSellSignals).toEqual([{ key: 'EMA 하락배열', count: 8, hitRate: 1, hits: 8 }])
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
    expect(hitCoins[0]).toEqual({ market: 'KRW-C', korean_name: '씨', hits: 8, total: 8 })
    expect(missCoins).toEqual([])
  })
})
