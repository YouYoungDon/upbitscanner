import { describe, it, expect } from 'vitest'
import { confirmedOhlcv, ensureMinConfirmed } from '../lib/ohlcv.mjs'

describe('confirmedOhlcv', () => {
  it('마지막(형성 중) 봉 제외', () => {
    expect(confirmedOhlcv([1, 2, 3])).toEqual([1, 2])
  })
  it('1개 배열 → []', () => { expect(confirmedOhlcv([1])).toEqual([]) })
  it('빈 배열 → []', () => { expect(confirmedOhlcv([])).toEqual([]) })
  it('비배열 → []', () => { expect(confirmedOhlcv(null)).toEqual([]); expect(confirmedOhlcv(undefined)).toEqual([]) })
  it('원본 불변', () => { const a = [1, 2, 3]; confirmedOhlcv(a); expect(a).toEqual([1, 2, 3]) })
})

describe('ensureMinConfirmed', () => {
  it('길이 >= min이면 그대로', () => { expect(ensureMinConfirmed([1, 2, 3], 3)).toEqual([1, 2, 3]) })
  it('길이 < min이면 null', () => { expect(ensureMinConfirmed([1, 2], 3)).toBe(null) })
  it('비배열이면 null', () => { expect(ensureMinConfirmed(null, 1)).toBe(null) })
})
