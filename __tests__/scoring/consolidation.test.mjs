import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/consolidation.mjs'

const makeCtx = (bars) => ({ coin: { ohlcvDaily: bars } })

describe('consolidation', () => {
  it('10 bars with high=101, low=99, close=100 → raw > -0.05 (tight, negative but near 0)', () => {
    const bars = Array.from({ length: 10 }, () => ({ high: 101, low: 99, close: 100 }))
    const raw = feature.compute(makeCtx(bars))
    expect(raw).toBeGreaterThan(-0.05)
    expect(raw).toBeLessThan(0)
  })
  it('length < 10 → null', () => {
    const bars = Array.from({ length: 9 }, () => ({ high: 101, low: 99, close: 100 }))
    expect(feature.compute(makeCtx(bars))).toBe(null)
  })
})
