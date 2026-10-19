import { describe, it, expect } from 'vitest'
import {
  vwapFill, exitRule, scanExit, netReturn, selectEntries, newBook, openPosition, closePosition, PAPER,
  tickFloor, tickCeil, stopFill, upbitTick, entryHourExit,
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

describe("호가 단위 (체결 모델 v2)", () => {
  it("upbitTick은 가격대별 업비트 호가 단위(2026-10-15 전 종목 296개 API 값과 일치 확인)", () => {
    expect(upbitTick(110727000)).toBe(1000)
    expect(upbitTick(3193000)).toBe(1000)
    expect(upbitTick(138100)).toBe(100)
    expect(upbitTick(10410)).toBe(10)
    expect(upbitTick(5355)).toBe(5)
    expect(upbitTick(2519)).toBe(1)
    expect(upbitTick(103)).toBe(1)
    expect(upbitTick(95)).toBe(0.1)
    expect(upbitTick(1.05)).toBe(0.01)
    expect(upbitTick(0.139)).toBe(0.001)
    expect(upbitTick(0.00529)).toBe(0.00001)
    expect(upbitTick(0.000477)).toBe(0.000001)
  })
  it("tickFloor/tickCeil은 주어진 호가 단위로 내림/올림한다", () => {
    expect(tickFloor(1.0472, 0.01)).toBe(1.04)
    expect(tickCeil(1.0472, 0.01)).toBe(1.05)
    expect(tickFloor(128.84, 0.1)).toBe(128.8)
    expect(tickCeil(128.81, 0.1)).toBe(128.9)
    expect(tickCeil(612.64, 1)).toBe(613)
  })
  it("이미 호가 단위 위에 있는 값은 그대로(부동소수 오차로 한 칸 밀리지 않음)", () => {
    expect(tickCeil(128.8, 0.1)).toBe(128.8)
    expect(tickFloor(0.3, 0.1)).toBe(0.3)
    expect(tickFloor(110727000, 1000)).toBe(110727000)
  })
})

describe("scanExit v2", () => {
  const pos = { entryAt: 10 * H + 30 * 60_000, stopLoss: 90, takeProfit: 110.3 }
  const c = (hour, o, h, l) => ({ t: hour * H, open: o, high: h, low: l, close: o })
  it("익절선은 그 가격대의 호가 단위로 올려서 판정·체결한다", () => {
    expect(scanExit(pos, [c(11, 100, 110.5, 95)], true)).toBeNull()
    expect(scanExit(pos, [c(11, 100, 111, 95)], true)).toEqual({ type: "tp", price: 111, at: 11 * H })
  })
  it("호가 단위는 현재가가 아니라 그 선의 가격대 기준(4,000원대 코인의 익절선 5,003.2원은 5원 단위 구간 → 5,005원)", () => {
    expect(scanExit({ entryAt: 0, stopLoss: 836, takeProfit: 5003.2 }, [c(1, 4000, 5004, 4000)], true)).toBeNull()
    expect(scanExit({ entryAt: 0, stopLoss: 836, takeProfit: 5003.2 }, [c(1, 4000, 5005, 4000)], true)).toEqual({ type: "tp", price: 5005, at: H })
  })
  it("v1(기본)은 호가 단위 없이 예전 그대로", () => {
    expect(scanExit(pos, [c(11, 100, 110.5, 95)])).toEqual({ type: "tp", price: 110.3, at: 11 * H })
    expect(scanExit(pos, [c(11, 100, 101, 85)])).toEqual({ type: "sl", price: 90, at: 11 * H })
  })
  it("v2 봉 안 손절은 intraBar 표시(1분봉으로 체결가를 다시 잡기 위해)", () => {
    expect(scanExit(pos, [c(11, 100, 101, 85)], true)).toEqual({ type: "sl", price: 90, at: 11 * H, intraBar: true })
  })
})

describe("stopFill", () => {
  const m = (min, low, close) => ({ t: 11 * H + min * 60_000, low, close })
  it("손절선을 처음 건드린 1분봉의 종가와 손절가(호가 내림) 중 낮은 값", () => {
    expect(stopFill(1.0472, [m(0, 1.06, 1.06), m(1, 1.04, 1.04), m(2, 1.0, 1.0)])).toBe(1.04)
  })
  it("그 1분 안에 되돌아 올라갔으면 손절가(호가 내림)로", () => {
    expect(stopFill(1.0472, [m(0, 1.03, 1.06)])).toBe(1.04)
  })
  it("1분봉이 없거나 터치가 안 보이면 손절가(호가 내림)", () => {
    expect(stopFill(1.0472, [])).toBe(1.04)
    expect(stopFill(1.0472, [m(0, 1.06, 1.06)])).toBe(1.04)
    expect(stopFill(90, null)).toBe(90)
  })
})

describe("entryHourExit — 진입한 시간의 남은 분을 1분봉으로 확인", () => {
  const pos = { entryAt: 12 * H + 3 * 60_000 + 20_000, stopLoss: 90, takeProfit: 110 } // 12:03:20 진입
  const m = (min, o, h, l, cl) => ({ t: 12 * H + min * 60_000, open: o, high: h, low: l, close: cl })
  it("진입이 포함된 분(12:03)은 건너뛰고, 그 뒤 손절 터치는 그 분 종가와 손절가 중 낮은 값", () => {
    const bars = [m(3, 100, 100, 80, 100), m(10, 100, 100, 95, 98), m(20, 95, 95, 88, 89), m(21, 89, 92, 85, 91)]
    expect(entryHourExit(pos, bars)).toEqual({ type: "sl", price: 89, at: 12 * H + 20 * 60_000 })
  })
  it("익절 터치는 익절선(호가 올림)에", () => {
    expect(entryHourExit(pos, [m(30, 100, 111, 99, 110)])).toEqual({ type: "tp", price: 110, at: 12 * H + 30 * 60_000 })
  })
  it("아무것도 안 닿으면 null", () => {
    expect(entryHourExit(pos, [m(30, 100, 105, 95, 100)])).toBeNull()
    expect(entryHourExit(pos, null)).toBeNull()
  })
})

describe("v2 리뷰 반영 (2026-10-15)", () => {
  const c = (hour, o, h, l) => ({ t: hour * H, open: o, high: h, low: l, close: o })
  it("v2 갭 상승으로 익절선 위에서 시작해도 걸어 둔 지정가 익절은 익절선 가격에 체결", () => {
    const pos = { entryAt: 0, stopLoss: 90, takeProfit: 110 }
    expect(scanExit(pos, [c(1, 115, 120, 112)], true)).toEqual({ type: "tp", price: 110, at: H })
    expect(scanExit(pos, [c(1, 115, 120, 112)])).toEqual({ type: "tp", price: 115, at: H }) // v1은 예전 그대로
  })
  it("stopFill: 1분봉이 손절선 아래에서 갭으로 시작하면 그 시가(더 낮은 값)로", () => {
    expect(stopFill(100, [{ t: 0, open: 96, low: 95, close: 101 }])).toBe(96)
  })
  it("upbitTick은 비정상 값에 null, 호가 반올림은 그 값을 그대로 둔다(한 포지션 때문에 전체 실행이 죽지 않게)", () => {
    expect(upbitTick(NaN)).toBeNull()
    expect(upbitTick(undefined)).toBeNull()
    expect(upbitTick(-1)).toBeNull()
    expect(scanExit({ entryAt: 0, stopLoss: 90, takeProfit: NaN }, [c(1, 100, 101, 95)], true)).toBeNull()
  })
})

describe('PAPER 규칙 고정(11-05까지)', () => {
  it('값이 바뀌면 paper-trade가 modelChanges를 남긴다 — 실험 중 바꾸지 않는다', () => {
    expect(PAPER).toEqual({
      START_CASH: 500_000, POSITION_KRW: 50_000, MAX_OPEN: 10, MAX_PER_SCAN: 3, FEE: 0.0005, STOP_SLIP: 0.002,
      MAX_SCAN_AGE_MS: 3 * 3600_000, DEFAULT_RULE: { slPct: 12, tpPct: 12, holdMax: 7 }, FILL_MODEL: 2,
    })
  })
  it('random 소스는 기본 규칙(12/12/7)', () => {
    const r = exitRule({ market: 'KRW-A', price: null }, 'random', 100)
    expect(r).toMatchObject({ holdMax: 7, rule: 'default' })
    expect(r.stopLoss).toBeCloseTo(88, 9)
    expect(r.takeProfit).toBeCloseTo(112, 9)
  })
})
