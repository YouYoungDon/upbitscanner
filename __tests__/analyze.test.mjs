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

  it('scoreBreakdown: 항목합×콤보 = 합계, 합계 = buyScore', () => {
    // 하락 추세로 매수 신호 유발
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 200 - i * 2
      return { open: close, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const r = analyzeMarket(ohlcv, { weights: {} })
    expect(r).toHaveProperty('scoreBreakdown')
    const b = r.scoreBreakdown.buy
    expect(Array.isArray(b.items)).toBe(true)
    const subtotal = b.items.reduce((a, x) => a + x.score, 0)
    expect(subtotal).toBeCloseTo(b.subtotal, 5)
    let total = b.subtotal
    for (const c of b.combos) total *= c.mult
    expect(total).toBeCloseTo(b.total, 5)
    expect(b.total).toBeCloseTo(r.buyScore, 5)
    // 매도는 콤보 없음
    expect(r.scoreBreakdown.sell.combos).toEqual([])
    expect(r.scoreBreakdown.sell.total).toBeCloseTo(r.sellScore, 5)
  })
})
