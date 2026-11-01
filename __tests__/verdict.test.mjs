import { describe, it, expect } from 'vitest'
import { clusteredT, hacT } from '../lib/perf-metrics.mjs'
import { VERDICT, ruleRows, decide, power, idealExit, fillGap, costFrom, vsRandom, SCORE_HYPOTHESIS, scoreRankDiff } from '../lib/verdict.mjs'

const D = (iso) => Math.floor(Date.parse(iso) / 86400_000)
const ep = (iso, ret, exitDay, extra = {}) => ({
  market: 'KRW-A', entryTs: iso, score: 5, lowLiquidity: false,
  exit: { reason: 'tp', ret, exitDay }, ...extra,
})
// 기준선: 모든 날 0 → 시장 수익 0
const flat = (from, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [D(from) + i, 0]))

describe('ruleRows', () => {
  const daily = flat('2026-10-01T00:00:00Z', 40)
  it('기간·저유동성·채점 없음·기준선 없음을 거르고 비용을 뺀다', () => {
    const eps = [
      ep('2026-10-09T00:00:00Z', 0.12, 2),
      ep('2026-10-07T00:00:00Z', 0.12, 2), // 기간 전
      ep('2026-10-09T03:00:00Z', 0.12, 2, { lowLiquidity: true }),
      ep('2026-10-09T03:00:00Z', 0.1, 2, { exit: undefined }), // 청산 채점 없음 → 건너뜀(날을 막지 않음)
      ep('2026-11-30T00:00:00Z', 0.12, 2), // 기준선 없음 → dropped
    ]
    const { rows, dropped } = ruleRows(eps, daily, { from: VERDICT.FROM, cost: 0.003 })
    expect(rows).toHaveLength(1)
    expect(rows[0].v).toBeCloseTo(0.117, 9)
    expect(rows[0].day).toBe(D('2026-10-09T00:00:00Z'))
    expect(dropped).toBe(1)
  })
  // 손절은 빨리 끝나고 기한 청산은 7일 뒤라, 결과가 일부만 나온 날을 넣으면 최근 날이 손절 위주로 채워진다(10-19 독립 리뷰:
  // 전체 −2.08% vs 결과가 다 나온 날만 −0.79%). 그날 진입한 에피소드가 하나라도 진행 중(open)이면 그날 전체를 뺀다.
  it('진행 중(open) 에피소드가 있는 진입일은 통째로 빼고 running으로 센다', () => {
    const eps = [
      ep('2026-10-09T00:00:00Z', 0.12, 2),
      ep('2026-10-10T00:00:00Z', -0.12, 1), // 같은 날 open이 있어 함께 빠진다
      ep('2026-10-10T03:00:00Z', null, null, { exit: { reason: 'open', ret: null, exitDay: null } }),
      ep('2026-10-11T00:00:00Z', null, null, { exit: { reason: 'no-data', ret: null, exitDay: null } }), // 최종 상태 — 날을 막지 않음
      ep('2026-10-11T03:00:00Z', 0.05, 7, { exit: { reason: 'time', ret: 0.05, exitDay: 7 } }),
    ]
    const { rows, running } = ruleRows(eps, daily, { from: VERDICT.FROM, cost: 0 })
    expect(rows.map((r) => r.day)).toEqual([D('2026-10-09T00:00:00Z'), D('2026-10-11T00:00:00Z')])
    expect(running).toBe(2)
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
  it('(2·sd/δ)² 진입일과 예상일(첫날+need+8)', () => {
    const rows = rowsOf([0.01, -0.01, 0.01, -0.01]) // mean 0 → δ=0.005, sd≈0.011547
    const p = power(rows)
    expect(p.sd).toBeCloseTo(0.011547, 5)
    expect(p.need).toBe(Math.ceil((2 * p.sd / 0.005) ** 2))
    expect(p.etaDay).toBe(20000 + p.need + 8) // 마지막 진입일의 7일 보유 결과가 다음 날 확정
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
  it('10건 이상이면 −평균, 하한은 기본 0.3%', () => {
    expect(costFrom({ n: 10, mean: -0.02 }).cost).toBeCloseTo(0.02, 9)
    expect(costFrom({ n: 10, mean: 0.01 })).toEqual({ cost: 0.003, source: 'measured' }) // 측정값이 좋아도 기본 0.3%보다 낮추지 않는다
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

describe('vsRandom — 결과가 다 나온 스캔만(10-23 독립 리뷰)', () => {
  const S = Date.parse('2026-10-22T12:01:00Z')
  it('어느 장부든 그 스캔 보유가 남아 있으면 그 스캔은 뺀다(일찍 끝난 극단값만 섞이는 우측 절단 편향)', () => {
    const main = [{ scanAt: S, net: -0.124 }], rnd = [{ scanAt: S, net: 0.1299 }]
    expect(vsRandom(main, rnd, { open: [{ scanAt: S }] }).scans).toBe(0)
    expect(vsRandom(main, rnd, { open: [] }).scans).toBe(1)
  })
})

describe('scoreRankDiff (사전 등록 가설: 점수 상위가 더 나쁜가)', () => {
  // 하루 6건: 점수 1,2 / 3,4 / 5,6. top = 5,6 · bottom = 1,2
  const day = (d, lo, hi) => [1, 2, 3, 4, 5, 6].map((score) => ({ day: d, score, v: score <= 2 ? lo : score >= 5 ? hi : 0 }))
  const days = (n, f) => Array.from({ length: n }, (_, i) => day(100 + i, ...f(i))).flat()

  it('등록 조건: 10-31부터, 진입일 20일', () => {
    expect(SCORE_HYPOTHESIS).toMatchObject({ FROM: '2026-10-31T00:00:00Z', TO: '2026-11-29T00:00:00Z', MIN_DAYS: 20, T: 2, MIN_EFFECT: 0.005, HAC_LAG: 7 })
  })
  it('상위가 충분히 나쁘면 reversed', () => {
    const r = scoreRankDiff(days(20, (i) => [0.02, -0.02 + (i % 2) * 0.01]))
    expect(r.verdict).toBe('reversed')
    expect(r.mean).toBeCloseTo(-0.035, 6)
    expect(r.days).toBe(20)
  })
  it('상위가 충분히 좋으면 works', () => {
    expect(scoreRankDiff(days(20, (i) => [-0.02, 0.02 + (i % 2) * 0.01])).verdict).toBe('works')
  })
  it('진입일이 20일 미만이면 차이가 커도 unresolved', () => {
    expect(scoreRankDiff(days(19, (i) => [0.02, -0.02 + (i % 2) * 0.01])).verdict).toBe('unresolved')
  })
  it('t가 커도 효과가 0.5%p 미만이면 unresolved', () => {
    expect(scoreRankDiff(days(20, (i) => [0.001, -0.001 + (i % 2) * 0.0001])).verdict).toBe('unresolved')
  })
  it('점수가 모두 같은 날·3건 미만인 날은 빼고 센다', () => {
    const tied = [1, 2, 3].map((n) => ({ day: 1, score: 5, v: n }))
    const thin = [{ day: 2, score: 1, v: 0 }, { day: 2, score: 9, v: 1 }]
    expect(scoreRankDiff([...tied, ...thin])).toMatchObject({ days: 0, tied: 1, thin: 1 })
  })
  it('앞 20일로 표본을 고정한다 — 뒤에 쌓인 날이 결론을 바꾸지 않는다', () => {
    const weak = days(20, (i) => [0, i % 2 ? 0.05 : -0.05])
    const later = Array.from({ length: 30 }, (_, i) => day(200 + i, 0.05, -0.05 + (i % 2) * 0.01)).flat()
    const a = scoreRankDiff(weak), b = scoreRankDiff([...weak, ...later])
    expect(b.days).toBe(20)
    expect(b.mean).toBeCloseTo(a.mean, 12)
    expect(b.verdict).toBe('unresolved')
  })
  it('앞 20일 안에 진행 중인 날이 있으면 결론을 보류한다', () => {
    const rows = days(20, (i) => [0.02, -0.02 + (i % 2) * 0.01])
    expect(scoreRankDiff(rows, { openDays: [105] })).toMatchObject({ pending: true, verdict: 'unresolved' })
    expect(scoreRankDiff(rows, { openDays: [125] })).toMatchObject({ pending: false, verdict: 'reversed' })
  })
  it('뉴이-웨스트 t만 넘고 일반 t가 못 넘으면 결론을 내지 않는다', () => {
    const r = scoreRankDiff(days(20, (i) => [0, i % 2 ? 0.03 : -0.05]))
    expect(Math.abs(r.t)).toBeGreaterThanOrEqual(2)
    expect(Math.abs(r.tPlain)).toBeLessThan(2)
    expect(r.verdict).toBe('unresolved')
  })
  it('ruleRows의 진행 중·기준선 없는 날을 받아 앞 20일이면 보류한다', () => {
    const iso = (i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString()
    const daily = flat('2026-10-01T00:00:00Z', 40)
    const eps = Array.from({ length: 21 }, (_, i) => [1, 2, 3].map((score) => ep(iso(i), score === 3 ? -0.05 + (i % 2) * 0.01 : 0.02, 1, { score }))).flat()
    const open = [...eps, ep(iso(3), 0, 0, { exit: { reason: 'open' } })]
    const a = ruleRows(open, daily, { cost: 0, from: iso(0) })
    expect(a.openDays).toEqual([D(iso(3))])
    expect(scoreRankDiff(a.rows, { openDays: a.openDays })).toMatchObject({ pending: true, verdict: 'unresolved' })
    const later = ep('2026-11-20T00:00:00Z', 0, 1)
    expect(ruleRows([later], daily, { cost: 0, from: iso(0) }).droppedDays).toEqual([D('2026-11-20T00:00:00Z')])
    const b = ruleRows(eps, daily, { cost: 0, from: iso(0) })
    expect(scoreRankDiff(b.rows, { openDays: b.openDays })).toMatchObject({ pending: false, verdict: 'reversed', days: 20 })
  })
  it('이웃한 날이 같이 움직이면 t를 낮춘다(뉴이-웨스트)', () => {
    const vals = Array.from({ length: 20 }, (_, i) => (i < 14 ? -0.03 : 0.01) + (i % 2 ? 0.002 : -0.002))
    const iid = clusteredT(vals.map((v, day) => ({ day, v }))).t
    expect(Math.abs(hacT(vals, 7))).toBeLessThan(Math.abs(iid))
  })
  it('동점은 같은 쪽으로 묶는다(하위 경계와 같은 점수는 하위)', () => {
    const rows = [{ score: 5, v: 1 }, { score: 5, v: 1 }, { score: 5, v: 1 }, { score: 6, v: 0 }, { score: 7, v: 0 }, { score: 8, v: -1 }].map((x) => ({ ...x, day: 1 }))
    expect(scoreRankDiff(rows).mean).toBeCloseTo(-1.5, 9) // top {7,8} 평균 −0.5 − bottom {5,5,5} 평균 1
  })
})
