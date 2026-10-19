# 모의매매 강화 (스코어카드 판정 + 무작위 대조) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 11-05에 판정이 가능하도록 스코어카드 기반 판정 지표·검정력·실체결 보정을 리포트에 넣고, 무작위 대조 장부를 추가한다.

**Architecture:** 순수 함수 두 파일(`lib/verdict.mjs` 판정 계산, `lib/paper-random.mjs` 무작위 대조 유니버스·픽)을 만들고,
monitor는 스캔 기록에 `universe`만 더하며, paper-trade는 `SOURCES`에 `random`을 더한다. `paper:report`가 판정 섹션을 출력한다.

**Tech Stack:** Node ESM(.mjs), Vitest(`npx vitest run <file>`), 빌드 없음.

**Spec:** `docs/superpowers/specs/2026-10-19-paper-verdict-design.md`

## Global Constraints

- `lib/paper.mjs`의 `PAPER` 상수와 체결·청산 함수는 바꾸지 않는다(11-05까지 규칙 고정, 바뀌면 `modelChanges`가 생긴다).
- 스캐너 점수·픽·알림 불변. monitor에는 `entry.universe` 필드 하나만 추가.
- 판정 표본 시작: `2026-10-08T00:00:00Z`. 판정 임계 t = ±2, 최소 진입일 5일, 검정력 최소 효과 0.005, 보유 대기 7일.
- 비용: 짝 ≥ 10건이면 `max(−meanGap, 0.001)`, 아니면 `0.003`.
- 무작위 장부 이름 `random`, 화면 이름표 `무작위 대조`.

## Review Focus

- 스코어카드 에피소드의 `exit`가 없거나 `exitDay`가 null(진행 중) → 표본에서 빠지고 예외 없음.
- 기준선 `daily`가 비어 있음(파일 없음) → 판정 섹션이 "기준선 없음"으로 계속, 리포트 전체가 죽지 않음.
- 예전 monitor 스캔(`universe` 없음) → `random` 장부가 사지 않고 장부 실행은 정상.
- `random` 장부가 이미 보유한 종목이 셔플 앞쪽에 있음 → 건너뛰고 다음 종목을 산다(selectEntries).
- 판정 표본의 진입일이 1일뿐(t null) → `inconclusive`, 검정력 need null.

---

### Task 1: 판정 계산 `lib/verdict.mjs` — 표본·초과수익·판정·검정력

**Files:**
- Create: `lib/verdict.mjs`
- Test: `__tests__/verdict.test.mjs`

**Interfaces:**
- Consumes: `clusteredT(rows:{day,v}[]) → {mean,t,days}` (`lib/perf-metrics.mjs`), `baselineReturn(daily,d0,n)` (`lib/market-baseline.mjs`), `utcDay(iso)` (`lib/datetime.mjs`)
- Produces:
  - `VERDICT = { FROM: '2026-10-08T00:00:00Z', T: 2, MIN_DAYS: 5, MIN_EFFECT: 0.005, HOLD_WAIT_DAYS: 7, DEFAULT_COST: 0.003, MIN_COST: 0.001, MIN_PAIRS: 10 }`
  - `ruleRows(episodes, daily, { from, to, cost }) → { rows: {day,v,score}[], dropped: number }`
  - `decide(rows) → { verdict: 'pass'|'fail'|'inconclusive', reasons: string[], mean, t, days, halves: {first, second}, terciles: {low, mid, high} }`
  - `power(rows) → { sd, need, etaDay }` (etaDay = UTC 일 인덱스 또는 null)

- [ ] **Step 1: 실패 테스트 작성** — `__tests__/verdict.test.mjs`

```js
import { describe, it, expect } from 'vitest'
import { VERDICT, ruleRows, decide, power } from '../lib/verdict.mjs'

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
    // 전반 평균 음수가 되도록: 큰 양수 4일 + 앞쪽 음수
    const r = decide(rowsOf([-0.001, -0.001, -0.001, 0.05, 0.05, 0.05, 0.05], [1, 2, 3, 4, 5, 6, 7]))
    expect(r.halves.first).toBeLessThan(0)
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
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run __tests__/verdict.test.mjs` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `lib/verdict.mjs`

