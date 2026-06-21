import { describe, it, expect } from 'vitest'
import { shouldAlert, updateAlertState } from '../lib/flow-alert.mjs'

const cfg = { suppressMs: 6 * 60 * 60 * 1000, reAlertRatio: 1.3 }
const now = 1_000_000_000_000

describe('shouldAlert', () => {
  it('신규 종목 → true', () => {
    expect(shouldAlert({ market: 'KRW-A', score: 50, now }, {}, cfg)).toBe(true)
  })
  it('억제창 내 + 점수 미상승 → false', () => {
    const state = { 'KRW-A': { lastScore: 50, lastAlertTs: now - 1000 } }
    expect(shouldAlert({ market: 'KRW-A', score: 55, now }, state, cfg)).toBe(false)
  })
  it('억제창 내 + 점수 30%↑ → true', () => {
    const state = { 'KRW-A': { lastScore: 50, lastAlertTs: now - 1000 } }
    expect(shouldAlert({ market: 'KRW-A', score: 65, now }, state, cfg)).toBe(true)
  })
  it('억제창 경과 → true', () => {
    const state = { 'KRW-A': { lastScore: 50, lastAlertTs: now - cfg.suppressMs - 1 } }
    expect(shouldAlert({ market: 'KRW-A', score: 40, now }, state, cfg)).toBe(true)
  })
})

describe('updateAlertState', () => {
  it('종목 상태 갱신(불변)', () => {
    const s0 = {}
    const s1 = updateAlertState(s0, 'KRW-A', 60, now)
    expect(s1['KRW-A']).toEqual({ lastScore: 60, lastAlertTs: now })
    expect(s0).toEqual({}) // 원본 불변
  })
})
