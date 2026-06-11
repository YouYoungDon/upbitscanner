import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMarkets, getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

function mockFetch(data, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({ ok, json: async () => data })
}

describe('getMarkets', () => {
  it('KRW 마켓만, 스테이블코인 제외', async () => {
    mockFetch([
      { market: 'KRW-BTC', korean_name: '비트코인' },
      { market: 'KRW-USDT', korean_name: '테더' },
      { market: 'BTC-ETH', korean_name: '이더' },
    ])
    const r = await getMarkets()
    expect(r.map((m) => m.market)).toEqual(['KRW-BTC'])
  })
})

describe('candlesToOhlcv', () => {
  it('업비트 캔들을 과거→최신 ohlcv로 변환', () => {
    const candles = [
      { trade_price: 3, high_price: 3, low_price: 2, candle_acc_trade_volume: 30 },
      { trade_price: 1, high_price: 1, low_price: 0, candle_acc_trade_volume: 10 },
    ]
    const o = candlesToOhlcv(candles)
    expect(o[0].close).toBe(1)
    expect(o[1].close).toBe(3)
  })
})

describe('getDayCandles', () => {
  it('실패 응답 시 null', async () => {
    mockFetch(null, false)
    expect(await getDayCandles('KRW-BTC')).toBeNull()
  })
})

describe('getTicker', () => {
  it('마켓 배열을 콤마로 합쳐 호출', async () => {
    mockFetch([{ market: 'KRW-BTC', trade_price: 100 }])
    const r = await getTicker(['KRW-BTC'])
    expect(r[0].trade_price).toBe(100)
  })
})