```js
// 모의매매 판정 — 스코어카드 에피소드(메인 픽 전부, 자금 제약 없음)로 11-05 판정을 낸다.
// 장부는 표본이 작아(10-19: 진입일 10일, 필요 약 257일) 판정 대신 실체결 비용 보정과 무작위 대조에 쓴다.
// 설계: docs/superpowers/specs/2026-10-19-paper-verdict-design.md. 판정 규칙은 결과를 보기 전에 정한 것이다(바꾸지 말 것).
import { clusteredT } from './perf-metrics.mjs'
import { baselineReturn } from './market-baseline.mjs'
import { utcDay } from './datetime.mjs'

export const VERDICT = {
  FROM: '2026-10-08T00:00:00Z', // 신호 정리(10-07~08) 뒤 픽만 — 그 전은 다른 스캐너다
  T: 2, MIN_DAYS: 5, MIN_EFFECT: 0.005, HOLD_WAIT_DAYS: 7,
  DEFAULT_COST: 0.003, MIN_COST: 0.001, MIN_PAIRS: 10,
}
const EXIT_DONE = ['sl', 'tp', 'time']
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// 에피소드 → 진입일별 행. v = 규칙 수익 − 같은 보유 구간 시장 수익 − 비용. 기준선이 없으면 dropped로 센다.
export function ruleRows(episodes, daily, { from = VERDICT.FROM, to = null, cost = VERDICT.DEFAULT_COST } = {}) {
  const rows = []
  let dropped = 0
  for (const e of episodes ?? []) {
    if (!e || e.lowLiquidity || !e.entryTs) continue
    if (e.entryTs < from || (to && e.entryTs >= to)) continue
    const x = e.exit
    if (!x || !EXIT_DONE.includes(x.reason) || !Number.isFinite(x.ret) || !Number.isFinite(x.exitDay)) continue
    const d0 = utcDay(e.entryTs)
    const m = baselineReturn(daily, d0, x.exitDay)
    if (m == null) { dropped++; continue }
    rows.push({ day: d0, v: x.ret - m - cost, score: e.score ?? 0 })
  }
  return { rows, dropped }
}

// 진입일 목록의 가운데 날 기준 전반/후반(가운데 날은 후반) — paper-report와 같은 방식.
function halves(rows) {
  const days = [...new Set(rows.map((r) => r.day))].sort((a, b) => a - b)
  if (days.length < 2) return { first: null, second: null }
  const mid = days[Math.floor(days.length / 2)]
  return {
    first: clusteredT(rows.filter((r) => r.day < mid)).mean,
    second: clusteredT(rows.filter((r) => r.day >= mid)).mean,
  }
}

function terciles(rows) {
  const s = [...rows].sort((a, b) => a.score - b.score)
  const k = Math.floor(s.length / 3)
  if (k < 1) return { low: null, mid: null, high: null, lowDays: 0, highDays: 0 }
  const low = clusteredT(s.slice(0, k)), high = clusteredT(s.slice(-k)), mid = clusteredT(s.slice(k, s.length - k))
  return { low: low.mean, mid: mid.mean, high: high.mean, lowDays: low.days, highDays: high.days }
}

export function decide(rows) {
  const c = clusteredT(rows)
  const h = halves(rows ?? [])
  const tr = terciles(rows ?? [])
  const reasons = []
  let verdict = 'inconclusive'
  if (c.days < VERDICT.MIN_DAYS) reasons.push(`표본 부족(진입일 ${c.days}일 < ${VERDICT.MIN_DAYS})`)
  else if (c.t != null && c.t <= -VERDICT.T) { verdict = 'fail'; reasons.push(`t ${c.t.toFixed(2)} ≤ −${VERDICT.T}`) }
  else if (c.t != null && c.t >= VERDICT.T) {
    const halvesOk = h.first > 0 && h.second > 0
    const scoreOk = tr.lowDays >= 2 && tr.highDays >= 2 && tr.high > tr.low
    if (!halvesOk) reasons.push('전반·후반 중 음(−)인 구간이 있음')
    if (!scoreOk) reasons.push('점수 상위 1/3이 하위 1/3보다 낫지 않음')
    if (halvesOk && scoreOk) { verdict = 'pass'; reasons.push(`t ${c.t.toFixed(2)} ≥ ${VERDICT.T}, 전·후반 양(+), 점수 상위 > 하위`) }
  } else reasons.push(`|t| < ${VERDICT.T}`)
  return { verdict, reasons, mean: c.mean, t: c.t, days: c.days, n: (rows ?? []).length, halves: h, terciles: tr }
}

// 검정력: 진입일 평균의 표준편차로 |t|=2에 필요한 진입일 수와 판정 가능 예상일(UTC 일 인덱스).
export function power(rows) {
  const byDay = new Map()
  for (const r of rows ?? []) { if (!Number.isFinite(r.v)) continue; const b = byDay.get(r.day) ?? []; b.push(r.v); byDay.set(r.day, b) }
  const dm = [...byDay.values()].map(mean)
  if (dm.length < 2) return { sd: null, need: null, etaDay: null }
  const mu = mean(dm)
  const sd = Math.sqrt(dm.reduce((a, b) => a + (b - mu) ** 2, 0) / (dm.length - 1))
  const delta = Math.max(Math.abs(mu), VERDICT.MIN_EFFECT)
  const need = Math.ceil((2 * sd / delta) ** 2)
  const first = Math.min(...byDay.keys())
  return { sd, need, etaDay: first + need + VERDICT.HOLD_WAIT_DAYS, days: dm.length }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run __tests__/verdict.test.mjs` / Expected: PASS. 실패한 테스트 데이터가 의도(예: 전반 음수)를 실제로 만들지 못하면 테스트 데이터를 고친다(구현을 테스트에 맞춰 비틀지 않는다).

