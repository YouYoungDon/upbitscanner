import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/volExpansionOnBreakout.mjs'

const makeCtx = (closes) => ({ coin: { ohlcvDaily: closes.map((c) => ({ close: c })) } })

describe('volExpansionOnBreakout', () => {
  it('falling series of 40 closes → raw === 0 (price down, not expanding up)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 - i)
    const raw = feature.compute(makeCtx(closes))
    expect(raw).toBe(0)
  })
  it('too few closes (5 items) → null', () => {
    const closes = [100, 99, 98, 97, 96]
    expect(feature.compute(makeCtx(closes))).toBe(null)
  })
})
