import { describe, it, expect } from 'vitest'
import { summarizeTrades, buildPaperView } from '../lib/paper-summary.mjs'

const DAY = 86400_000
const trade = (o) => ({ market: 'KRW-A', korean_name: 'A', entryPrice: 100, exitPrice: 112, net: 0.1189, pnl: 5947, exitType: 'tp', ...o })

describe('summarizeTrades', () => {
  it('reports the plain per-trade mean separately from the entry-day mean', () => {
    // day 0: two winners, day 1: one loser → trade mean +3.84%, entry-day mean (11.89 - 12.26)/2
    const rows = [
      trade({ entryAt: 0, exitAt: DAY }),
      trade({ entryAt: 1000, exitAt: DAY }),
      trade({ entryAt: DAY + 5, exitAt: 2 * DAY, net: -0.1226, pnl: -6135, exitType: 'sl' }),
    ]
    const s = summarizeTrades(rows, {})
    expect(s.n).toBe(3)
    expect(s.tradeMean).toBeCloseTo((0.1189 * 2 - 0.1226) / 3, 6)
    expect(s.dayMean).toBeCloseTo((0.1189 - 0.1226) / 2, 6)
    expect(s.days).toBe(2)
    expect(s.win).toBeCloseTo(2 / 3, 6)
    expect(s.pnl).toBe(5947 * 2 - 6135)
    expect(s.byType).toEqual({ tp: 2, sl: 1 })
  })

  it('returns n 0 for no trades', () => {
    expect(summarizeTrades([], {}).n).toBe(0)
  })
})

describe('buildPaperView', () => {
  const state = {
    startedAt: new Date(0).toISOString(),
    lastRun: new Date(3 * DAY).toISOString(),
    params: { START_CASH: 500000 },
    equity: [{ at: 0, main: 500000 }, { at: DAY, main: 550000 }, { at: 2 * DAY, main: 495000 }],
    books: {
      main: {
        cash: 400000, skipped: 0,
        open: [
          { market: 'KRW-FAR', korean_name: '멀다', entryAt: 0, entryPrice: 100, stopLoss: 88, takeProfit: 112, holdMax: 7 },
          { market: 'KRW-NEAR', korean_name: '가깝다', entryAt: DAY, entryPrice: 100, stopLoss: 88, takeProfit: 112, holdMax: 7 },
        ],
        closed: [
          trade({ market: 'KRW-OLD', entryAt: 0, exitAt: DAY, exitPrice: 88, net: -0.1226, exitType: 'sl' }),
          trade({ market: 'KRW-NEW', entryAt: DAY, exitAt: 2 * DAY }),
        ],
      },
    },
  }
  const priceOf = { 'KRW-FAR': 105, 'KRW-NEAR': 89, 'KRW-OLD': 70, 'KRW-NEW': 120 }
  const v = buildPaperView(state, {}, priceOf, 3 * DAY)
  const b = v.books.main

  it('sorts open positions nearest the stop first with live return and distances', () => {
    expect(b.open.map((p) => p.market)).toEqual(['KRW-NEAR', 'KRW-FAR'])
    const near = b.open[0]
    expect(near.ret).toBeCloseTo(-0.11, 6)
    expect(near.toStop).toBeCloseTo(88 / 89 - 1, 6)
    expect(near.toTake).toBeCloseTo(112 / 89 - 1, 6)
    expect(near.heldDays).toBeCloseTo(2, 6)
  })

  it('lists closed trades newest first with what holding to now would have returned', () => {
    expect(b.closed.map((c) => c.market)).toEqual(['KRW-NEW', 'KRW-OLD'])
    expect(b.closed[1].holdNow).toBeCloseTo(-0.3, 6)
    expect(b.closed[1].afterExit).toBeCloseTo(70 / 88 - 1, 6)
  })

  it('reports equity, return, drawdown and passes the equity series through', () => {
    expect(b.equity).toBe(495000)
    expect(b.ret).toBeCloseTo(-0.01, 6)
    expect(b.mdd).toBeCloseTo(495000 / 550000 - 1, 6)
    expect(v.equity).toHaveLength(3)
    expect(b.summary.n).toBe(2)
  })

  it('leaves live fields null when a price is missing', () => {
    const w = buildPaperView(state, {}, {}, 3 * DAY)
    expect(w.books.main.open[0].ret).toBeNull()
    expect(w.books.main.closed[0].holdNow).toBeNull()
  })
})
