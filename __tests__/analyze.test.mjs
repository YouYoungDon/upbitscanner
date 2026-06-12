import { describe, it, expect } from 'vitest'
import { analyzeMarket } from '../lib/analyze.mjs'

describe('analyzeMarket', () => {
  it('지표/신호/캔들패턴/점수를 담은 객체 반환', () => {
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 100 + i
      return { open: close - 0.5, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const r = analyzeMarket(ohlcv, { weights: {} })
    expect(r).toHaveProperty('indicators')
    expect(r.indicators).toHaveProperty('rsi')
    expect(r).toHaveProperty('buy')
    expect(r).toHaveProperty('sell')
    expect(r).toHaveProperty('candlePatterns')
    expect(typeof r.buyScore).toBe('number')
  })
})
