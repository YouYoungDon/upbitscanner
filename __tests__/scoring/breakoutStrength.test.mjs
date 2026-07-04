import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/breakoutStrength.mjs'

const makeCtx = (bars) => ({ coin: { ohlcvDaily: bars } })

describe('breakoutStrength', () => {
  it('21 bars, prior 20 have high=100, last close=110 → raw > 0', () => {
    const prior = Array.from({ length: 20 }, () => ({ high: 100, low: 90, close: 95, open: 92 }))
    const last = { high: 115, low: 105, close: 110, open: 106 }
    const raw = feature.compute(makeCtx([...prior, last]))
    expect(raw).toBeGreaterThan(0)
  })
  it('length < 21 → null', () => {
    const bars = Array.from({ length: 20 }, () => ({ high: 100, low: 90, close: 95, open: 92 }))
    expect(feature.compute(makeCtx(bars))).toBe(null)
  })
})
