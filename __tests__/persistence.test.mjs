import { describe, it, expect } from 'vitest'
import { appearanceStreak, scorePersistence } from '../lib/persistence.mjs'

const scan = (markets, volMarkets = []) => ({
  buy: markets.map((m) => ({ market: m, signals: volMarkets.includes(m) ? ['거래량 급증 (3.0x)'] : [] })),
})

describe('appearanceStreak', () => {
  it('최신부터 연속 등장 횟수', () => {
    const prior = [scan(['KRW-A']), scan(['KRW-A']), scan(['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior)).toBe(3)
  })
  it('중간에 빠지면 끊김(최신쪽만 카운트)', () => {
    const prior = [scan(['KRW-A']), scan([]), scan(['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior)).toBe(1)
  })
  it('빈 이력 → 0', () => {
    expect(appearanceStreak('KRW-A', [])).toBe(0)
  })
})

describe('scorePersistence', () => {
  it('3회 연속 → +2', () => {
    const prior = [scan(['KRW-A']), scan(['KRW-A']), scan(['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: false }, prior)
    expect(r.bonus).toBe(2)
    expect(r.signals).toContain('🔥지속 매수권 (3회+)')
  })
  it('2회 연속 → +1 (3회 라벨과 중복 없음)', () => {
    const prior = [scan([]), scan(['KRW-A']), scan(['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: false }, prior)
    expect(r.bonus).toBe(1)
    expect(r.signals).toContain('지속 매수권 (2회)')
    expect(r.signals).not.toContain('🔥지속 매수권 (3회+)')
  })
  it('이번+직전 거래량 급증 → 거래량 지속 +1', () => {
    const prior = [scan(['KRW-A'], ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: true }, prior)
    expect(r.signals).toContain('거래량 지속')
    expect(r.bonus).toBe(1) // streak 1회(보너스 없음) + 거래량 지속 1
  })
  it('직전 급증·이번 소멸 → 경고만, bonus 0', () => {
    const prior = [scan(['KRW-A'], ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: false }, prior)
    expect(r.signals).toContain('⚠️거래량 소멸 (1회성)')
    expect(r.bonus).toBe(0)
  })
  it('빈 이력 → bonus 0, 라벨 없음', () => {
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: true }, [])
    expect(r).toEqual({ bonus: 0, signals: [] })
  })
})