- [ ] **Step 5: 커밋** — `git add lib/verdict.mjs __tests__/verdict.test.mjs && git commit -m "feat(verdict): scorecard-based verdict, halves, score terciles, power"`

### Task 2: 실체결 차이·무작위 대조 비교 (`lib/verdict.mjs` 추가)

**Files:**
- Modify: `lib/verdict.mjs` (끝에 추가)
- Test: `__tests__/verdict.test.mjs` (추가)

**Interfaces:**
- Produces:
  - `fillGap(trades, episodes) → { n, mean, t, days, byModel: {[model]: {n, mean}} }` — trades = 메인 장부 closed
  - `costFrom(gap) → { cost, source: 'measured'|'default' }`
  - `vsRandom(mainClosed, randomClosed) → { scans, mean, t, days }`

- [ ] **Step 1: 실패 테스트 추가**

```js
import { fillGap, costFrom, vsRandom } from '../lib/verdict.mjs'

describe('fillGap', () => {
  const ts = '2026-10-16T00:00:20.000Z'
  const eps = [{ market: 'KRW-A', entryTs: ts, exit: { reason: 'sl', ret: -0.12, exitDay: 2 } },
    { market: 'KRW-B', entryTs: ts, exit: { reason: 'open', ret: null } }]
  it('같은 market·같은 스캔만 짝짓고 gap = net − 에피소드 수익', () => {
    const trades = [
      { market: 'KRW-A', scanAt: Date.parse(ts), entryAt: Date.parse(ts) + 60_000, net: -0.135, fillModel: 2 },
      { market: 'KRW-A', scanAt: Date.parse(ts) + 3 * 3600_000, entryAt: 0, net: 0.1, fillModel: 2 }, // 다른 스캔
      { market: 'KRW-B', scanAt: Date.parse(ts), entryAt: 0, net: 0.1, fillModel: 2 }, // 에피소드 미청산
    ]
    const g = fillGap(trades, eps)
    expect(g.n).toBe(1)
    expect(g.mean).toBeCloseTo(-0.015, 9)
    expect(g.byModel[2].n).toBe(1)
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
```

