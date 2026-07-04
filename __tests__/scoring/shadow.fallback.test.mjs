import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/scoring/engine.mjs', () => ({ scoreUniverse: () => { throw new Error('engine boom') } }))
import { runScoringShadow } from '../../lib/scoring/context.mjs'

describe('runScoringShadow fallback (engine throws)', () => {
  const cfg = { version: 'scoring-v1', archiveTopN: 5 }
  it('scoreUniverse가 throw해도 runScoringShadow는 throw하지 않고 scoringError만 남긴다', () => {
    const res = runScoringShadow(['KRW-A'], { 'KRW-A': [{ close: 1 }] }, { 'KRW-A': { acc_trade_price_24h: 1 } }, { btcTrend: 'neutral' }, [], cfg, [])
    expect(res.scoringError).toBeDefined()
    expect(res.scoringError.message).toContain('engine boom')
    expect(res.scoring).toBeUndefined()
  })
})
