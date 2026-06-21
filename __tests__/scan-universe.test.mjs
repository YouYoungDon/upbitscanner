import { describe, it, expect } from 'vitest'
import { getScanUniverse, MIN_TRADE_PRICE_24H, liquidityMultiplier, LOW_LIQUIDITY_24H } from '../lib/scan-universe.mjs'

describe('getScanUniverse', () => {
  const markets = [
    { market: 'KRW-A', korean_name: '에이' },
    { market: 'KRW-B', korean_name: '비' },
    { market: 'KRW-C', korean_name: '씨' },
  ]
  it('거래대금 임계 이상만 targets, nameOf/total 구성', async () => {
    const tickers = [
      { market: 'KRW-A', acc_trade_price_24h: MIN_TRADE_PRICE_24H },       // 통과
      { market: 'KRW-B', acc_trade_price_24h: MIN_TRADE_PRICE_24H - 1 },   // 탈락
      { market: 'KRW-C', acc_trade_price_24h: MIN_TRADE_PRICE_24H * 2 },   // 통과
    ]
    const r = await getScanUniverse({
      getMarkets: async () => markets,
      getTicker: async (codes) => tickers.filter((t) => codes.includes(t.market)),
      delay: 0,
    })
    expect(r.targets).toEqual(['KRW-A', 'KRW-C'])
    expect(r.nameOf['KRW-C']).toBe('씨')
    expect(r.total).toBe(3)
    expect(r.tradePrice['KRW-C']).toBe(MIN_TRADE_PRICE_24H * 2)
  })
  it('마켓 없으면 빈 결과', async () => {
    const r = await getScanUniverse({ getMarkets: async () => [], getTicker: async () => [], delay: 0 })
    expect(r).toEqual({ targets: [], nameOf: {}, total: 0 })
  })
})

describe('liquidityMultiplier', () => {
  it('구간별 배수', () => {
    expect(liquidityMultiplier(60_0000_0000)).toBe(1.0)   // 60억
    expect(liquidityMultiplier(30_0000_0000)).toBe(0.9)   // 30억
    expect(liquidityMultiplier(10_0000_0000)).toBe(0.8)   // 10억
    expect(liquidityMultiplier(3_0000_0000)).toBe(0.6)    // 3억
  })
  it('경계: 50억=1.0, 20억=0.9, 5억=0.8', () => {
    expect(liquidityMultiplier(50_0000_0000)).toBe(1.0)
    expect(liquidityMultiplier(20_0000_0000)).toBe(0.9)
    expect(liquidityMultiplier(5_0000_0000)).toBe(0.8)
  })
  it('저유동성 기준선 5억', () => {
    expect(LOW_LIQUIDITY_24H).toBe(500_000_000)
  })
})
