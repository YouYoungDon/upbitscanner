import { describe, it, expect } from 'vitest'
import { computeExtensionPenalty, applyExtension } from '../../lib/scoring/engine.mjs'

const ctx = (closes) => ({ coin: { ohlcvDaily: closes.map((c) => ({ close: c })) } })

describe('extension penalty', () => {
  it('EMA20 근처 → 낮은 penalty', () => {
    const closes = Array.from({ length: 30 }, () => 100)
    expect(computeExtensionPenalty(ctx(closes), { thresholds: { extensionCap: 0.3 } })).toBeCloseTo(0, 2)
  })
  it('EMA20 대비 크게 상승 → 높은 penalty(캡 1)', () => {
    const closes = Array.from({ length: 29 }, () => 100).concat([200])
    expect(computeExtensionPenalty(ctx(closes), { thresholds: { extensionCap: 0.3 } })).toBe(1)
  })
  it('applyExtension: earlyScore = raw × (1 − penalty)', () => {
    expect(applyExtension(80, 0.25)).toBe(60)
  })
  it('raw null → null 유지', () => {
    expect(applyExtension(null, 0.2)).toBe(null)
  })
})
