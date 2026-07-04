import { describe, it, expect } from 'vitest'
import { scoreUniverse } from '../../lib/scoring/engine.mjs'
import { runScoringShadow } from '../../lib/scoring/context.mjs'

const config = { version: 'scoring-v1', weights: { rv: 1, tr: 1 }, groups: { rv: 'early', tr: 'confirm' }, tierCutoffs: { S: 85, A: 70, B: 55, C: 40 }, thresholds: { earlyHigh: 70, confirmHigh: 60, extensionLow: 0.15, extensionCap: 0.3 }, regimeMultiplier: {}, archiveTopN: 20 }
const reg = [
  { name: 'rv', defaultGroup: 'early', normalizer: 'percentileVsUniverse', compute: (c) => c.coin.ohlcvDaily.length >= 21 ? c.coin.ohlcvDaily.length : null },
  { name: 'tr', defaultGroup: 'confirm', normalizer: 'fixedCurve', params: [[0, 0], [100, 100]], compute: () => NaN },
]

describe('robustness', () => {
  it('NaN/부족 캔들 feature는 제외되고 엔진은 죽지 않는다', () => {
    const ctxs = [{ coin: { market: 'A', ohlcvDaily: [] } }, { coin: { market: 'B', ohlcvDaily: Array.from({ length: 25 }, () => ({ close: 1 })) } }]
    const out = scoreUniverse(ctxs, reg, config, {})
    const a = out.find((o) => o.market === 'A')
    expect(a.features.rv.normalized).toBe(null)   // 캔들 부족 → 제외
    expect(a.features.tr.normalized).toBe(null)   // NaN → 제외
    expect(a.earlyScoreRaw).toBe(null)            // early 전부 null → null
    expect(a.tier).toBe(null)
  })
  it('shadow는 어떤 입력에도 throw하지 않는다', () => {
    const res = runScoringShadow(['A'], { A: null }, { A: null }, {}, reg, config)
    expect(res.scoringError || res.scoring).toBeDefined()
  })
})