- [ ] **Step 2: 실패 확인** — `npx vitest run __tests__/verdict.test.mjs` / Expected: FAIL (export 없음)

- [ ] **Step 3: 구현** — `lib/verdict.mjs` 끝에 추가

```js
// 실체결 차이: 메인 장부 청산 거래 ↔ 같은 market·같은 스캔(scanAt = 에피소드 entryTs)의 스코어카드 결과.
// gap = 장부 순수익(수수료·스프레드·손절 슬리피지·시간봉 판정) − 에피소드 일봉 원수익. 음수면 일봉 근사가 낙관적.
export function fillGap(trades, episodes) {
  const byKey = new Map()
  for (const e of episodes ?? []) {
    const x = e?.exit
    if (!x || !EXIT_DONE.includes(x.reason) || !Number.isFinite(x.ret)) continue
    byKey.set(`${e.market}@${Date.parse(e.entryTs)}`, x.ret)
  }
  const rows = []
  for (const t of trades ?? []) {
    const r = byKey.get(`${t.market}@${t.scanAt}`)
    if (r == null || !Number.isFinite(t.net)) continue
    rows.push({ day: Math.floor(t.scanAt / 86400_000), v: t.net - r, model: t.fillModel ?? 1 })
  }
  const c = clusteredT(rows)
  const byModel = {}
  for (const r of rows) { const b = (byModel[r.model] ||= { n: 0, sum: 0 }); b.n++; b.sum += r.v }
  for (const b of Object.values(byModel)) { b.mean = b.sum / b.n; delete b.sum }
  return { n: rows.length, mean: rows.length ? mean(rows.map((r) => r.v)) : null, t: c.t, days: c.days, byModel }
}

export function costFrom(gap) {
  if (!gap || gap.n < VERDICT.MIN_PAIRS || !Number.isFinite(gap.mean)) return { cost: VERDICT.DEFAULT_COST, source: 'default' }
  return { cost: Math.max(-gap.mean, VERDICT.MIN_COST), source: 'measured' }
}

// 무작위 대조(보조 지표): 같은 스캔에서 메인·무작위가 모두 청산한 경우만, 스캔별 (메인 평균 − 무작위 평균)을 진입일로 묶는다.
export function vsRandom(mainClosed, randomClosed) {
  const group = (list) => {
    const m = new Map()
    for (const c of list ?? []) { if (!Number.isFinite(c.net)) continue; const b = m.get(c.scanAt) ?? []; b.push(c.net); m.set(c.scanAt, b) }
    return m
  }
  const a = group(mainClosed), b = group(randomClosed)
  const rows = []
  for (const [scanAt, nets] of a) if (b.has(scanAt)) rows.push({ day: Math.floor(scanAt / 86400_000), v: mean(nets) - mean(b.get(scanAt)) })
  const c = clusteredT(rows)
  return { scans: rows.length, mean: c.mean, t: c.t, days: c.days }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run __tests__/verdict.test.mjs` / Expected: PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat(verdict): fill-gap calibration, cost selection, main vs random"` (새 파일 없음)

### Task 3: 무작위 대조 `lib/paper-random.mjs`

**Files:**
- Create: `lib/paper-random.mjs`
- Test: `__tests__/paper-random.test.mjs`

**Interfaces:**
- Consumes: `splitPremiumHot(items, kimchi) → {keep, hot}` (`lib/kimchi.mjs`), `LOW_LIQUIDITY_24H` (`lib/scan-universe.mjs`), `selectEntries` (`lib/paper.mjs`)
- Produces:
  - `randomUniverse({ markets: string[], tradePrice: {[m]: number}, warnOf: {[m]: string}, kimchi }) → string[]`
  - `randomPicks(scan: { timestamp: string, universe?: string[] }) → { market, korean_name, price: null, score: 0, signals: ['무작위 대조'] }[]`

