import { describe, it, expect } from 'vitest'
import {
  calcEMA, calcSMA, calcRSI, calcBB, calcMACD,
  calcStochastic, calcWilliamsR, calcVolRatio,
  calcRSISeries, calcOBV, calcBBWidthSeries,
} from '../lib/indicators.mjs'

describe('calcBBWidthSeries', () => {
  it('밴드폭(%)을 봉별로 계산, 길이 = n-period+1', () => {
    const closes = [10, 10, 10, 10, 10, 11, 13]
    const s = calcBBWidthSeries(closes, 3)
    expect(s).toHaveLength(closes.length - 3 + 1)
    expect(s[0]).toBe(0)            // 첫 3봉 [10,10,10] → std 0 → BW 0
    expect(s.at(-1)).toBeGreaterThan(0) // 변동 발생 구간 → BW > 0
  })
  it('변동 없으면 모두 0', () => {
    expect(calcBBWidthSeries(new Array(25).fill(100), 20).every((x) => x === 0)).toBe(true)
  })
})

describe('calcRSISeries', () => {
  it('마지막 값이 calcRSI와 일치하고, 길이는 closes와 동일', () => {
    const closes = [44, 44.3, 44.1, 44.6, 45.2, 45.4, 45.1, 45.6, 46.3, 46.6, 46.2, 46.8, 47.1, 46.9, 47.3, 47.7]
    const series = calcRSISeries(closes, 14)
    expect(series).toHaveLength(closes.length)
    expect(series[13]).toBe(null) // 워밍업 (period 미만 인덱스는 null, period 인덱스부터 값)
    expect(series.at(-1)).toBeCloseTo(calcRSI(closes, 14), 6)
  })
  it('데이터 부족 시 빈 배열', () => {
    expect(calcRSISeries([1, 2, 3], 14)).toEqual([])
  })
})

describe('calcOBV', () => {
  it('상승봉 +vol, 하락봉 -vol, 보합 유지 누적', () => {
    const closes = [10, 11, 10, 10, 12]
    const vols = [100, 50, 30, 20, 40]
    // 0, +50, -30, +0, +40 → [0,50,20,20,60]
    expect(calcOBV(closes, vols)).toEqual([0, 50, 20, 20, 60])
  })
})

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
