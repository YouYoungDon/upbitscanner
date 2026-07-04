import { describe, it, expect } from 'vitest'
import { computeRaws, buildUniverseDist, scoreCoin, weightedAverage } from '../../lib/scoring/engine.mjs'

const feat = (name, group, norm, computeFn, hist) => ({ name, defaultGroup: group, normalizer: norm, compute: computeFn, history: hist })
const reg = [
  feat('a', 'early', 'percentileVsUniverse', (ctx) => ctx.v),
  feat('b', 'confirm', 'fixedCurve', () => 50),
]
const config = { weights: { a: 1, b: 1 }, groups: { a: 'early', b: 'confirm' } }
// b는 fixedCurve params가 feature.params에 있어야 함 → 테스트용 params 주입
reg[1].params = [[0, 0], [100, 100]]

describe('weightedAverage', () => {
  it('null feature 제외 후 가중평균', () => {
    expect(weightedAverage([{ normalized: 80, weight: 1 }, { normalized: null, weight: 3 }, { normalized: 40, weight: 1 }])).toBe(60)
  })
  it('전부 null → null', () => {
    expect(weightedAverage([{ normalized: null, weight: 1 }])).toBe(null)
  })
})

describe('two-pass scoring', () => {
  it('유니버스 백분위 + 그룹별 가중평균', () => {
    const coins = [{ market: 'X', v: 10 }, { market: 'Y', v: 20 }, { market: 'Z', v: 30 }]
    const ctxs = coins.map((c) => ({ coin: { market: c.market }, v: c.v }))
    const raws = computeRaws(ctxs, reg)
    const dist = buildUniverseDist(raws, reg, config)
    const zResult = scoreCoin(ctxs[2], raws[2], dist, reg, config) // v=30 → a 백분위 100
    expect(zResult.features.a.normalized).toBe(100)
    expect(zResult.features.a.group).toBe('early')
    expect(zResult.earlyScoreRaw).toBe(100)     // early엔 a만
    expect(zResult.confirmScore).toBe(50)        // confirm엔 b(fixedCurve→50)
  })
})
