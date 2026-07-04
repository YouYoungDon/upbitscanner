import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/liquidity.mjs'

const makeCtx = (tradeValues) => ({ coin: { ohlcvDaily: tradeValues.map((v) => ({ tradeValue: v })) } })

describe('liquidity', () => {
  it('20 equal tradeValues of 3e8 → raw === 3e8', () => {
    const tv = Array.from({ length: 20 }, () => 3e8)
    expect(feature.compute(makeCtx(tv))).toBe(3e8)
  })
  it('length < 20 → null', () => {
    const tv = Array.from({ length: 19 }, () => 3e8)
    expect(feature.compute(makeCtx(tv))).toBe(null)
  })
})
