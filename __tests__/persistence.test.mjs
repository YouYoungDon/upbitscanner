import { describe, it, expect } from 'vitest'
import { appearanceStreak, scorePersistence, dailySnapshots } from '../lib/persistence.mjs'

const DAY = 86400000
const NOW = Date.parse('2026-10-07T12:00:00Z') // UTC 일 D
const at = (daysAgo, hour = 0) => new Date(NOW - daysAgo * DAY - (12 - hour) * 3600000).toISOString()
const scan = (ts, markets, volMarkets = []) => ({
  timestamp: ts,
  buy: markets.map((m) => ({ market: m, signals: volMarkets.includes(m) ? ['거래량 급증 (3.0x)'] : [] })),
})

describe('dailySnapshots', () => {
  it('같은 UTC 일은 마지막 스캔 하나로 접고, 오늘(=같은 봉)은 제외', () => {
    const prior = [scan(at(1, 0), ['KRW-A']), scan(at(1, 21), []), scan(at(0, 3), ['KRW-A'])]
    const snaps = dailySnapshots(prior, NOW)
    expect(snaps).toHaveLength(1)
    expect(snaps[0].scan.buy).toEqual([])
  })
  it('timestamp 없는 스캔은 버림', () => {
    expect(dailySnapshots([{ buy: [] }], NOW)).toEqual([])
  })
})

describe('appearanceStreak (일 단위)', () => {
  it('어제부터 거꾸로 연속 등장 일수', () => {
    const prior = [scan(at(3), ['KRW-A']), scan(at(2), ['KRW-A']), scan(at(1), ['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior, NOW)).toBe(3)
  })
  it('회귀: 같은 날 스캔 3번은 3회가 아니다 — 오늘 스캔은 세지 않음', () => {
    const prior = [scan(at(0, 0), ['KRW-A']), scan(at(0, 3), ['KRW-A']), scan(at(0, 6), ['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior, NOW)).toBe(0)
  })
  it('회귀: 어제 하루 안의 여러 스캔은 1일로 셈', () => {
    const prior = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => scan(at(1, h), ['KRW-A']))
    expect(appearanceStreak('KRW-A', prior, NOW)).toBe(1)
  })
  it('중간 날 빠지면 끊김', () => {
    const prior = [scan(at(3), ['KRW-A']), scan(at(2), []), scan(at(1), ['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior, NOW)).toBe(1)
  })
  it('스캔이 없던 날(공백)도 끊김', () => {
    const prior = [scan(at(3), ['KRW-A']), scan(at(1), ['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior, NOW)).toBe(1)
  })
  it('어제 스캔이 없으면 0', () => {
    expect(appearanceStreak('KRW-A', [scan(at(2), ['KRW-A'])], NOW)).toBe(0)
  })
  it('빈 이력 → 0', () => {
    expect(appearanceStreak('KRW-A', [], NOW)).toBe(0)
  })
})

describe('scorePersistence', () => {
  it('회귀: 거래량 관련 라벨은 더 이상 붙지 않음(근거 신호 제거)', () => {
    const prior = [scan(at(1), ['KRW-A'], ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A' }, prior, NOW)
    expect(r.signals.some((x) => x.includes('거래량'))).toBe(false)
  })
  it('3일 연속 → +2', () => {
    const prior = [scan(at(3), ['KRW-A']), scan(at(2), ['KRW-A']), scan(at(1), ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A' }, prior, NOW)
    expect(r.bonus).toBe(2)
    expect(r.signals).toContain('🔥지속 매수권 (3일+)')
  })
  it('2일 연속 → +1 (3일 라벨과 중복 없음)', () => {
    const prior = [scan(at(3), []), scan(at(2), ['KRW-A']), scan(at(1), ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A' }, prior, NOW)
    expect(r.bonus).toBe(1)
    expect(r.signals).toContain('지속 매수권 (2일)')
    expect(r.signals).not.toContain('🔥지속 매수권 (3일+)')
  })
  it('빈 이력 → bonus 0, 라벨 없음', () => {
    const r = scorePersistence({ market: 'KRW-A' }, [], NOW)
    expect(r).toEqual({ bonus: 0, signals: [] })
  })
})
