import { describe, it, expect } from 'vitest'
import { VERDICT, ruleRows, decide, power, idealExit, fillGap, costFrom, vsRandom } from '../lib/verdict.mjs'

const D = (iso) => Math.floor(Date.parse(iso) / 86400_000)
const ep = (iso, ret, exitDay, extra = {}) => ({
  market: 'KRW-A', entryTs: iso, score: 5, lowLiquidity: false,
  exit: { reason: 'tp', ret, exitDay }, ...extra,
})
// 기준선: 모든 날 0 → 시장 수익 0
const flat = (from, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [D(from) + i, 0]))

describe('ruleRows', () => {
  const daily = flat('2026-10-01T00:00:00Z', 40)
  it('기간·저유동성·미청산·기준선 없음을 거르고 비용을 뺀다', () => {
    const eps = [
      ep('2026-10-09T00:00:00Z', 0.12, 2),
      ep('2026-10-07T00:00:00Z', 0.12, 2), // 기간 전
      ep('2026-10-09T03:00:00Z', 0.12, 2, { lowLiquidity: true }),
      ep('2026-10-09T03:00:00Z', null, null, { exit: { reason: 'open', ret: null, exitDay: null } }),
      ep('2026-10-09T03:00:00Z', 0.1, 2, { exit: undefined }),
      ep('2026-11-30T00:00:00Z', 0.12, 2), // 기준선 없음 → dropped
    ]
    const { rows, dropped } = ruleRows(eps, daily, { from: VERDICT.FROM, cost: 0.003 })
    expect(rows).toHaveLength(1)
    expect(rows[0].v).toBeCloseTo(0.117, 9)
    expect(rows[0].day).toBe(D('2026-10-09T00:00:00Z'))
    expect(dropped).toBe(1)
  })
  it('시장 수익을 같은 보유 구간만큼 뺀다', () => {
    const d = { ...daily, [D('2026-10-10T00:00:00Z')]: 0.05 }
    const { rows } = ruleRows([ep('2026-10-09T05:00:00Z', 0.12, 1)], d, { from: VERDICT.FROM, cost: 0 })
    expect(rows[0].v).toBeCloseTo(0.07, 9)
  })
  it('to를 주면 그 전까지만(참고 구간)', () => {
    const { rows } = ruleRows([ep('2026-10-02T00:00:00Z', 0.1, 1), ep('2026-10-09T00:00:00Z', 0.1, 1)], daily, { from: '2026-06-01T00:00:00Z', to: VERDICT.FROM, cost: 0 })
    expect(rows).toHaveLength(1)
  })
})

// 진입일 n일, 날마다 값 vals[i], 점수 scores[i]
const rowsOf = (vals, scores) => vals.map((v, i) => ({ day: 20000 + i, v, score: scores ? scores[i] : 5 }))

describe('decide', () => {
  it('t≥2·전후반 양·상위>하위면 pass', () => {
    const r = decide(rowsOf([0.02, 0.025, 0.02, 0.03, 0.035, 0.03], [1, 2, 3, 4, 5, 6])) // 하위 2.25% < 상위 3.25%
    expect(r.verdict).toBe('pass')
    expect(r.t).toBeGreaterThan(2)
  })
  it('t≤−2면 fail', () => {
    expect(decide(rowsOf([-0.02, -0.03, -0.025, -0.035, -0.02, -0.03])).verdict).toBe('fail')
  })
  it('t≥2여도 상위 점수가 하위보다 나쁘면 inconclusive', () => {
    const r = decide(rowsOf([0.035, 0.03, 0.025, 0.03, 0.02, 0.02], [1, 2, 3, 4, 5, 6]))
    expect(r.t).toBeGreaterThan(2)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reasons.join(' ')).toContain('점수')
  })
  it('t≥2여도 전반이나 후반이 음이면 inconclusive', () => {
    const r = decide(rowsOf([-0.001, -0.001, -0.001, 0.05, 0.05, 0.05, 0.05], [1, 2, 3, 4, 5, 6, 7]))
    expect(r.halves.first).toBeLessThan(0)
    expect(r.t).toBeGreaterThan(2)
    expect(r.verdict).toBe('inconclusive')
  })
  it('진입일 5일 미만이면 inconclusive(표본 부족)', () => {
    const r = decide(rowsOf([0.05, 0.06, 0.05, 0.06]))
    expect(r.verdict).toBe('inconclusive')
    expect(r.reasons.join(' ')).toContain('표본')
  })
  it('빈 표본도 예외 없이 inconclusive', () => {
    expect(decide([]).verdict).toBe('inconclusive')
  })
})

