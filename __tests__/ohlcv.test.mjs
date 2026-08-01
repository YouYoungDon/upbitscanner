import { describe, it, expect } from 'vitest'
import { confirmedOhlcv, confirmedOhlcvAsOf, ensureMinConfirmed } from '../lib/ohlcv.mjs'

describe('confirmedOhlcvAsOf — 날짜 인지 확정봉', () => {
  const DAY = 86400
  const c = (day) => ({ time: day * DAY, close: 100 })
  it('당일 봉만 제거, 어제가 마지막인 저유동 마켓은 어제 봉 보존', () => {
    const now = 100 * DAY * 1000 + 3600 * 1000 // day 100 진행 중
    expect(confirmedOhlcvAsOf([c(98), c(99), c(100)], now)).toEqual([c(98), c(99)])
    expect(confirmedOhlcvAsOf([c(98), c(99)], now)).toEqual([c(98), c(99)]) // blind slice였다면 99가 잘림
  })
  it('비배열 → []', () => {
    expect(confirmedOhlcvAsOf(null, 0)).toEqual([])
  })
})

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
