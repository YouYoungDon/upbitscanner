import { describe, it, expect } from 'vitest'
import { rollingAppend, clampWeight, ewmTarget } from '../lib/store.mjs'

describe('rollingAppend', () => {
  it('최대 길이 초과 시 오래된 항목 제거', () => {
    const arr = [1, 2, 3]
    expect(rollingAppend(arr, 4, 3)).toEqual([2, 3, 4])
  })
  it('한도 미만이면 그대로 append', () => {
    expect(rollingAppend([1], 2, 3)).toEqual([1, 2])
  })
})

describe('ewmTarget', () => {
  it('hitRate별 target', () => {
    expect(ewmTarget(0.8)).toBe(1.5)
    expect(ewmTarget(0.6)).toBe(1.0)
    expect(ewmTarget(0.3)).toBe(0.7)
  })
})

describe('clampWeight', () => {
  it('0.5~2.0 범위로 제한', () => {
    expect(clampWeight(0.8 * 1.4 + 0.2 * 1.5)).toBeCloseTo(1.42, 5)
    expect(clampWeight(5)).toBe(2.0)
    expect(clampWeight(0.1)).toBe(0.5)
  })
})
