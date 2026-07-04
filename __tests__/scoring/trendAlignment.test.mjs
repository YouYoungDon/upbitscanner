import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/trendAlignment.mjs'

const makeCtx = (closes) => ({ coin: { ohlcvDaily: closes.map((c) => ({ close: c })) } })

describe('trendAlignment', () => {
  it('70-bar rising series (1,2,...,70) → raw === 3', () => {
    const closes = Array.from({ length: 70 }, (_, i) => i + 1)
    expect(feature.compute(makeCtx(closes))).toBe(3)
  })
  it('70-bar falling series (70,69,...,1) → raw === 0', () => {
    const closes = Array.from({ length: 70 }, (_, i) => 70 - i)
    expect(feature.compute(makeCtx(closes))).toBe(0)
  })
  it('length < 60 → null', () => {
    const closes = Array.from({ length: 59 }, (_, i) => i + 1)
    expect(feature.compute(makeCtx(closes))).toBe(null)
  })
})
