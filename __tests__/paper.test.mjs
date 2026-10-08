import { describe, it, expect } from 'vitest'
import {
  vwapFill, exitRule, scanExit, netReturn, selectEntries, newBook, openPosition, closePosition, PAPER,
} from '../lib/paper.mjs'

const H = 3600_000

describe('vwapFill', () => {
  const asks = [{ price: 100, size: 200 }, { price: 101, size: 1000 }]
  it('원화 금액만큼 호가를 훑어 평균가로 체결', () => {
    const f = vwapFill(asks, { krw: 50_000 })
    // 100원×200개=20,000 + 101원×(30,000/101)개
    expect(f.filled).toBe(true)
    expect(f.krw).toBeCloseTo(50_000, 6)
    expect(f.price).toBeGreaterThan(100)
    expect(f.price).toBeLessThan(101)
  })
  it('수량만큼 매도 호가(bid)를 훑는다', () => {
    const bids = [{ price: 99, size: 1 }, { price: 98, size: 10 }]
    const f = vwapFill(bids, { qty: 3 })
    expect(f.price).toBeCloseTo((99 + 98 * 2) / 3, 9)
  })
  it('호가가 모자라면 filled=false', () => {
    expect(vwapFill([{ price: 100, size: 1 }], { krw: 50_000 }).filled).toBe(false)
    expect(vwapFill([], { krw: 1 }).filled).toBe(false)
  })
})

describe('exitRule', () => {
  it('메인 픽은 pick.exit 퍼센트를 체결가에 적용', () => {
    const r = exitRule({ price: 100, exit: { slPct: 12, tpPct: 12, holdMax: 7 } }, 'main', 110)
    expect(r.stopLoss).toBeCloseTo(110 * 0.88, 9)
    expect(r.takeProfit).toBeCloseTo(110 * 1.12, 9)
    expect(r.holdMax).toBe(7)
    expect(r.rule).toBe('exit')
  })
  it('🎯전략 픽은 스캔가 기준 손절·목표 비율을 체결가에 옮긴다', () => {
    const r = exitRule({ price: 100, strategy: { stopLoss: 90, takeProfit: 118 }, exit: { slPct: 12, tpPct: 12, holdMax: 7 } }, 'main', 200)
    expect(r.stopLoss).toBeCloseTo(180, 9)
    expect(r.takeProfit).toBeCloseTo(236, 9)
    expect(r.rule).toBe('strategy')
  })
  it('모멘텀·청산 정보 없는 픽은 기본 SL12/TP12/7일', () => {
    const r = exitRule({ price: 100 }, 'momentum', 100)
    expect(r).toMatchObject({ holdMax: 7, rule: 'default' })
    expect(r.stopLoss).toBeCloseTo(88, 9)
    expect(r.takeProfit).toBeCloseTo(112, 9)
  })
})

describe('scanExit', () => {
  const pos = { entryAt: 10 * H + 30 * 60_000, stopLoss: 90, takeProfit: 110 }
  const c = (hour, o, h, l) => ({ t: hour * H, open: o, high: h, low: l, close: o })
  it('진입이 포함된 봉은 건너뛴다(진입 전 가격이 섞여 있음)', () => {
    expect(scanExit(pos, [c(10, 100, 120, 80)])).toBeNull()
  })
  it('익절 터치 → 목표가 체결', () => {
    expect(scanExit(pos, [c(11, 100, 111, 95)])).toEqual({ type: 'tp', price: 110, at: 11 * H })
  })
  it('같은 봉에서 손절·익절 둘 다 닿으면 손절(보수적)', () => {
    expect(scanExit(pos, [c(11, 100, 115, 85)]).type).toBe('sl')
  })
  it('갭으로 손절선 아래에서 시작하면 시가 체결', () => {
    expect(scanExit(pos, [c(11, 85, 86, 80)])).toEqual({ type: 'sl', price: 85, at: 11 * H })
  })
  it('갭으로 목표가 위에서 시작하면 시가 체결', () => {
    expect(scanExit(pos, [c(11, 115, 120, 112)])).toEqual({ type: 'tp', price: 115, at: 11 * H })
  })
  it('먼저 닿은 쪽이 이긴다', () => {
    expect(scanExit(pos, [c(11, 100, 111, 95), c(12, 100, 100, 80)]).type).toBe('tp')
  })
})

describe('netReturn', () => {
  it('양쪽 수수료 반영', () => {
    expect(netReturn(100, 100)).toBeCloseTo((1 - PAPER.FEE) / (1 + PAPER.FEE) - 1, 12)
    expect(netReturn(100, 110)).toBeLessThan(0.1)
  })
})

describe('장부', () => {
  it('진입 후보: 점수순·보유중 제외·저유동성 제외·스캔당 상한·빈 슬롯 상한', () => {
    const book = newBook()
    book.open.push({ market: 'KRW-A' })
    const scan = { buy: [
      { market: 'KRW-A', score: 9 }, { market: 'KRW-B', score: 5 }, { market: 'KRW-C', score: 8, lowLiquidity: true },
      { market: 'KRW-D', score: 7 }, { market: 'KRW-E', score: 6 }, { market: 'KRW-F', score: 4 },
    ] }
    const got = selectEntries(book, scan.buy, { maxPerScan: 3, maxOpen: 10 })
    expect(got.map((p) => p.market)).toEqual(['KRW-D', 'KRW-E', 'KRW-B'])
    book.open.push({ market: 'X1' }, { market: 'X2' }, { market: 'X3' }, { market: 'X4' }, { market: 'X5' }, { market: 'X6' }, { market: 'X7' }, { market: 'X8' })
    expect(selectEntries(book, scan.buy, { maxPerScan: 3, maxOpen: 10 }).length).toBe(1)
  })

  it('열고 닫으면 현금이 수수료 포함으로 맞는다', () => {
    const book = newBook()
    const pos = openPosition(book, { market: 'KRW-B', korean_name: 'B', price: 100, score: 5, signals: [] }, {
      source: 'main', fill: { price: 100, qty: 500, krw: 50_000 }, at: 0, scanAt: 0,
      rule: { stopLoss: 88, takeProfit: 112, holdMax: 7, rule: 'default' },
    })
    expect(book.cash).toBeCloseTo(PAPER.START_CASH - 50_000 * (1 + PAPER.FEE), 6)
    closePosition(book, pos, { type: 'tp', price: 112, at: H })
    expect(book.open).toHaveLength(0)
    expect(book.closed).toHaveLength(1)
    const c = book.closed[0]
    expect(c.net).toBeCloseTo(netReturn(100, 112), 12)
    expect(book.cash).toBeCloseTo(PAPER.START_CASH - 50_000 * (1 + PAPER.FEE) + 500 * 112 * (1 - PAPER.FEE), 6)
  })

  it('손절 체결엔 추가 슬리피지', () => {
    const book = newBook()
    const pos = openPosition(book, { market: 'KRW-B', price: 100 }, {
      source: 'main', fill: { price: 100, qty: 500, krw: 50_000 }, at: 0, scanAt: 0,
      rule: { stopLoss: 88, takeProfit: 112, holdMax: 7, rule: 'default' },
    })
    closePosition(book, pos, { type: 'sl', price: 88, at: H })
    expect(book.closed[0].exitPrice).toBeCloseTo(88 * (1 - PAPER.STOP_SLIP), 9)
  })
})
