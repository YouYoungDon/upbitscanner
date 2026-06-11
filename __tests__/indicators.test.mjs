import { describe, it, expect } from 'vitest'
import {
  calcEMA, calcSMA, calcRSI, calcBB, calcMACD,
  calcStochastic, calcWilliamsR, calcVolRatio,
} from '../lib/indicators.mjs'

describe('calcSMA', () => {
  it('단순이동평균을 윈도우별로 계산', () => {
    expect(calcSMA([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4])
  })
})

describe('calcEMA', () => {
  it('첫 값은 시드, 길이는 입력과 동일', () => {
    const r = calcEMA([2, 4, 6, 8], 2)
    expect(r).toHaveLength(4)
    expect(r[0]).toBe(2)
    expect(r[3]).toBeCloseTo(7.037, 2) // k=2/3, 190/27≈7.037
  })
})

describe('calcRSI', () => {
  it('단조 상승이면 100', () => {
    const c = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(calcRSI(c)).toBe(100)
  })
  it('데이터 부족 시 null', () => {
    expect(calcRSI([1, 2, 3])).toBeNull()
  })
})

describe('calcBB', () => {
  it('평탄 데이터는 std 0 → upper=mid=lower', () => {
    const c = Array(20).fill(10)
    const bb = calcBB(c)
    expect(bb.upper).toBe(10)
    expect(bb.mid).toBe(10)
    expect(bb.lower).toBe(10)
  })
  it('데이터 부족 시 null', () => {
    expect(calcBB(Array(10).fill(1))).toBeNull()
  })
})

describe('calcMACD', () => {
  it('충분한 데이터에서 객체 반환', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i))
    const m = calcMACD(c)
    expect(m).toHaveProperty('macd')
    expect(m).toHaveProperty('signal')
    expect(m).toHaveProperty('prevHist')
  })
  it('데이터 부족 시 null', () => {
    expect(calcMACD(Array(10).fill(1))).toBeNull()
  })
})

describe('calcStochastic', () => {
  it('high===low 구간은 k 50 처리, 객체 반환', () => {
    const n = 30
    const closes = Array.from({ length: n }, (_, i) => 100 + i)
    const highs = closes.map((c) => c + 1)
    const lows = closes.map((c) => c - 1)
    const s = calcStochastic(highs, lows, closes)
    expect(s).toHaveProperty('k')
    expect(s).toHaveProperty('prevD')
  })
})

describe('calcWilliamsR', () => {
  it('최고가에 종가가 닿으면 0', () => {
    const closes = [1, 2, 3, 10, 5, 6, 7, 8, 9, 10, 1, 2, 3, 10]
    const highs = closes.map((c) => c)
    const lows = closes.map(() => 0)
    expect(calcWilliamsR(highs, lows, closes)).toBe(0)
  })
})

describe('calcVolRatio', () => {
  it('최근 거래량 / 직전 20개 평균', () => {
    const vols = [...Array(20).fill(10), 20]
    expect(calcVolRatio(vols)).toBeCloseTo(2, 5)
  })
  it('데이터 부족 시 null', () => {
    expect(calcVolRatio(Array(10).fill(1))).toBeNull()
  })
})
