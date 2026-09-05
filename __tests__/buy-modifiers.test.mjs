import { describe, it, expect } from 'vitest'
import { applyBuyModifiers } from '../lib/buy-modifiers.mjs'

// 충분히 유동적·정상 컨텍스트(감점 요소 없음) 기본값
const base = () => ({
  regimeTrend: 'neutral',
  tradePrice24h: 5_000_000_000, // 50억 → 유동성 감점 없음
  globalVolKrw: 1e12,           // dominance 감점 없음
  sellSignals: [],
  volRatio: 1,
  pump: false,
  fundingRate: 0,
  circRatio: 1, athChangePct: -20, rank: 5, caution: false,
})

describe('applyBuyModifiers', () => {
  it('정상 컨텍스트 → 점수·시그널 불변', () => {
    const r = applyBuyModifiers(10, ['RSI 과매도'], base())
    expect(r.score).toBe(10)
    expect(r.signals).toEqual(['RSI 과매도'])
    expect(r.funding.mult).toBe(1)
    expect(r.structuralRisk.mult).toBe(1)
  })
  it('입력 배열 불변(순수)', () => {
    const sig = ['RSI 과매도']
    applyBuyModifiers(10, sig, { ...base(), regimeTrend: 'bear' })
    expect(sig).toEqual(['RSI 과매도']) // 원본 미변경
  })
  it('레짐 약세 ×0.85 + 시그널', () => {
    const r = applyBuyModifiers(10, [], { ...base(), regimeTrend: 'bear' })
    expect(r.score).toBeCloseTo(8.5, 6)
    expect(r.signals).toContain('[레짐] BTC 약세 감점')
  })
  it('펀딩 과열(+) 감점·시그널', () => {
    const r = applyBuyModifiers(10, [], { ...base(), fundingRate: 0.0012 })
    expect(r.score).toBeCloseTo(8.2, 6) // ×0.82
    expect(r.funding).toEqual({ rate: 0.0012, mult: 0.82 })
    expect(r.signals.some((s) => s.includes('펀딩 과열'))).toBe(true)
  })
  it('펀딩 스퀴즈(−) 가산', () => {
    const r = applyBuyModifiers(10, [], { ...base(), fundingRate: -0.0012 })
    expect(r.score).toBeCloseTo(10.6, 6) // ×1.06
    expect(r.signals.some((s) => s.includes('스퀴즈연료'))).toBe(true)
  })
  it('구조리스크(언락 오버행+주의) 감점·시그널·item용 반환', () => {
    const r = applyBuyModifiers(10, [], { ...base(), circRatio: 0.41, caution: true })
    expect(r.score).toBeCloseTo(10 * 0.93 * 0.90, 5) // 8.37
    expect(r.structuralRisk.level).toBe('mid')
    expect(r.signals.some((s) => s.includes('구조리스크'))).toBe(true)
    expect(r.signals.some((s) => s.includes('언락오버행'))).toBe(true)
  })
  it('배수 합성 순서 무관(곱) — 레짐+펀딩+구조', () => {
    const r = applyBuyModifiers(10, [], { ...base(), regimeTrend: 'bear', fundingRate: 0.0012, circRatio: 0.2 })
    expect(r.score).toBeCloseTo(10 * 0.85 * 0.82 * 0.85, 5)
  })
  it('item용 필드 반환(dom·funding·structuralRisk·lowLiq)', () => {
    const r = applyBuyModifiers(10, [], base())
    expect(r).toHaveProperty('dom')
    expect(r).toHaveProperty('funding')
    expect(r).toHaveProperty('structuralRisk')
    expect(r).toHaveProperty('lowLiq')
  })
})
