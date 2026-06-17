import { describe, it, expect } from 'vitest'
import { detectLiquiditySweep, detectVBottom, detectPumpStart } from '../lib/smc-signals.mjs'

const bar = (o, h, l, c, v = 100) => ({ open: o, high: h, low: l, close: c, volume: v })

describe('detectLiquiditySweep', () => {
  it('저점 스윕 후 역전 → 매수 +4', () => {
    const prior = Array.from({ length: 21 }, () => bar(105, 110, 100, 105))
    const cur = bar(101, 102, 98, 101) // low 98 < 100, close 101 > 100.1, depth 2%
    const r = detectLiquiditySweep([...prior, cur])
    expect(r.side).toBe('buy')
    expect(r.score).toBe(4)
  })
  it('고점 스윕 후 역전 → 매도', () => {
    const prior = Array.from({ length: 21 }, () => bar(105, 110, 100, 105))
    const cur = bar(109, 112, 108, 109) // high 112 > 110, close 109 < 110*0.999
    const r = detectLiquiditySweep([...prior, cur])
    expect(r.side).toBe('sell')
  })
  it('스윕 없으면 null side', () => {
    const bars = Array.from({ length: 22 }, () => bar(105, 110, 100, 105))
    expect(detectLiquiditySweep(bars).side).toBe(null)
  })
})

describe('detectVBottom', () => {
  it('투매+핀바+CHoCH 충족 → score 7, signalAge 0', () => {
    const bars = []
    for (let i = 0; i < 28; i++) { const c = 100 - i; bars.push(bar(c + 0.5, c + 0.5, c - 0.5, c, 100)) } // 하락추세 (28봉)
    bars.push(bar(72.5, 72.5, 66.5, 72, 350)) // index 28: 핀바(밑꼬리 92%) + 투매거래량 3.5x
    bars.push(bar(72, 74, 71.5, 73.5, 200))    // index 29: CHoCH 종가 73.5 > 72.5, 거래량 확인
    const r = detectVBottom(bars)
    expect(r).not.toBeNull()
    expect(r.score).toBe(7)
    expect(r.signalAge).toBe(0)
    expect(r.stopLoss).toBe(66.5)
  })
  it('평범한 상승추세 → null', () => {
    const bars = Array.from({ length: 35 }, (_, i) => { const c = 100 + i; return bar(c - 0.5, c + 0.5, c - 0.5, c, 100) })
    expect(detectVBottom(bars)).toBeNull()
  })
})

describe('detectPumpStart', () => {
  it('스퀴즈+매집+발사 → score 7', () => {
    const bars = []
    for (let i = 0; i <= 70; i++) { const c = 100 + i * 0.02; bars.push(bar(c, c + 0.05, c - 0.05, c, 100)) } // 타이트 횡보+완만상승
    bars.push(bar(102, 109, 101.5, 108, 300)) // index 71: BB상단 돌파 + 거래량 3x
    const r = detectPumpStart(bars)
    expect(r).not.toBeNull()
    expect(r.score).toBe(7)
    expect(r.stopLoss1).toBe(101.5)
  })
  it('변동 없는 시장 → null', () => {
    const bars = Array.from({ length: 80 }, () => bar(100, 100.1, 99.9, 100, 100))
    expect(detectPumpStart(bars)).toBeNull()
  })
})