- [ ] **Step 1: 실패 테스트** — `__tests__/paper-random.test.mjs`

```js
import { describe, it, expect } from 'vitest'
import { randomUniverse, randomPicks } from '../lib/paper-random.mjs'
import { selectEntries, newBook } from '../lib/paper.mjs'

describe('randomUniverse', () => {
  const tradePrice = { 'KRW-A': 6e8, 'KRW-B': 4e8, 'KRW-C': 9e8, 'KRW-D': 9e8 }
  it('5억 미만·경고 종목·국내 과열을 뺀다', () => {
    const kimchi = { btcPremium: 0.01, byMarket: { 'KRW-D': { premium: 0.05 }, 'KRW-A': { premium: 0.01 } } }
    const u = randomUniverse({ markets: ['KRW-A', 'KRW-B', 'KRW-C', 'KRW-D'], tradePrice, warnOf: { 'KRW-C': 'warning' }, kimchi })
    expect(u).toEqual(['KRW-A'])
  })
  it('김치프 조회 실패면 과열로 빼지 않는다', () => {
    const u = randomUniverse({ markets: ['KRW-A', 'KRW-D'], tradePrice, warnOf: {}, kimchi: { btcPremium: null, byMarket: {} } })
    expect(u).toEqual(['KRW-A', 'KRW-D'])
  })
  it('주의(caution)는 남긴다(메인과 같게)', () => {
    expect(randomUniverse({ markets: ['KRW-A'], tradePrice, warnOf: { 'KRW-A': 'caution' }, kimchi: null })).toEqual(['KRW-A'])
  })
})

describe('randomPicks', () => {
  const universe = Array.from({ length: 50 }, (_, i) => `KRW-X${i}`)
  it('같은 timestamp면 같은 순서(재현 가능)', () => {
    const s = { timestamp: '2026-10-20T00:00:30.000Z', universe }
    expect(randomPicks(s).map((p) => p.market)).toEqual(randomPicks(s).map((p) => p.market))
  })
  it('다른 timestamp면 순서가 다르고, 전 종목을 한 번씩 담는다', () => {
    const a = randomPicks({ timestamp: '2026-10-20T00:00:30.000Z', universe }).map((p) => p.market)
    const b = randomPicks({ timestamp: '2026-10-20T03:00:30.000Z', universe }).map((p) => p.market)
    expect(a).not.toEqual(b)
    expect([...a].sort()).toEqual([...universe].sort())
  })
  it('universe가 없으면 빈 목록(예전 스캔은 사지 않는다)', () => {
    expect(randomPicks({ timestamp: '2026-10-20T00:00:30.000Z' })).toEqual([])
    expect(randomPicks(null)).toEqual([])
  })
  it('selectEntries를 거치면 셔플 순서 유지 + 보유 종목 제외', () => {
    const picks = randomPicks({ timestamp: '2026-10-20T00:00:30.000Z', universe })
    const book = newBook()
    book.open.push({ market: picks[0].market })
    const want = selectEntries(book, picks)
    expect(want.map((p) => p.market)).toEqual([picks[1].market, picks[2].market, picks[3].market])
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run __tests__/paper-random.test.mjs` / Expected: FAIL

- [ ] **Step 3: 구현** — `lib/paper-random.mjs`

