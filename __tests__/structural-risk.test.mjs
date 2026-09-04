import { describe, it, expect } from 'vitest'
import { structuralRisk, OVERHANG_SEVERE, OVERHANG_ELEVATED, MULT_FLOOR } from '../lib/structural-risk.mjs'

describe('structuralRisk', () => {
  it('소폰형(언락오버행+거래소주의) → 감점·플래그·mid', () => {
    const r = structuralRisk({ circRatio: 0.413, athChangePct: -97, rank: 946, caution: true })
    expect(r.mult).toBeCloseTo(0.93 * 0.90, 5) // 0.837
    expect(r.flags.some((f) => f.includes('언락오버행'))).toBe(true)
    expect(r.flags.some((f) => f.includes('거래소 주의'))).toBe(true)
    expect(r.flags.some((f) => f.includes('ATH'))).toBe(true)
    expect(r.flags.some((f) => f.includes('저순위'))).toBe(true)
    expect(r.level).toBe('mid')
  })
  it('심각 언락(circRatio<0.3) → ×0.85', () => {
    const r = structuralRisk({ circRatio: 0.2 })
    expect(r.mult).toBe(0.85)
    expect(r.level).toBe('mid')
  })
  it('정상(완전유통·무지정) → 감점 없음', () => {
    const r = structuralRisk({ circRatio: 1, athChangePct: -30, rank: 5, caution: false })
    expect(r.mult).toBe(1)
    expect(r.flags).toEqual([])
    expect(r.level).toBe('none')
  })
  it('circRatio 경계값', () => {
    expect(structuralRisk({ circRatio: 0.29 }).mult).toBe(0.85) // <0.3 심각
    expect(structuralRisk({ circRatio: 0.3 }).mult).toBe(0.93)  // 0.3~0.5
    expect(structuralRisk({ circRatio: 0.5 }).mult).toBe(1)     // ≥0.5 정상
  })
  it('거래소 주의 단독 → ×0.90 low', () => {
    const r = structuralRisk({ circRatio: 0.8, caution: true })
    expect(r.mult).toBe(0.90)
    expect(r.level).toBe('low')
  })
  it('하한 캡 0.7 미만으로 안 내려감', () => {
    // 현 요소로는 0.85*0.90=0.765가 최저 — 캡(0.7) 위. 캡 상수 노출 확인.
    expect(MULT_FLOOR).toBe(0.7)
    expect(structuralRisk({ circRatio: 0.2, caution: true }).mult).toBeGreaterThanOrEqual(0.7)
  })
  it('null 안전 — coingecko 미커버', () => {
    const r = structuralRisk({ circRatio: null, athChangePct: null, rank: null, caution: false })
    expect(r.mult).toBe(1)
    expect(r.flags).toEqual([])
    expect(r.level).toBe('none')
  })
  it('컨텍스트 플래그만(오버행 없음) → 감점 없이 표시만', () => {
    const r = structuralRisk({ circRatio: 0.8, athChangePct: -95, rank: 900, caution: false })
    expect(r.mult).toBe(1) // 언락·주의 없으니 감점 0
    expect(r.flags.some((f) => f.includes('ATH'))).toBe(true)
    expect(r.flags.some((f) => f.includes('저순위'))).toBe(true)
    expect(r.flags.some((f) => f.includes('언락오버행'))).toBe(false)
    expect(r.level).toBe('none')
  })
  it('상수 노출', () => {
    expect(OVERHANG_SEVERE).toBe(0.3)
    expect(OVERHANG_ELEVATED).toBe(0.5)
  })
})
