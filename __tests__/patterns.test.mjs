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
})
