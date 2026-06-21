import { describe, it, expect } from 'vitest'
import { candlesToOhlcv } from '../lib/upbit.mjs'

describe('candlesToOhlcv tradeValue', () => {
  it('원시 분봉 candle_acc_trade_price를 tradeValue로 매핑(과거→최신)', () => {
    const raw = [
      { candle_date_time_utc: '2026-06-21T00:05:00', opening_price: 10, trade_price: 11, high_price: 12, low_price: 9, candle_acc_trade_volume: 100, candle_acc_trade_price: 2000 },
      { candle_date_time_utc: '2026-06-21T00:00:00', opening_price: 9, trade_price: 10, high_price: 10, low_price: 8, candle_acc_trade_volume: 50, candle_acc_trade_price: 1000 },
    ]
    const o = candlesToOhlcv(raw)
    expect(o.map((c) => c.tradeValue)).toEqual([1000, 2000]) // reverse: 과거→최신
    expect(o.at(-1).close).toBe(11)
  })
})