```js
// 무작위 대조 장부 — 메인 스캔과 같은 시각, 메인 픽이 될 수 있었던 종목 중 무작위로 산다.
// "스캐너 픽 − 무작위 픽" = 같은 청산 규칙·비용·시장에서 고르는 실력만 남는다(설계 2026-10-19-paper-verdict-design.md §3.4).
import { splitPremiumHot } from './kimchi.mjs'
import { LOW_LIQUIDITY_24H } from './scan-universe.mjs'

// monitor가 스캔 기록에 남기는 후보 종목: 일봉 판정이 된 종목 중 거래대금 5억↑, 경고 아님, 국내 과열 아님(메인 매수 목록과 같은 제외).
export function randomUniverse({ markets, tradePrice = {}, warnOf = {}, kimchi = null }) {
  const cand = (markets ?? []).filter((m) => (tradePrice[m] ?? 0) >= LOW_LIQUIDITY_24H && warnOf[m] !== 'warning')
  return splitPremiumHot(cand.map((market) => ({ market })), kimchi).keep.map((x) => x.market)
}

// 문자열 → 32비트 시드, mulberry32 — 같은 스캔이면 언제 다시 돌려도 같은 순서.
function seedOf(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function mulberry32(a) {
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// 스캔 → 셔플된 픽 전체(점수 0). paper의 selectEntries가 보유 종목을 빼고 앞에서 스캔당 상한만큼 자른다(안정 정렬).
export function randomPicks(scan) {
  if (!scan || !Array.isArray(scan.universe) || !scan.timestamp) return []
  const arr = [...scan.universe]
  const rnd = mulberry32(seedOf(String(scan.timestamp)))
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] }
  return arr.map((market) => ({ market, korean_name: market.replace('KRW-', ''), price: null, score: 0, signals: ['무작위 대조'] }))
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run __tests__/paper-random.test.mjs` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add lib/paper-random.mjs __tests__/paper-random.test.mjs && git commit -m "feat(paper): random control universe and seeded picks"`

### Task 4: monitor `universe` + paper-trade `random` 장부 + PAPER 불변 고정

**Files:**
- Modify: `scripts/monitor.mjs` (import 추가, `entry` 생성 직후 `entry.universe`)
- Modify: `scripts/paper-trade.mjs:21-25` (`SOURCES`에 random)
- Test: `__tests__/paper.test.mjs` (PAPER 스냅샷)

**Interfaces:**
- Consumes: `randomUniverse`, `randomPicks` (Task 3)

- [ ] **Step 1: PAPER 불변 테스트 추가** — `__tests__/paper.test.mjs` 끝

```js
describe('PAPER 규칙 고정(11-05까지)', () => {
  it('값이 바뀌면 paper-trade가 modelChanges를 남긴다 — 실험 중 바꾸지 않는다', () => {
    expect(PAPER).toEqual({
      START_CASH: 500_000, POSITION_KRW: 50_000, MAX_OPEN: 10, MAX_PER_SCAN: 3, FEE: 0.0005, STOP_SLIP: 0.002,
      MAX_SCAN_AGE_MS: 3 * 3600_000, DEFAULT_RULE: { slPct: 12, tpPct: 12, holdMax: 7 }, FILL_MODEL: 2,
    })
  })
  it('random 소스는 기본 규칙(12/12/7)', () => {
    expect(exitRule({ market: 'KRW-A', price: null }, 'random', 100)).toMatchObject({ stopLoss: 88, takeProfit: 112, holdMax: 7, rule: 'default' })
  })
})
```
Run: `npx vitest run __tests__/paper.test.mjs` / Expected: PASS(현재 값 고정 — 회귀 방지용). 또한 실제 장부와 대조: `node -e "import('./lib/paper.mjs').then(m=>{const s=require('./data/paper-trades.json');console.log(JSON.stringify(s.params)===JSON.stringify(m.PAPER))})"` → `true`.

- [ ] **Step 2: monitor 수정** — import 줄 추가

```js
import { randomUniverse } from '../lib/paper-random.mjs'
```
`entry.premiumHot = premiumHot` 바로 아래에:

```js
  // 무작위 대조 장부(paper-trade 'random')의 후보 — 메인 픽이 될 수 있었던 종목. 점수·알림과 무관한 기록 필드.
  entry.universe = randomUniverse({ markets: Object.keys(candleMap), tradePrice, warnOf, kimchi })
