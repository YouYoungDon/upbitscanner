import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/relativeTradingValue.mjs'

describe('relativeTradingValue', () => {
  it('normal case: acc_trade_price_24h = 1e9 → raw === 1e9', () => {
    const ctx = { coin: { ticker: { acc_trade_price_24h: 1e9 } } }
    expect(feature.compute(ctx)).toBe(1e9)
  })
  it('missing ticker → null', () => {
    const ctx = { coin: {} }
    expect(feature.compute(ctx)).toBe(null)
  })
})
