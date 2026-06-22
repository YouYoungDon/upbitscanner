import { describe, it, expect } from 'vitest'
import { applyCombos, detectSignals, volComboMult, volumeGrade, fallingKnifePenalty } from '../lib/signals.mjs'

describe('volComboMult', () => {
  it('구간별 배수: null→1.3, 3x→1.3, 15x→1.45, 25x→1.6', () => {
    expect(volComboMult(null)).toBe(1.3)
    expect(volComboMult(3)).toBe(1.3)
    expect(volComboMult(15)).toBe(1.45)
    expect(volComboMult(25)).toBe(1.6)
  })
})

describe('volumeGrade', () => {
  it('계단 등급: <2→0, 2x→1, 7x→2, 15x→3, 30x→4', () => {
    expect(volumeGrade(1.5)).toBe(0)
    expect(volumeGrade(2)).toBe(1)
    expect(volumeGrade(7)).toBe(2)
    expect(volumeGrade(15)).toBe(3)
    expect(volumeGrade(30)).toBe(4)
  })
})

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

  it('거래량 배수가 구간 따라 비례: 20x+ → ×1.6', () => {
    const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (25.0x)']
    const { buyScore } = applyCombos(buy, [], 10, 25)
    expect(buyScore).toBeCloseTo(10 * 1.4 * 1.6, 5)
  })

  it('거래량 배수 기본(2~10x) → ×1.3 유지', () => {
    const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (3.0x)']
    const { buyScore } = applyCombos(buy, [], 10, 3)
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

  it('강세 캔들패턴(망치형)이 있으면 매수 신호/점수에 반영', () => {
    const base = Array.from({ length: 59 }, (_, i) => {
      const close = 200 - i
      return { open: close + 1, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const hammer = { open: 141, high: 141.5, low: 135, close: 141, volume: 10 }
    const r = detectSignals([...base, hammer], {})
    expect(r.buy.some((s) => s.startsWith('캔들'))).toBe(true)
  })

  it('거래량 배율 등급: 10~20x 상승 → +3점 + volRatio 반환', () => {
    // 59봉 횡보(거래량 10) + 마지막 봉 +3% 상승 & 거래량 150(=15x)
    const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
    const spike = { open: 100, close: 103, high: 104, low: 100, volume: 150 }
    const r = detectSignals([...base, spike], {})
    const volLabel = r.buy.find((s) => s.startsWith('거래량 급증'))
    expect(volLabel).toBeTruthy()
    expect(r.volRatio).toBeGreaterThan(10)
    expect(r.buyScore).toBeGreaterThanOrEqual(3) // 15x → grade 3 가산 반영
  })

  it('거래량 급증해도 상승 +2% 미만이면 매수 거래량 신호 미부여', () => {
    const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
    const weak = { open: 100, close: 100.5, high: 101, low: 99, volume: 150 } // +0.5%
    const r = detectSignals([...base, weak], {})
    expect(r.buy.some((s) => s.startsWith('거래량 급증'))).toBe(false)
  })

  it('거래량 급증 + 하락이면 매도 거래량 신호 부여', () => {
    const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
    const drop = { open: 100, close: 99, high: 101, low: 98, volume: 150 } // -1%, 15x
    const r = detectSignals([...base, drop], {})
    expect(r.sell.some((s) => s.startsWith('거래량 급증'))).toBe(true)
  })

  it('buyItems/sellItems 분해: 각 항목 score=base×weight, 합이 점수와 일치', () => {
    // RSI 과매도(base 3) 유발: 50봉 하락
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 200 - i * 2
      return { open: close, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const weights = { 'RSI 과매도': 1.2 }
    const r = detectSignals(ohlcv, weights)
    expect(Array.isArray(r.buyItems)).toBe(true)
    for (const it of r.buyItems) {
      expect(it).toHaveProperty('label')
      expect(it).toHaveProperty('base')
      expect(it).toHaveProperty('weight')
      expect(it.score).toBeCloseTo(it.base * it.weight, 5)
    }
    const sumBuy = r.buyItems.reduce((a, b) => a + b.score, 0)
    expect(sumBuy).toBeCloseTo(r.buyScore, 5)
    const rsiItem = r.buyItems.find((x) => x.label.startsWith('RSI 과매도'))
    if (rsiItem) expect(rsiItem.weight).toBeCloseTo(1.2, 5)
  })
})

describe('fallingKnifePenalty', () => {
  it('골든크로스 + 거래량無 + EMA 하락배열 → ×0.5 감점·라벨', () => {
    const buy = ['Stoch 과매도 골든크로스 (8)', 'RSI 과매도 (29)']
    const sell = ['EMA 하락배열']
    const r = fallingKnifePenalty(buy, sell)
    expect(r.mult).toBe(0.5)
    expect(r.label).toMatch(/떨어지는칼/)
  })
  it('거래량 동반이면 감점 없음 (진짜 반등)', () => {
    const buy = ['Stoch 과매도 골든크로스 (8)', '거래량 급증 (5.0x)']
    const sell = ['EMA 하락배열']
    expect(fallingKnifePenalty(buy, sell)).toEqual({ mult: 1, label: null })
  })
  it('EMA 하락배열 아니면 감점 없음 (추세 살아있음)', () => {
    const buy = ['Stoch 과매도 골든크로스 (8)']
    const sell = ['BB 상단 돌파']
    expect(fallingKnifePenalty(buy, sell)).toEqual({ mult: 1, label: null })
  })
  it('골든크로스 없으면 감점 없음 (반등신호 자체가 약함)', () => {
    const buy = ['RSI 과매도 (29)', 'BB 하단 지지']
    const sell = ['EMA 하락배열']
    expect(fallingKnifePenalty(buy, sell)).toEqual({ mult: 1, label: null })
  })
})

describe('applyCombos breakdown', () => {
  it('combos 배열로 각 콤보의 배수를 반환', () => {
    const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (2.5x)']
    const { combos } = applyCombos(buy, [], 10)
    expect(Array.isArray(combos)).toBe(true)
    expect(combos.find((c) => c.label.includes('반등확인'))?.mult).toBeCloseTo(1.4, 5)
    expect(combos.find((c) => c.label.includes('거래량확인'))?.mult).toBeCloseTo(1.3, 5)
  })

  it('콤보 없으면 combos 빈 배열', () => {
    const { combos } = applyCombos(['BB 하단 지지'], [], 2)
    expect(combos).toEqual([])
  })
})
