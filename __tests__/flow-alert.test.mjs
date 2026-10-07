import { describe, it, expect } from 'vitest'
import { shouldAlert, updateAlertState, selectFlowAlerts, formatFlowAlert } from '../lib/flow-alert.mjs'

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

// 2026-10-07: 5분봉 61일 재생에서 자금유입 경보는 급등(×2.3)보다 급락(×11.4)을 더 앞섰다 —
// 매수 신호가 아니라 급변동 신호. 보유 코인 리스크 알림으로만 쓴다.
describe('selectFlowAlerts (보유 코인 급변동 경보)', () => {
  const picks = [
    { market: 'KRW-A', level: 'strong', score: 60 },
    { market: 'KRW-B', level: 'attention', score: 50 },
    { market: 'KRW-C', level: 'watch', score: 40 },
  ]
  it('보유하지 않은 종목은 알림하지 않음', () => {
    expect(selectFlowAlerts(picks, new Set(), {}, cfg, now)).toEqual([])
  })
  it('보유 종목 중 strong/attention만', () => {
    const r = selectFlowAlerts(picks, new Set(['KRW-A', 'KRW-C']), {}, cfg, now)
    expect(r.map((p) => p.market)).toEqual(['KRW-A'])
  })
  it('억제창 규칙 유지', () => {
    const state = { 'KRW-A': { lastScore: 60, lastAlertTs: now - 1000 } }
    expect(selectFlowAlerts(picks, new Set(['KRW-A']), state, cfg, now)).toEqual([])
  })
})

describe('formatFlowAlert', () => {
  it('매수 신호가 아님을 명시하고 급변동 경보로 표기', () => {
    const msg = formatFlowAlert([{ market: 'KRW-A', korean_name: '에이', level: 'strong', ratio: 3.2, accel: 1.6, breakout: true }], '2026. 10. 7. 오후 10:00')
    expect(msg).toContain('급변동 경보')
    expect(msg).toContain('매수 신호 아님')
    expect(msg).toContain('보유')
    expect(msg).toContain('에이(A)')
    expect(msg).not.toMatch(/자금유입 2026/)
  })
})
