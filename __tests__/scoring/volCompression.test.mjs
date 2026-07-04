import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/volCompression.mjs'

const makeCtx = (closes) => ({ coin: { ohlcvDaily: closes.map((c) => ({ close: c })) } })

describe('volCompression', () => {
  it('40 closes → typeof raw === number', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i)
    const raw = feature.compute(makeCtx(closes))
    expect(typeof raw).toBe('number')
  })
  it('3 closes → null (calcBBWidthSeries needs at least 20)', () => {
    const closes = [100, 101, 102]
    expect(feature.compute(makeCtx(closes))).toBe(null)
  })
})
