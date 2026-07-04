import { describe, it, expect } from 'vitest'
import feature from '../../lib/scoring/features/moneyAcceleration.mjs'

const makeCtx = (tradeValues) => ({ coin: { ohlcvDaily: tradeValues.map((v) => ({ tradeValue: v })) } })

describe('moneyAcceleration', () => {
  it('rising tradeValues 1..15 → raw > 1', () => {
    const tv = Array.from({ length: 15 }, (_, i) => i + 1)
    const raw = feature.compute(makeCtx(tv))
    expect(raw).toBeGreaterThan(1)
  })
  it('length < 10 → null', () => {
    const tv = Array.from({ length: 9 }, (_, i) => i + 1)
    expect(feature.compute(makeCtx(tv))).toBe(null)
  })
  it('history with 50-item input: length <= 30', () => {
    const tv = Array.from({ length: 50 }, (_, i) => i + 1)
    const hist = feature.history(makeCtx(tv))
    expect(hist.length).toBeLessThanOrEqual(30)
  })
})
