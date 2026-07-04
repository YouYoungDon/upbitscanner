import { describe, it, expect } from 'vitest'
import { scoreUniverse } from '../../lib/scoring/engine.mjs'

const feat = (name, group, norm, fn, params) => ({ name, defaultGroup: group, normalizer: norm, compute: fn, params })
const reg = [
  feat('rv', 'early', 'percentileVsUniverse', (c) => c.v),
  feat('bs', 'confirm', 'fixedCurve', () => 3, [[0, 0], [3, 100]]),
]
const config = {
  version: 'scoring-v1', weights: { rv: 1, bs: 1 }, groups: { rv: 'early', bs: 'confirm' },
  tierCutoffs: { S: 85, A: 70, B: 55, C: 40 }, thresholds: { earlyHigh: 70, confirmHigh: 60, extensionLow: 0.15, extensionCap: 0.3 },
  regimeMultiplier: { bull: 1.1, neutral: 1.0, bear: 0.9 }, qualityGuard: {},
}

describe('scoreUniverse', () => {
  const ctxs = () => [10, 20, 30].map((v) => ({ coin: { market: 'C' + v, ohlcvDaily: Array.from({ length: 30 }, () => ({ close: 100 })) }, v }))
  it('코인별 완전한 scoring 객체 생성 (neutral: multiplier 1.0)', () => {
    const top = scoreUniverse(ctxs(), reg, config, { btcTrend: 'neutral' }).find((o) => o.market === 'C30')
    expect(top.version).toBe('scoring-v1')
    for (const k of ['earlyScoreRaw', 'extensionPenalty', 'earlyScoreAfterExtension', 'regimeMultiplier', 'timeMultiplier', 'earlyScore', 'confirmScore', 'tier', 'contextLabel']) expect(top).toHaveProperty(k)
    expect(top.confidence.type).toBe('heuristic')
    expect(top.features.rv.normalized).toBe(100)
    expect(top.earlyScoreRaw).toBe(100)
    expect(top.extensionPenalty).toBeCloseTo(0, 2)
    expect(top.earlyScoreAfterExtension).toBe(100)
    expect(top.earlyScore).toBe(100)
  })
  it('bear regimeMultiplier(0.9)가 earlyScore에 실제 곱해진다', () => {
    const top = scoreUniverse(ctxs(), reg, config, { btcTrend: 'bear' }).find((o) => o.market === 'C30')
    expect(top.regimeMultiplier).toBe(0.9)
    expect(top.earlyScoreAfterExtension).toBe(100)
    expect(top.earlyScore).toBe(90)
  })
})
