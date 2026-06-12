import { describe, it, expect } from 'vitest'
import { applyCombos, detectSignals } from '../lib/signals.mjs'

describe('applyCombos', () => {
  it('StochGC 없이 과매도 4종 동시 → ×0.55 페널티', () => {
    const buy = [
      'RSI 과매도 (<30)',
      'BB 하단 지지',
      'Stoch 과매도 (15)',
      'Williams %R 과매도 (-90)',
    ]
    const { buyScore, buy: out } = applyCombos(buy, [], 10)
    expect(buyScore).toBeCloseTo(5.5, 5)
    expect(out).toContain('[콤보] 과매도 함정 페널티')
  })

  it('StochGC 포함 → ×1.4 보너스, 페널티 면제', () => {
    const buy = [
      'RSI 과매도 (<30)',
      'BB 하단 지지',
      'Stoch 과매도 골든크로스 (5)',
      'Williams %R 과매도 (-90)',
    ]
    const { buyScore, buy: out } = applyCombos(buy, [], 10)
    expect(buyScore).toBeCloseTo(14, 5)
    expect(out).toContain('[콤보] 반등확인 보너스')
    expect(out).not.toContain('[콤보] 과매도 함정 페널티')
  })

  it('거래량 급증 동반 → 추가 ×1.3', () => {
    const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (2.5x)']
    const { buyScore } = applyCombos(buy, [], 10)
    expect(buyScore).toBeCloseTo(10 * 1.4 * 1.3, 5)
  })
})

describe('detectSignals', () => {
  it('buy/sell 배열과 점수를 반환', () => {
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 100 + i
      return { close, high: close + 1, low: close - 1, volume: 10 }
    })
    const r = detectSignals(ohlcv, {})
    expect(r).toHaveProperty('buy')
    expect(r).toHaveProperty('sell')
    expect(typeof r.buyScore).toBe('number')
    expect(typeof r.sellScore).toBe('number')
  })

  it('데드크로스 발생 시 익절 타이밍 태그를 sell에 추가', () => {
    // 상승 50봉 후 마지막 1봉 -4% → MACD 데드크로스 유발
    const closes = []
    for (let i = 0; i < 50; i++) closes.push(100 + i)
    closes.push(149 * 0.96)
    const ohlcv = closes.map((c) => ({ close: c, high: c * 1.01, low: c * 0.99, volume: 10 }))
    const r = detectSignals(ohlcv, {})
    expect(r.sell.some((s) => s.includes('데드크로스'))).toBe(true)
    expect(r.sell).toContain('[익절] Stoch DC — 매도 타이밍')
  })

  it('데드크로스 없으면 익절 태그도 없음', () => {
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 100 + i
      return { close, high: close + 1, low: close - 1, volume: 10 }
    })
    const r = detectSignals(ohlcv, {})
    expect(r.sell).not.toContain('[익절] Stoch DC — 매도 타이밍')
  })
})
