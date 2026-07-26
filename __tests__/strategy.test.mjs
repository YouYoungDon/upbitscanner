import { describe, it, expect } from 'vitest'
import { detectQuietBottom, strategyLevels, simulateTrade, quietBottomSeries } from '../lib/strategy.mjs'

// 합성 확정봉: 완만한 하락 + 조용한 거래량 (지표값은 실계산 결과를 기준으로 경계 검증)
const mkCandles = (n) => Array.from({ length: n }, (_, i) => {
  const close = 200 - i // 단조 하락 → RSI/Stoch 낮음
  return { time: i * 86400, open: close + 1, high: close + 2, low: close - 2, close, volume: 10 }
})

describe('detectQuietBottom', () => {
  const permissive = { rsiMax: 100, stochMax: 100, volMax: 10 }
  it('조건 전부 충족 시 지표값 반환', () => {
    const r = detectQuietBottom(mkCandles(70), permissive)
    expect(r).not.toBeNull()
    expect(r.rsi).toBeGreaterThanOrEqual(0)
    expect(r.stochK).toBeGreaterThanOrEqual(0)
    expect(r.volRatio).toBeCloseTo(1, 1) // 균일 거래량 → ~1.0
  })
  it('경계 포함(<=): rsiMax를 실제 rsi로 두면 매치, 그보다 낮추면 null', () => {
    const r = detectQuietBottom(mkCandles(70), permissive)
    expect(detectQuietBottom(mkCandles(70), { ...permissive, rsiMax: r.rsi })).not.toBeNull()
    expect(detectQuietBottom(mkCandles(70), { ...permissive, rsiMax: r.rsi - 0.01 })).toBeNull()
  })
  it('Stoch·vol 경계도 동일 규칙', () => {
    const r = detectQuietBottom(mkCandles(70), permissive)
    expect(detectQuietBottom(mkCandles(70), { ...permissive, stochMax: r.stochK - 0.01 })).toBeNull()
    expect(detectQuietBottom(mkCandles(70), { ...permissive, volMax: r.volRatio - 0.01 })).toBeNull()
  })
  it('확정봉 60개 미만 → null', () => {
    expect(detectQuietBottom(mkCandles(59), permissive)).toBeNull()
    expect(detectQuietBottom([], permissive)).toBeNull()
    expect(detectQuietBottom(null, permissive)).toBeNull()
  })
})

describe('strategyLevels', () => {
  it('손절·목표 계산', () => {
    const lv = strategyLevels(100, { slPct: 7, tpPct: 12 })
    expect(lv.stopLoss).toBeCloseTo(93)
    expect(lv.takeProfit).toBeCloseTo(112)
  })
  it('entry 0 이하 → null', () => {
    expect(strategyLevels(0, { slPct: 7, tpPct: 12 })).toBeNull()
    expect(strategyLevels(-1, { slPct: 7, tpPct: 12 })).toBeNull()
  })
})

describe('simulateTrade', () => {
  const P = { slPct: 5, tpPct: 10, holdMax: 3 }
  const c = (open, high, low, close) => ({ open, high, low, close, volume: 1, time: 0 })
  // idx0 = 신호봉, idx1부터 진입 (진입가 = idx1 open = 100)
  it('목표 도달 → tp 청산', () => {
    const r = simulateTrade([c(0, 0, 0, 0), c(100, 111, 99, 105)], 0, P)
    expect(r).toEqual({ ret: expect.closeTo(0.10, 5), exitIdx: 1, reason: 'tp' })
  })
  it('손절 도달 → sl 청산', () => {
    const r = simulateTrade([c(0, 0, 0, 0), c(100, 104, 94, 96)], 0, P)
    expect(r.reason).toBe('sl')
    expect(r.ret).toBeCloseTo(-0.05)
  })
  it('같은 봉에서 손절·목표 동시 도달 → 손절 우선', () => {
    const r = simulateTrade([c(0, 0, 0, 0), c(100, 120, 90, 100)], 0, P)
    expect(r.reason).toBe('sl')
  })
  it('미도달 → holdMax봉째 종가 시간청산', () => {
    const flat = c(100, 102, 98, 101)
    const r = simulateTrade([c(0, 0, 0, 0), flat, flat, c(100, 102, 98, 103)], 0, P)
    expect(r).toEqual({ ret: expect.closeTo(0.03, 5), exitIdx: 3, reason: 'time' })
  })
  it('히스토리 끝 — 청산 못 하면 null (미완료 거래 제외)', () => {
    expect(simulateTrade([c(0, 0, 0, 0), c(100, 102, 98, 101)], 0, P)).toBeNull()
  })
  it('진입봉 자체가 없으면 null', () => {
    expect(simulateTrade([c(0, 0, 0, 0)], 0, P)).toBeNull()
  })
})

describe('quietBottomSeries — detectQuietBottom 프리픽스 호출과 동치', () => {
  it('90봉 합성 데이터에서 전 인덱스 일치', () => {
    const candles = Array.from({ length: 90 }, (_, i) => {
      const close = 100 + 15 * Math.sin(i / 5) + (i % 3)
      return { time: i * 86400, open: close, high: close + 2, low: close - 2, close, volume: 10 + (i % 5) * 3 }
    })
    const params = { rsiMax: 48, stochMax: 55, volMax: 1.2, minCandles: 60 }
    const series = quietBottomSeries(candles, params)
    expect(series.length).toBe(90)
    for (let i = 0; i < 90; i++) {
      const expected = detectQuietBottom(candles.slice(0, i + 1), params) !== null
      expect(series[i], `index ${i}`).toBe(expected)
    }
  })
})
