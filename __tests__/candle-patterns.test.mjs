import { describe, it, expect } from 'vitest'
import { detectCandlePatterns } from '../lib/candle-patterns.mjs'

const c = (open, high, low, close) => ({ open, high, low, close, volume: 10 })
const downTrend = () => [c(100, 101, 99, 100), c(99, 100, 96, 97), c(97, 98, 94, 95), c(95, 96, 92, 93), c(93, 94, 90, 91)]
const upTrend = () => [c(90, 92, 89, 91), c(91, 94, 90, 93), c(93, 96, 92, 95), c(95, 98, 94, 97), c(97, 100, 96, 99)]

describe('detectCandlePatterns', () => {
  it('망치형: 하락추세 + 긴 아래꼬리 → bullish', () => {
    const ohlcv = [...downTrend(), c(91, 91.5, 85, 91)]
    const r = detectCandlePatterns(ohlcv)
    expect(r.bullish).toContain('망치형')
  })

  it('상승장악형: 직전 음봉을 현재 양봉이 감쌈 → bullish', () => {
    const ohlcv = [...downTrend(), c(92, 92.5, 88, 89), c(88, 95, 87.5, 94)]
    const r = detectCandlePatterns(ohlcv)
    expect(r.bullish).toContain('상승장악형')
  })

  it('하락장악형: 직전 양봉을 현재 음봉이 감쌈 → bearish', () => {
    const ohlcv = [...upTrend(), c(98, 99, 97.5, 99), c(99.5, 100, 96, 96.5)]
    const r = detectCandlePatterns(ohlcv)
    expect(r.bearish).toContain('하락장악형')
  })

  it('도지: 몸통이 매우 작음 → neutral', () => {
    const ohlcv = [...downTrend(), c(91, 94, 88, 91.05)]
    const r = detectCandlePatterns(ohlcv)
    expect(r.neutral).toContain('도지')
  })

  it('데이터 부족 시 빈 결과', () => {
    const r = detectCandlePatterns([c(1, 1, 1, 1)])
    expect(r).toEqual({ bullish: [], bearish: [], neutral: [] })
  })
})
