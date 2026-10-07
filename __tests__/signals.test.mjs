import { describe, it, expect } from 'vitest'
import { applyCombos, detectSignals, volumeGrade, fallingKnifePenalty, SIGNAL_KEYS, PATTERN_SCORE } from '../lib/signals.mjs'

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

  it('회귀: 거래량 급증이 있어도 거래량확인 콤보는 없다(2026-10-07 제거)', () => {
    const { buyScore, combos } = applyCombos(['Stoch 과매도 골든크로스 (5)', '거래량 급증 (25.0x)'], [], 10)
    expect(buyScore).toBeCloseTo(10 * 1.4, 5)
    expect(combos.some((c) => c.label.includes('거래량확인'))).toBe(false)
  })
  // 반등확인 콤보는 Stoch 전용이 아니다 — 'MACD 골든크로스'에도 발동한다.
  // 최초 커밋부터 그런 술어였고 변수명(hasStochGC)만 Stoch였다. 2026-10-06 측정 후
  // 좁히지 않고 유지하기로 결정했으므로(근거는 lib/signals.mjs 주석), 그 결정을 테스트로 고정한다.
  // 이 테스트가 깨지면 누군가 측정 없이 범위를 바꾼 것이다.
  it('[의도] 반등확인 콤보는 MACD 골든크로스에도 발동한다', () => {
    const { buyScore, buy: out } = applyCombos(['MACD 골든크로스'], [], 10)
    expect(buyScore).toBeCloseTo(14, 5)
    expect(out).toContain('[콤보] 반등확인 보너스')
  })
  it('[의도] 골든크로스 계열이 있으면 과매도 함정 페널티가 억제된다(종류 무관)', () => {
    const buy = ['RSI 과매도 (28)', 'BB 하단 지지', 'Stoch 과매도 (15)', 'Williams %R 과매도 (-90)']
    const withoutGC = applyCombos(buy, [], 10)
    expect(withoutGC.buy).toContain('[콤보] 과매도 함정 페널티')
    const withMacdGC = applyCombos([...buy, 'MACD 골든크로스'], [], 10)
    expect(withMacdGC.buy).not.toContain('[콤보] 과매도 함정 페널티')
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

  it('Stoch 과매수 데드크로스 발생 시 익절 타이밍 태그를 sell에 추가', () => {
    // 횡보 40봉 → +4% 3연속 → -1.4%: K>80에서 K가 D를 하향 교차
    const closes = []
    for (let i = 0; i < 40; i++) closes.push(100 + (i % 2 ? 3 : -3))
    for (let i = 0; i < 3; i++) closes.push(closes.at(-1) * 1.04)
    closes.push(closes.at(-1) * 0.986)
    const ohlcv = closes.map((c) => ({ close: c, high: c * 1.01, low: c * 0.99, volume: 10 }))
    const r = detectSignals(ohlcv, {})
    expect(r.sell.some((s) => s.startsWith('Stoch 과매수 데드크로스'))).toBe(true)
    expect(r.sell).toContain('[익절] Stoch DC — 매도 타이밍')
  })

  it('MACD 데드크로스만 있고 Stoch DC가 없으면 Stoch DC 태그를 붙이지 않음', () => {
    // 상승 50봉 후 마지막 1봉 -4% → MACD 데드크로스(Stoch 과매수 DC 아님)
    const closes = []
    for (let i = 0; i < 50; i++) closes.push(100 + i)
    closes.push(149 * 0.96)
    const ohlcv = closes.map((c) => ({ close: c, high: c * 1.01, low: c * 0.99, volume: 10 }))
    const r = detectSignals(ohlcv, {})
    expect(r.sell).toContain('MACD 데드크로스')
    expect(r.sell.some((s) => s.startsWith('Stoch 과매수 데드크로스'))).toBe(false)
    expect(r.sell).not.toContain('[익절] Stoch DC — 매도 타이밍')
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

  it('회귀: 상승 동반 거래량 급증은 매수 신호가 아니다(2026-10-07 제거, 재생상 역방향)', () => {
    const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
    const spike = { open: 100, close: 103, high: 104, low: 100, volume: 150 } // +3%, 15x
    const r = detectSignals([...base, spike], {})
    expect(r.buy.some((s) => s.startsWith('거래량 급증'))).toBe(false)
    expect(r.sell.some((s) => s.startsWith('거래량 급증'))).toBe(false) // 상승이므로 매도 신호도 아님
    expect(r.volRatio).toBeGreaterThan(10) // volRatio는 계속 반환(쉐도우·표시용)
  })
  it('거래량 급증 + 하락이면 매도 거래량 신호 부여', () => {
    const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
    const drop = { open: 100, close: 99, high: 101, low: 98, volume: 150 } // -1%, 15x
    const r = detectSignals([...base, drop], {})
    expect(r.sell.some((s) => s.startsWith('거래량 급증'))).toBe(true)
  })

  it('회귀: 과매도+횡보+거래량 증가여도 거래량 선행 매집 신호는 없다(2026-10-07 제거)', () => {
    const base = Array.from({ length: 59 }, (_, i) => {
      const close = 200 - i * 2
      return { open: close, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const accum = { open: 84, close: 84.3, high: 85, low: 83.5, volume: 130 }
    const r = detectSignals([...base, accum], {})
    expect(r.buy.some((s) => s.startsWith('거래량 선행 매집'))).toBe(false)
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
  it('골든크로스 + EMA 하락배열 → ×0.5 감점·라벨', () => {
    const buy = ['Stoch 과매도 골든크로스 (8)', 'RSI 과매도 (29)']
    const sell = ['EMA 하락배열']
    const r = fallingKnifePenalty(buy, sell)
    expect(r.mult).toBe(0.5)
    expect(r.label).toMatch(/떨어지는칼/)
  })
  it('거래량 급증 라벨이 있어도 예외 없음(매수 거래량 신호 제거 후 측정된 동작)', () => {
    const buy = ['Stoch 과매도 골든크로스 (8)', '거래량 급증 (5.0x)']
    const sell = ['EMA 하락배열']
    expect(fallingKnifePenalty(buy, sell).mult).toBe(0.5)
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
    const buy = ['Stoch 과매도 골든크로스 (5)']
    const { combos } = applyCombos(buy, [], 10)
    expect(Array.isArray(combos)).toBe(true)
    expect(combos.find((c) => c.label.includes('반등확인'))?.mult).toBeCloseTo(1.4, 5)
  })

  it('콤보 없으면 combos 빈 배열', () => {
    const { combos } = applyCombos(['BB 하단 지지'], [], 2)
    expect(combos).toEqual([])
  })
})

describe('신호 정리 (2026-10-07, 18개월 재생 근거)', () => {
  it('제거된 매수 신호 키가 가중치 키 목록에 없다', () => {
    for (const k of ['MACD 반등', 'EMA 20/50 골든크로스', '거래량 선행 매집', '상승삼각형 패턴']) expect(SIGNAL_KEYS).not.toContain(k)
    expect(PATTERN_SCORE['상승삼각형 패턴']).toBeUndefined()
  })
  it('MACD 골든크로스는 한 번만 센다(반등 중복 가산 없음)', () => {
    const closes = []
    for (let i = 0; i < 50; i++) closes.push(150 - i)
    closes.push(101 * 1.06)
    const r = detectSignals(closes.map((c) => ({ close: c, high: c * 1.01, low: c * 0.99, volume: 10 })), {})
    expect(r.buy).toContain('MACD 골든크로스')
    expect(r.buy).not.toContain('MACD 반등')
  })
  it('매도 쪽 MACD 하락전환·EMA 데드크로스는 유지', () => {
    const closes = []
    for (let i = 0; i < 50; i++) closes.push(100 + i)
    closes.push(149 * 0.96)
    const r = detectSignals(closes.map((c) => ({ close: c, high: c * 1.01, low: c * 0.99, volume: 10 })), {})
    expect(r.sell).toContain('MACD 하락전환')
  })
})
