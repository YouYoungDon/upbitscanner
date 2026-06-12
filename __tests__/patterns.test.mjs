import { describe, it, expect } from 'vitest'
import { detectPatterns } from '../lib/signals.mjs'

describe('detectPatterns', () => {
  it('상승깃발: 16봉 +8% 상승 후 횡보 → buy 신호', () => {
    const base = Array(15).fill(100)
    const rally = Array.from({ length: 16 }, (_, i) => 100 + (i + 1) * 0.6) // ~+9.6%
    const top = rally.at(-1)
    const flat = Array.from({ length: 4 }, () => top * 1.0) // 횡보
    const closes = [...base, ...rally, ...flat]
    const ohlcv = closes.map((c) => ({ close: c, high: c * 1.001, low: c * 0.999, volume: 10 }))
    const r = detectPatterns(ohlcv)
    expect(r).toHaveProperty('buy')
    expect(r).toHaveProperty('sell')
    expect(Array.isArray(r.buy)).toBe(true)
  })

  it('데이터 부족 시 빈 배열', () => {
    const ohlcv = Array(5).fill({ close: 1, high: 1, low: 1, volume: 1 })
    const r = detectPatterns(ohlcv)
    expect(r.buy).toEqual([])
    expect(r.sell).toEqual([])
  })

  it('박스권 돌파: 좁은 박스 후 상단 1% 돌파 → buy 신호', () => {
    const n = 31
    const ohlcv = Array.from({ length: n }, (_, i) =>
      i === n - 1
        ? { close: 105, high: 105, low: 100, volume: 10 } // 마지막 봉 상단 돌파
        : { close: 100, high: 101, low: 99, volume: 10 }, // 좁은 박스 (range ~2%)
    )
    const r = detectPatterns(ohlcv)
    expect(r.buy).toContain('박스권 돌파 패턴')
  })
})
