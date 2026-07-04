import { describe, it, expect } from 'vitest'
import { buildContexts, runScoringShadow } from '../../lib/scoring/context.mjs'

const reg = [{ name: 'rv', defaultGroup: 'early', normalizer: 'percentileVsUniverse', compute: (c) => c.coin.ticker.acc_trade_price_24h }]
const config = { version: 'scoring-v1', weights: { rv: 1 }, groups: { rv: 'early' }, tierCutoffs: { S: 85, A: 70, B: 55, C: 40 }, thresholds: { earlyHigh: 70, confirmHigh: 60, extensionLow: 0.15, extensionCap: 0.3 }, regimeMultiplier: {}, archiveTopN: 1 }

describe('buildContexts', () => {
  it('candleMap + tickerMap → ctx 배열', () => {
    const ctxs = buildContexts(['KRW-A'], { 'KRW-A': [{ close: 1, high: 1, low: 1, open: 1, volume: 1, tradeValue: 1 }] }, { 'KRW-A': { trade_price: 1, acc_trade_price_24h: 5e8 } }, { btcTrend: 'neutral' })
    expect(ctxs[0].coin.market).toBe('KRW-A')
    expect(ctxs[0].coin.ticker.acc_trade_price_24h).toBe(5e8)
  })
})

describe('runScoringShadow', () => {
  const cmap = { 'KRW-A': [{ close: 1 }], 'KRW-B': [{ close: 1 }] }
  const tmap = { 'KRW-A': { acc_trade_price_24h: 9e8 }, 'KRW-B': { acc_trade_price_24h: 1e8 } }
  it('정상: earlyScore top-N ∪ buy 후보(중복 제거) 저장', () => {
    const res = runScoringShadow(['KRW-A', 'KRW-B'], cmap, tmap, { btcTrend: 'neutral' }, reg, config, ['KRW-B'])
    expect(res.scoringError).toBeUndefined()
    expect(res.scoring.map((s) => s.market).sort()).toEqual(['KRW-A', 'KRW-B'])
    expect(res.scoringMeta.universeSize).toBe(2)
  })
  it('buy 후보 없으면 top-N만', () => {
    const res = runScoringShadow(['KRW-A', 'KRW-B'], cmap, tmap, { btcTrend: 'neutral' }, reg, config, [])
    expect(res.scoring.map((s) => s.market)).toEqual(['KRW-A'])
  })
  it('config null → scoringError, throw 안 함', () => {
    const res = runScoringShadow(['KRW-A'], cmap, tmap, { btcTrend: 'neutral' }, reg, null, [])
    expect(res.scoringError).toBeDefined()
    expect(res.scoring).toBeUndefined()
  })
})
