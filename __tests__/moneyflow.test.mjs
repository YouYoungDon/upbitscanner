import { describe, it, expect } from 'vitest'
import { tradingValues, moneyRatio, moneyAcceleration } from '../lib/moneyflow.mjs'

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
