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
