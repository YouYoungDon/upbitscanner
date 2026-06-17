import { describe, it, expect } from 'vitest'
import { evalPositions } from '../lib/positions.mjs'

describe('evalPositions', () => {
  const pos = [{ market: 'KRW-A', korean_name: '에이', entry: 100, stopLoss: 90, takeProfit: 130 }]
  it('손익률/손절거리 산출, SL 위', () => {
    const r = evalPositions(pos, { 'KRW-A': 110 })[0]
    expect(r.plPct).toBe(10)
    expect(r.toSLPct).toBeCloseTo(22.22, 1)
    expect(r.hitSL).toBe(false)
    expect(r.hitTP).toBe(false)
  })
  it('SL 도달 감지', () => {
    expect(evalPositions(pos, { 'KRW-A': 89 })[0].hitSL).toBe(true)
  })
  it('TP 도달 감지', () => {
    expect(evalPositions(pos, { 'KRW-A': 135 })[0].hitTP).toBe(true)
  })
  it('현재가 없으면 null', () => {
    const r = evalPositions(pos, {})[0]
    expect(r.price).toBe(null)
    expect(r.plPct).toBe(null)
    expect(r.hitSL).toBe(false)
  })
})