```

- [ ] **Step 3: paper-trade 수정** — import에 `import { randomPicks } from '../lib/paper-random.mjs'` 추가, `SOURCES`:

```js
const SOURCES = {
  main: { file: 'monitor-log.json', picksOf: (s) => s.buy },
  momentum: { file: 'momentum-log.json', picksOf: (s) => s.picks },
  // 무작위 대조: 메인과 같은 스캔·같은 규칙, 픽만 무작위(lib/paper-random.mjs). universe 없는 예전 스캔은 빈 목록.
  random: { file: 'monitor-log.json', picksOf: randomPicks },
}
```
`exitRule(pick, src, ...)`는 `src === 'main'`일 때만 `pick.exit`를 보므로 random은 `DEFAULT_RULE`. 다른 변경 없음.

- [ ] **Step 4: 문법·전체 테스트** — `node --check scripts/monitor.mjs && node --check scripts/paper-trade.mjs && npx vitest run` / Expected: 전부 PASS

- [ ] **Step 5: 커밋** — `git add -A scripts/monitor.mjs scripts/paper-trade.mjs __tests__/paper.test.mjs && git commit -m "feat(paper): random control book fed by monitor universe"`

### Task 5: `paper:report` 판정 섹션

**Files:**
- Modify: `scripts/research/paper-report.mjs` (설정 출력 직후, 장부 루프 전에 섹션 삽입)

**Interfaces:**
- Consumes: `VERDICT, ruleRows, decide, power, fillGap, costFrom, vsRandom` (Task 1·2)

- [ ] **Step 1: 구현** — import 추가 후 `console.log(\`규칙: ...\`)` 다음에:

```js
import { VERDICT, ruleRows, decide, power, fillGap, costFrom, vsRandom } from '../../lib/verdict.mjs'
```

```js
// ── 판정(스코어카드 기반, 설계 docs/superpowers/specs/2026-10-19-paper-verdict-design.md) ──
const dayStr = (d) => (d == null ? '-' : new Date(d * DAY).toISOString().slice(0, 10))
const VERDICT_KO = { pass: '✅ 통과 — 소액 실전 논의', fail: '⛔ 실패 — 반등 매수 신호를 참고용으로 내리고 재설계', inconclusive: '⏸ 판정 불가 — 판정 가능 예상일까지 연장' }
const sc = await readJson('scorecard.json', null)
console.log('\n══ 판정 (메인 픽 전부 = 스코어카드, 손절·익절 규칙 수익 − 시장 − 비용) ══')
if (!sc?.episodes?.length) console.log('  스코어카드 없음 — npm run scorecard 후 다시 실행')
else if (!Object.keys(daily).length) console.log('  시장 기준선 없음 — npm run scorecard가 data/market-baseline.json을 만든다')
else {
  const gap = fillGap(st.books.main?.closed ?? [], sc.episodes)
  const { cost, source } = costFrom(gap)
  const show = (label, from, to) => {
    const { rows, dropped } = ruleRows(sc.episodes, daily, { from, to, cost })
    const r = decide(rows), p = power(rows)
    console.log(`\n[${label}] ${r.n}건 · 진입일 ${r.days}일 · 평균 ${pct(r.mean)} (t ${tStr(r)})${dropped ? ` · 기준선 없어 제외 ${dropped}건` : ''}`)
    console.log(`  전반 ${pct(r.halves.first)} / 후반 ${pct(r.halves.second)} · 점수 하위 ${pct(r.terciles.low)} / 중간 ${pct(r.terciles.mid)} / 상위 ${pct(r.terciles.high)}`)
    console.log(`  검정력: |t|=2에 필요 진입일 ${p.need ?? '-'}일(지금 ${p.days ?? 0}일) · 판정 가능 예상 ${p.need != null && p.days >= p.need ? '지금 충분' : dayStr(p.etaDay)}`)
    return r
  }
  console.log(`비용 ${pct(cost)} (${source === 'measured' ? `실체결 차이 측정값, 짝 ${gap.n}건` : `기본 왕복 0.3% — 짝 ${gap.n}건 < ${VERDICT.MIN_PAIRS}`})`)
  const r = show(`판정 표본 ${VERDICT.FROM.slice(0, 10)}~`, VERDICT.FROM, null)
  console.log(`  ▶ ${VERDICT_KO[r.verdict]} · ${r.reasons.join(' · ')}`)
  console.log(`\n실체결 차이(장부 − 스코어카드 같은 스캔): 짝 ${gap.n}건 · 평균 ${pct(gap.mean)} (t ${tStr(gap)}, ${gap.days}일)` +
    (Object.keys(gap.byModel).length ? ` · ${Object.entries(gap.byModel).map(([m, b]) => `v${m} ${b.n}건 ${pct(b.mean)}`).join(' / ')}` : ''))
  const vr = vsRandom(st.books.main?.closed ?? [], st.books.random?.closed ?? [])
  console.log(`무작위 대조(보조, 두 장부 모두 자금 제약): 같은 스캔 ${vr.scans}회 · 메인 − 무작위 ${pct(vr.mean)} (t ${tStr(vr)}, ${vr.days}일)`)
  show('참고: 신호 정리 전 06-11~10-07 (판정에 안 씀)', '2026-06-01T00:00:00Z', VERDICT.FROM)
  console.log('\n모멘텀은 스코어카드 대상이 아니라 아래 장부로만 본다(스캔당 픽 평균 약 1개 — 장부가 사실상 픽 전부, 표본 작음).')
}
```

- [ ] **Step 2: 실제 실행** — `npm run paper:report` / Expected: 판정 섹션 + 기존 장부 출력(random 장부 포함, 아직 청산 0건), 예외 없음. 숫자 한두 개를 손으로 대조(예: 판정 표본 건수 = 스코어카드에서 10-08 이후·비저유동성·청산 확정 수).

- [ ] **Step 3: 커밋** — `git commit -am "feat(report): verdict section — scorecard verdict, power, fill gap, random control"`

### Task 6: 화면 이름표 (대시보드·봇)

**Files:**
- Modify: `lib/bot-commands.mjs:139`, `public/app.js:531-532`
- Test: `__tests__/bot-commands.test.mjs` (추가)

- [ ] **Step 1: 실패 테스트**

```js
  it('formatPaper: random 장부는 "무작위 대조"', () => {
    const t = formatPaper({ books: { random: { equity: 500000, ret: 0, open: [], summary: { n: 0 }, closed: [] } } })
    expect(t).toContain('무작위 대조')
  })
```
Run: `npx vitest run __tests__/bot-commands.test.mjs` / Expected: FAIL

- [ ] **Step 2: 구현**
  - `lib/bot-commands.mjs`: `const NAME = { main: '메인(반등)', momentum: '모멘텀', random: '무작위 대조' }`
  - `public/app.js`: `const LABEL = { main: '메인 (반등)', momentum: '모멘텀', random: '무작위 대조' }`,
    `const COLOR = { main: '#8b6cff', momentum: '#26e0a3', random: '#9aa4b8' }`
  - 장부 카드 그리드 `md:grid-cols-2` → `md:grid-cols-3`(장부 3개).

- [ ] **Step 3: 통과·전체** — `npx vitest run` / Expected: PASS
- [ ] **Step 4: 커밋** — `git commit -am "feat(ui): label random control book in dashboard and bot"`

### Task 7: 문서·실가동 확인·푸시

- [ ] README 모의매매 절에 장부 3개(무작위 대조 설명)·판정 방식(스코어카드, 3단 판정) 반영, `docs/CHANGELOG-2026-10.md` 7절에 한 항목 추가.
- [ ] 실가동: 봇·대시보드 재시작(코드 반영), 다음 정시 monitor 스캔 뒤 `data/monitor-log.json` 마지막 스캔에 `universe` 길이, `paper-trades.json`에 `books.random`과 `modelChanges` 길이 1 그대로인지 확인.
  (정시 전이면 `PAPER_TRIGGER=0` 없이 수동 스캔 금지 — 정시 근처 경합. 다음 정시를 기다린다.)
- [ ] `npx vitest run` 전체 통과 후 커밋·푸시.
