import { describe, it, expect } from 'vitest'
import { marketDailyReturns, mergeDailyReturns, baselineReturn, episodeExcess } from '../lib/market-baseline.mjs'
import { ROUND_TRIP_COST, netRet } from '../lib/costs.mjs'

const DAY = 86400
const bars = (startDay, closes) => closes.map((close, i) => ({ time: (startDay + i) * DAY, open: close, high: close, low: close, close, volume: 1 }))

describe('costs', () => {
  it('왕복 비용 0.3%(수수료 0.05%×2 + 슬리피지 0.2%)를 뺀 순수익', () => {
    expect(ROUND_TRIP_COST).toBe(0.003)
    expect(netRet(0.01)).toBeCloseTo(0.007, 12)
    expect(netRet(null)).toBeNull()
  })
})

describe('marketDailyReturns', () => {
  it('전일 종가 대비 등락을 종목 동일가중 평균(±50% 윈저)', () => {
    const r = marketDailyReturns({ A: bars(100, [100, 110]), B: bars(100, [100, 300]) }, { minMarkets: 2 })
    // A +10%, B +200% → 윈저 +50% → 평균 +30%
    expect(r[101]).toBeCloseTo(0.3, 12)
    expect(r[100]).toBeUndefined()
  })
  it('전날 봉이 없는 종목(결손일)은 그날 평균에서 빠지고, 종목 수 미달 날은 기록하지 않는다', () => {
    const a = bars(100, [100, 110, 121])
    const b = [bars(100, [100])[0], bars(102, [50])[0]] // 101일 결손
    const r = marketDailyReturns({ A: a, B: b }, { minMarkets: 2 })
    expect(r[101]).toBeUndefined() // B가 101일 봉 없음 → 1종목뿐
    expect(r[102]).toBeUndefined() // B의 102일은 직전(101) 봉이 없어 제외 → 1종목
    expect(marketDailyReturns({ A: a, B: b }, { minMarkets: 1 })[102]).toBeCloseTo(0.1, 12)
  })
})

describe('mergeDailyReturns / baselineReturn', () => {
  it('새 값이 덮어쓰고 기존 날짜는 유지', () => {
    expect(mergeDailyReturns({ 1: 0.1, 2: 0.2 }, { 2: 0.3, 3: 0.4 })).toEqual({ 1: 0.1, 2: 0.3, 3: 0.4 })
  })
  it('d0 다음날부터 n일 연쇄 복리, 하루라도 없으면 null', () => {
    const daily = { 11: 0.1, 12: -0.1, 13: 0.05 }
    expect(baselineReturn(daily, 10, 2)).toBeCloseTo(1.1 * 0.9 - 1, 12)
    expect(baselineReturn(daily, 10, 7)).toBeNull()
  })
})

describe('episodeExcess', () => {
  it('픽의 D0 종가→D+n 종가 수익에서 같은 구간 시장 수익을 뺀다', () => {
    const ep = { entryTs: new Date(10 * DAY * 1000 + 3600e3).toISOString() }
    const confirmed = bars(10, [100, 120, 130, 140])
    const daily = { 11: 0.1, 12: 0, 13: 0 }
    const x = episodeExcess(ep, confirmed, daily)
    expect(x.exc1).toBeCloseTo(0.2 - 0.1, 12)
    expect(x.exc3).toBeCloseTo(0.4 - 0.1, 12)
    expect(x.exc7).toBeNull()
  })
  it('D0 봉이 없으면 전부 null', () => {
    const ep = { entryTs: new Date(10 * DAY * 1000).toISOString() }
    expect(episodeExcess(ep, bars(11, [100, 110]), { 11: 0, 12: 0 })).toEqual({ exc1: null, exc3: null, exc7: null })
  })
})