describe('power', () => {
  it('(2·sd/δ)² 진입일과 예상일(첫날+need+7)', () => {
    const rows = rowsOf([0.01, -0.01, 0.01, -0.01]) // mean 0 → δ=0.005, sd≈0.011547
    const p = power(rows)
    expect(p.sd).toBeCloseTo(0.011547, 5)
    expect(p.need).toBe(Math.ceil((2 * p.sd / 0.005) ** 2))
    expect(p.etaDay).toBe(20000 + p.need + 7)
  })
  it('진입일 1일이면 need null', () => {
    expect(power(rowsOf([0.01])).need).toBeNull()
  })
})

// 스코어카드 에피소드는 '처음 등장한 스캔'에만 생겨서, 장부가 나중 스캔에서 산 거래와 짝이 안 맞는다(10-19 실측 0/22).
// 그래서 장부 거래마다 같은 스캔가·같은 손절/익절 %로 스코어카드 채점(일봉)을 다시 계산해 비교한다.
describe('idealExit', () => {
  const scanAt = Date.parse('2026-10-16T00:00:20.000Z')
  const d0 = Math.floor(scanAt / 86400_000)
  const bar = (d, o) => ({ time: d * 86400, open: 100, high: 101, low: 99, close: 100, ...o })
  const trade = { scanAt, scanPrice: 100, entryPrice: 101, stopLoss: 101 * 0.88, takeProfit: 101 * 1.12, holdMax: 7 }
  const now = scanAt + 30 * 86400_000
  it('스캔가 기준 같은 % 손절선을 다음 날 일봉이 건드리면 sl −12%', () => {
    const r = idealExit(trade, [bar(d0), bar(d0 + 1, { low: 87 })], now)
    expect(r.reason).toBe('sl')
    expect(r.ret).toBeCloseTo(-0.12, 9)
  })
  it('아직 진행 중(open)이거나 스캔가가 없으면 null', () => {
    expect(idealExit(trade, [bar(d0), bar(d0 + 1)], scanAt + 2 * 86400_000)).toBeNull()
    expect(idealExit({ ...trade, scanPrice: null }, [bar(d0 + 1, { low: 87 })], now)).toBeNull()
  })
})

describe('fillGap', () => {
  const T = (scanAt, net, fillModel = 2) => ({ scanAt, net, fillModel })
  it('gap = 장부 순수익 − 일봉 채점 수익, 모델별로도', () => {
    const g = fillGap([{ trade: T(86400_000 * 20000, -0.135), ideal: -0.12 }, { trade: T(86400_000 * 20001, 0.1, 1), ideal: 0.12 }])
    expect(g.n).toBe(2)
    expect(g.mean).toBeCloseTo(-0.0175, 9)
    expect(g.byModel[2]).toMatchObject({ n: 1 })
    expect(g.byModel[1].mean).toBeCloseTo(-0.02, 9)
  })
  it('짝이 없으면 n 0, mean null', () => {
    expect(fillGap([])).toMatchObject({ n: 0, mean: null })
  })
})

describe('costFrom', () => {
  it('짝 10건 미만이면 기본 0.3%', () => {
    expect(costFrom({ n: 9, mean: -0.02 })).toEqual({ cost: 0.003, source: 'default' })
  })
  it('10건 이상이면 −평균, 하한 0.1%', () => {
    expect(costFrom({ n: 10, mean: -0.02 }).cost).toBeCloseTo(0.02, 9)
    expect(costFrom({ n: 10, mean: 0.01 })).toEqual({ cost: 0.001, source: 'measured' })
  })
})

describe('vsRandom', () => {
  it('같은 스캔에서 산 메인·무작위 평균 차이를 스캔 짝으로', () => {
    const S1 = Date.parse('2026-10-20T00:00:10Z'), S2 = Date.parse('2026-10-21T03:00:10Z')
    const main = [{ scanAt: S1, entryAt: S1, net: 0.1 }, { scanAt: S1, entryAt: S1, net: 0 }, { scanAt: S2, entryAt: S2, net: 0.02 }]
    const rnd = [{ scanAt: S1, entryAt: S1, net: -0.05 }, { scanAt: 99, entryAt: 99, net: 0.5 }]
    const r = vsRandom(main, rnd)
    expect(r.scans).toBe(1)
    expect(r.mean).toBeCloseTo(0.1, 9) // 메인 평균 0.05 − 무작위 −0.05
  })
})
