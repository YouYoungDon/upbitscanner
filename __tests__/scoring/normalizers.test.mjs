import { describe, it, expect } from 'vitest'
import { percentileVsUniverse, vsOwnHistory, fixedCurve, normalize } from '../../lib/scoring/normalizers.mjs'

describe('percentileVsUniverse', () => {
  const dist = [1, 2, 3, 4, 5]
  it('백분위 0/50/100', () => {
    expect(percentileVsUniverse(1, dist)).toBe(20)   // 1개 이하 / 5 = 20
    expect(percentileVsUniverse(3, dist)).toBe(60)    // 3개 이하 / 5 = 60
    expect(percentileVsUniverse(5, dist)).toBe(100)
  })
  it('raw null/NaN → null', () => {
    expect(percentileVsUniverse(null, dist)).toBe(null)
    expect(percentileVsUniverse(NaN, dist)).toBe(null)
  })
  it('빈 분포 → null', () => {
    expect(percentileVsUniverse(3, [])).toBe(null)
  })
})

describe('vsOwnHistory', () => {
  it('자기 이력 대비 백분위', () => {
    expect(vsOwnHistory(10, [1, 2, 3, 4, 10])).toBe(100)
    expect(vsOwnHistory(2, [1, 2, 3, 4, 10])).toBe(40)
  })
  it('이력 부족(<5) → null', () => {
    expect(vsOwnHistory(2, [1, 2])).toBe(null)
  })
  it('raw null → null', () => {
    expect(vsOwnHistory(null, [1, 2, 3, 4, 5])).toBe(null)
  })
})

describe('fixedCurve', () => {
  const bp = [[100, 0], [500, 40], [2000, 70], [10000, 100]]
  it('구간 보간 + 클램프', () => {
    expect(fixedCurve(100, bp)).toBe(0)
    expect(fixedCurve(300, bp)).toBe(20)     // 100~500 사이 절반
    expect(fixedCurve(50, bp)).toBe(0)       // 하한 클램프
    expect(fixedCurve(99999, bp)).toBe(100)  // 상한 클램프
  })
  it('raw null → null', () => {
    expect(fixedCurve(null, bp)).toBe(null)
  })
})

describe('normalize dispatcher', () => {
  it('전략별 위임', () => {
    expect(normalize('percentileVsUniverse', 5, { dist: [1, 2, 3, 4, 5] })).toBe(100)
    expect(normalize('fixedCurve', 100, { params: [[100, 0], [200, 100]] })).toBe(0)
  })
  it('알 수 없는 전략 → null', () => {
    expect(normalize('bogus', 5, {})).toBe(null)
  })
})
