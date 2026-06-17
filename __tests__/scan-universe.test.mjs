import { describe, it, expect } from 'vitest'
import { getScanUniverse, MIN_TRADE_PRICE_24H } from '../lib/scan-universe.mjs'

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
  })
  it('마켓 없으면 빈 결과', async () => {
    const r = await getScanUniverse({ getMarkets: async () => [], getTicker: async () => [], delay: 0 })
    expect(r).toEqual({ targets: [], nameOf: {}, total: 0 })
  })
})
