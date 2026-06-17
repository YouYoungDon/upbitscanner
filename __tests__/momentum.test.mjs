import { describe, it, expect } from 'vitest'
import { detectDivergence, calcBBSqueeze, scoreMomentum, MIN_MOMENTUM_SCORE } from '../lib/momentum.mjs'

describe('detectDivergence', () => {
  it('하락 다이버전스: 가격 고점↑ + RSI 고점↓', () => {
    const prices = [1, 2, 3, 2, 1, 2, 3, 4, 3, 2]
    const rsi = prices.map(() => 50)
    rsi[2] = 70; rsi[7] = 60 // 2차 피크 RSI가 3pt 이상 낮음
    expect(detectDivergence(prices, rsi, { window: 1 }).bearish).toBe(true)
  })
  it('상승 다이버전스: 가격 저점↓ + RSI 저점↑', () => {
    const prices = [5, 4, 3, 4, 5, 4, 3, 2, 3, 4]
    const rsi = prices.map(() => 50)
    rsi[2] = 30; rsi[7] = 40 // 2차 트로프 RSI가 3pt 이상 높음
    expect(detectDivergence(prices, rsi, { window: 1 }).bullish).toBe(true)
  })
  it('다이버전스 없음', () => {
    const prices = [1, 2, 3, 2, 1, 2, 3, 4, 3, 2]
    const rsi = prices.map(() => 50)
    expect(detectDivergence(prices, rsi, { window: 1 })).toEqual({ bearish: false, bullish: false })
  })
})

describe('calcBBSqueeze', () => {
  it('수축 후 2봉 연속 확장 → fired', () => {
    const closes = [10, 10, 10, 10, 10, 10, 10, 11, 13]
    const r = calcBBSqueeze(closes, { period: 3, sqWin: 4 })
    expect(r.expanding).toBe(true)
    expect(r.fired).toBe(true)
  })
  it('변동 없으면 발산 없음', () => {
    const closes = new Array(40).fill(100)
    const r = calcBBSqueeze(closes)
    expect(r.expanding).toBe(false)
    expect(r.fired).toBe(false)
  })
})

describe('scoreMomentum', () => {
  it('강한 상승추세는 MIN_SCORE 이상 + 신고가/정배열 신호', () => {
    const ohlcv = Array.from({ length: 210 }, (_, i) => {
      const close = 100 + i * 0.5
      return { open: close - 0.2, high: close + 0.1, low: close - 0.3, close, volume: 100 }
    })
    const { score, signals } = scoreMomentum(ohlcv)
    expect(score).toBeGreaterThanOrEqual(MIN_MOMENTUM_SCORE)
    expect(signals.some((s) => s.includes('신고가'))).toBe(true)
    expect(signals.some((s) => s.includes('정배열'))).toBe(true)
  })
  it('하락추세는 MIN_SCORE 미만', () => {
    const ohlcv = Array.from({ length: 210 }, (_, i) => {
      const close = 300 - i * 0.5
      return { open: close + 0.2, high: close + 0.3, low: close - 0.1, close, volume: 100 }
    })
    expect(scoreMomentum(ohlcv).score).toBeLessThan(MIN_MOMENTUM_SCORE)
  })
  it('데이터 부족 시 0점', () => {
    expect(scoreMomentum([{ open: 1, high: 1, low: 1, close: 1, volume: 1 }]).score).toBe(0)
  })
})
