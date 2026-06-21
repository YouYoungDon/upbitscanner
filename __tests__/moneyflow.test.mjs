import { describe, it, expect } from 'vitest'
import { tradingValues, moneyRatio, moneyAcceleration } from '../lib/moneyflow.mjs'
import { pctChange, isPumped, isEarlyZone } from '../lib/moneyflow.mjs'

const ohlcv = (vals) => vals.map((v) => ({ tradeValue: v }))

describe('moneyRatio', () => {
  it('현재 거래대금 / 직전 window 평균', () => {
    const values = [...Array(20).fill(100), 500] // 직전20 평균 100, 현재 500
    expect(moneyRatio(values, 20)).toBe(5)
  })
  it('데이터 부족 → null', () => {
    expect(moneyRatio([100, 200], 20)).toBe(null)
  })
  it('직전 평균 0 → null', () => {
    expect(moneyRatio([...Array(20).fill(0), 500], 20)).toBe(null)
  })
})

describe('moneyAcceleration', () => {
  it('직전 봉 비율 대비 현재 봉 비율(가속)', () => {
    const values = [...Array(20).fill(100), 200, 400]
    const a = moneyAcceleration(values, 20)
    expect(a).toBeGreaterThan(1) // 가속
  })
  it('데이터 부족 → null', () => {
    expect(moneyAcceleration([...Array(20).fill(100)], 20)).toBe(null)
  })
})

describe('tradingValues', () => {
  it('ohlcv에서 tradeValue 추출', () => {
    expect(tradingValues(ohlcv([1, 2, 3]))).toEqual([1, 2, 3])
  })
})

describe('pctChange', () => {
  it('nBack 전 종가 대비 변화율(%)', () => {
    expect(pctChange([100, 110], 1)).toBeCloseTo(10, 5)
    expect(pctChange([100, 103, 90], 2)).toBeCloseTo(-10, 5)
  })
  it('데이터 부족 → null', () => {
    expect(pctChange([100], 1)).toBe(null)
  })
})

describe('isPumped', () => {
  it('5m>+8% 또는 15m>+15%면 true(이미 급등 배제)', () => {
    expect(isPumped(9, 0)).toBe(true)
    expect(isPumped(0, 16)).toBe(true)
    expect(isPumped(3, 5)).toBe(false)
  })
  it('null은 무시', () => {
    expect(isPumped(null, null)).toBe(false)
  })
})

describe('isEarlyZone', () => {
  it('1m 0.5~2.5% & 30m<10%', () => {
    expect(isEarlyZone(1.0, 5)).toBe(true)
    expect(isEarlyZone(3.0, 5)).toBe(false) // 1m 초과
    expect(isEarlyZone(1.0, 12)).toBe(false) // 30m 초과
  })
})

import { breakout20, near24hHigh, isConsolidationBreakout, emaAligned, rsiOk } from '../lib/moneyflow.mjs'

const bar = (high, low, close) => ({ high, low, close })

describe('breakout20', () => {
  it('현재가가 직전 20봉 최고가 초과', () => {
    const o = [...Array(20).fill(bar(10, 9, 10)), bar(12, 10, 11)]
    expect(breakout20(o, 20)).toBe(true)
  })
  it('초과 못하면 false', () => {
    const o = [...Array(20).fill(bar(10, 9, 10)), bar(10, 9, 9.5)]
    expect(breakout20(o, 20)).toBe(false)
  })
})

describe('near24hHigh', () => {
  it('24h 고가의 2% 이내', () => {
    expect(near24hHigh(99, 100, 2)).toBe(true)
    expect(near24hHigh(97, 100, 2)).toBe(false)
  })
})

describe('isConsolidationBreakout', () => {
  it('타이트 레인지(<3%) 후 돌파', () => {
    const o = [...Array(20).fill(bar(100, 99, 99.5)), bar(105, 100, 104)]
    expect(isConsolidationBreakout(o, 20, 3)).toBe(true)
  })
  it('레인지 넓으면 false', () => {
    const o = [...Array(20).fill(0).map((_, i) => bar(100 + i, 90, 95)), bar(130, 120, 125)]
    expect(isConsolidationBreakout(o, 20, 3)).toBe(false)
  })
})

describe('emaAligned', () => {
  it('상승추세 EMA5>EMA20>EMA60', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i)
    expect(emaAligned(closes)).toBe(true)
  })
  it('데이터<60 → false', () => {
    expect(emaAligned([1, 2, 3])).toBe(false)
  })
})

describe('rsiOk', () => {
  it('RSI 50~75 범위', () => {
    // sin 진동 + 완만한 상승 → RSI ~65 (완전 단방향이면 RSI=100으로 범위 초과)
    const up = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i * 0.5) * 2 + i * 0.1)
    expect(rsiOk(up)).toBe(true)
  })
})

import { scoreFlow, alertLevel } from '../lib/moneyflow.mjs'

describe('scoreFlow', () => {
  it('전 항목 충족 → 100', () => {
    const { score } = scoreFlow({ ratio: 6, accel: 2, value5m: 2_000_000_000, breakout: true, near24h: true, emaOK: true, rsiOK: true, early: true, btcFavorable: true, btcBad: false })
    expect(score).toBe(100)
  })
  it('머니비율 등급(5/3/2x)', () => {
    expect(scoreFlow({ ratio: 5 }).parts.money).toBe(30)
    expect(scoreFlow({ ratio: 3 }).parts.money).toBe(20)
    expect(scoreFlow({ ratio: 2 }).parts.money).toBe(10)
    expect(scoreFlow({ ratio: 1.5 }).parts.money).toBeUndefined()
  })
  it('btcBad → ×0.8', () => {
    const full = scoreFlow({ ratio: 6, accel: 2, value5m: 2_000_000_000, breakout: true, near24h: true, emaOK: true, rsiOK: true, early: true, btcFavorable: false, btcBad: true })
    expect(full.score).toBe(76) // (100-5btc)=95 ×0.8=76
  })
  it('0~100 클램프, 빈 입력 → 0', () => {
    expect(scoreFlow({}).score).toBe(0)
  })
})

describe('alertLevel', () => {
  it('strong: ratio≥3 + 돌파 + BTC우호', () => {
    expect(alertLevel({ ratio: 3, breakout: true, btcFavorable: true })).toBe('strong')
  })
  it('attention: ratio≥2 + 돌파', () => {
    expect(alertLevel({ ratio: 2, breakout: true, btcFavorable: false })).toBe('attention')
  })
  it('watch: ratio≥2', () => {
    expect(alertLevel({ ratio: 2, breakout: false, btcFavorable: false })).toBe('watch')
  })
  it('ratio<2 → null', () => {
    expect(alertLevel({ ratio: 1.5, breakout: true, btcFavorable: true })).toBe(null)
  })
})
