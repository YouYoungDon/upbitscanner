import { describe, it, expect } from 'vitest'
import { readableSignals } from '../lib/signal-format.mjs'

describe('readableSignals', () => {
  it('골든크로스(Stoch·MACD)·거래량·지속을 근거로 추출', () => {
    const r = readableSignals(['Stoch 과매도 골든크로스 (11)', 'MACD 골든크로스', '거래량 급증 (10.0x)', '🔥지속 매수권 (3회+)'])
    expect(r.reasons).toContain('골든크로스(Stoch·MACD)')
    expect(r.reasons).toContain('거래량 10.0배')
    expect(r.reasons.some((x) => x.includes('지속'))).toBe(true)
  })
  it('추격주의·업비트비중을 경고로 분리', () => {
    const r = readableSignals(['거래량 급증 (43.4x)', '⚠️추격주의(급등후)', '⚠️업비트비중 53%'])
    expect(r.warns).toContain('추격주의(급등후)')
    expect(r.warns.some((x) => x.includes('업비트비중'))).toBe(true)
  })
  it('과매도만 있고 골든크로스 없으면 "과매도 반등"', () => {
    expect(readableSignals(['RSI 과매도 (29)']).reasons).toContain('과매도 반등')
  })
  it('🎯전략 태그 → strategy true', () => {
    expect(readableSignals(['🎯전략(조용한바닥)']).strategy).toBe(true)
  })
  it('빈 입력 안전', () => {
    expect(readableSignals(null)).toEqual({ reasons: [], warns: [], strategy: false })
  })
})
