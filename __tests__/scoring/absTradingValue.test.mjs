import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/absTradingValue.mjs'

describe('absTradingValue', () => {
  it('normal: acc_trade_price_24h = 5e8 → raw === 5e8', () => {
    const ctx = { coin: { ticker: { acc_trade_price_24h: 5e8 } } }
    expect(feature.compute(ctx)).toBe(5e8)
  })
  it('missing ticker → null', () => {
    const ctx = { coin: {} }
    expect(feature.compute(ctx)).toBe(null)
  })
  it('params is a non-empty array', () => {
    expect(Array.isArray(feature.params)).toBe(true)
    expect(feature.params.length).toBeGreaterThan(0)
  })
})
