import { describe, it, expect } from 'vitest'
import { detectQuietBottom, strategyLevels } from '../lib/strategy.mjs'

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
