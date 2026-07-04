import { describe, it, expect } from 'vitest'
import { tierFor, contextLabelFor, assessConfidence } from '../../lib/scoring/engine.mjs'

const cuts = { S: 85, A: 70, B: 55, C: 40 }
describe('tierFor', () => {
  it('earlyScore 기준 티어', () => {
    expect(tierFor(90, cuts)).toBe('S')
    expect(tierFor(72, cuts)).toBe('A')
    expect(tierFor(41, cuts)).toBe('C')
    expect(tierFor(30, cuts)).toBe(null)
    expect(tierFor(null, cuts)).toBe(null)
  })
})
describe('contextLabelFor', () => {
  const th = { earlyHigh: 70, confirmHigh: 60 }
  it('4상태 매트릭스', () => {
    expect(contextLabelFor(80, 40, th)).toBe('early_inflow_unconfirmed')
    expect(contextLabelFor(80, 70, th)).toBe('early_inflow_with_confirmation')
    expect(contextLabelFor(50, 70, th)).toBe('breakout_already_confirmed')
    expect(contextLabelFor(50, 40, th)).toBe('weak_signal')
  })
})
describe('assessConfidence', () => {
  const th = { thresholds: { extensionLow: 0.15 } }
  const early = { a: 80, b: 75, c: 90, d: 72, e: 80 }
  it('early 다수 강함 + 낮은 penalty + quality 충분 + coverage 충분 → high, quality reason 구분', () => {
    const r = assessConfidence({ earlyNormalized: early, extensionPenalty: 0.05, coverage: 1, qualityGuards: { liquidity: 60, abs_trading_value: 55 }, config: th })
    expect(r.type).toBe('heuristic')
    expect(r.label).toBe('high')
    expect(r.reasons).toContain('liquidity sufficient')
    expect(r.reasons).toContain('absolute trading value sufficient')
  })
  it('quality 둘 다 낮으면 하향 + 별도 reason', () => {
    const r = assessConfidence({ earlyNormalized: early, extensionPenalty: 0.05, coverage: 1, qualityGuards: { liquidity: 20, abs_trading_value: 10 }, config: th })
    expect(r.label).not.toBe('high')
    expect(r.reasons.some((x) => x.includes('both quality guards low'))).toBe(true)
  })
  it('coverage 낮으면 label 하향', () => {
    const r = assessConfidence({ earlyNormalized: early, extensionPenalty: 0.05, coverage: 0.4, qualityGuards: { liquidity: 60, abs_trading_value: 55 }, config: th })
    expect(r.label).not.toBe('high')
    expect(r.reasons.some((x) => x.toLowerCase().includes('coverage'))).toBe(true)
  })
})
