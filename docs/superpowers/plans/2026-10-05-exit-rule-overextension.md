# 과열 필터 + 일반픽 청산 레벨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 측정된 마이너스 엣지 구간(진입전 급등 후 진입)을 감점으로 제거하고, 모든 매수픽에 백테스트로 검증된 손절/목표가를 붙여 MFE 반납분(현재 90%)을 줄인다.

**Architecture:** 기존 `lib/strategy.mjs` 청산 엔진(`strategyLevels`/`scoreStrategyOutcome`)을 조용한바닥 전용에서 일반 매수픽으로 확장하고, 파라미터는 기록된 스코어카드 픽을 리플레이하는 그리드 백테스트로 선정한다. 과열 필터는 `lib/buy-modifiers.mjs`의 잘못 측정하던 `volRatio` 추격감점을 가격 상승폭 2단 감점으로 **교체**한다. 청산 레벨 출시는 백테스트가 "7일 보유 기준선"을 이기는지에 **게이트로 걸려 있다**.

**Tech Stack:** Node.js ESM (.mjs), vitest, 업비트 일봉 REST API

**Spec:** `docs/superpowers/specs/2026-10-03-exit-rule-overextension-design.md`

## Global Constraints

- **단위 규약:** 스코어카드의 `ret*`·`mfe*`·`exit.ret`은 **분수**로 저장한다 (`-0.1136` = -11.36%). 표시·리포트에서만 ×100 한다. 이 규약 위반은 실제로 발생한 100배 집계 오류의 원인이다.
- **가격 정밀도:** 손절·목표가는 **풀 정밀도**로 저장하고 포맷은 표시 시점에만 적용한다. `toFixed(2)`는 0.0x원대 코인에서 손절=목표로 붕괴한다 (`scripts/monitor.mjs:132` 주석).
- **스캔 불사침:** 설정 파일 부재·조회 실패 시 해당 기능만 조용히 생략하고 스캔은 정상 완료한다. 예외를 던져 스캔을 중단시키지 않는다.
- **테스트 관례:** `lib/`의 순수 함수는 유닛테스트 필수. `scripts/monitor.mjs`·스캐너 스크립트는 무테스트가 이 프로젝트 관례 — 테스트는 순수 함수에 집중한다.
- **기존 지표 보존:** `ret1/ret3/ret7`·`mfe1/mfe3/mfe7`의 계산과 값을 변경하지 않는다. 출시 게이트의 기준선이기 때문이다.
- **한글 주석·문자열은 Write/Edit 도구로만 작성한다.** PowerShell 경유 시 UTF-8 인코딩이 깨진다.
- **커밋 트레일러:** 모든 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **테스트 실행:** `npm test` (= `vitest run`). 기존 559 테스트가 전부 그린이어야 한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/indicators.mjs` (수정) | `calcRunUpPct` — 진입 전 가격 상승폭 순수 계산 |
| `lib/exit-select.mjs` (생성) | 백테스트 **판정 로직** 순수화 — 거래 요약, 이웃 안정성, 사전등록 규칙. 스크립트에서 분리해 테스트 가능하게 한다 |
| `scripts/exit-backtest.mjs` (생성) | I/O 오케스트레이션 — 캔들 조회, 그리드 실행, 리포트 출력, `exit-config.json` 기록. **게이트** |
| `data/exit-config.json` (생성물) | 선정된 `slPct`/`tpPct`/`holdMax`. git 커밋 |
| `lib/buy-modifiers.mjs` (수정) | `volRatio` 추격감점 제거 → 가격 과열 2단 감점 |
| `scripts/monitor.mjs` (수정) | `runUpPct` 계산·전달, `item.exit` 기록, 표시 폴백 |
| `lib/scorecard.mjs` (수정) | 청산 성과 채점 추가 (`exit` 필드), `extractEpisodes`가 `item.exit` 승계 |
| `scripts/scorecard.mjs` (수정) | 청산 채점 배선, `cfgSource` 판별 |
| `server/api.mjs` (수정) | 청산 성과 집계 노출 (live/backfill 분리) |

---

## Task 1: 진입 전 상승폭 계산 (`calcRunUpPct`)

**Files:**
- Modify: `lib/indicators.mjs` (파일 끝에 추가)
- Test: `__tests__/indicators.test.mjs` (파일 끝에 describe 블록 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `calcRunUpPct(closes: number[], lookback: number) => number | null` — **퍼센트 단위**로 반환한다(분수 아님). 이 함수만 퍼센트인 이유는 임계값(`20`, `35`)을 사람이 읽는 상수로 두기 위함이며, 저장되는 수익률(`ret`)과는 다른 축이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/indicators.test.mjs` 끝에 추가. import 목록에 `calcRunUpPct`를 넣는다.

```js
describe('calcRunUpPct', () => {
  it('상승폭을 퍼센트로 계산', () => {
    expect(calcRunUpPct([100, 110], 1)).toBeCloseTo(10)
    expect(calcRunUpPct([100, 120, 130], 2)).toBeCloseTo(30)
  })
  it('하락은 음수', () => {
    expect(calcRunUpPct([100, 90], 1)).toBeCloseTo(-10)
  })
  it('무변동은 0', () => {
    expect(calcRunUpPct([100, 100, 100], 2)).toBe(0)
  })
  it('경계: length === lookback + 1 이면 계산', () => {
    expect(calcRunUpPct([50, 75], 1)).toBeCloseTo(50)
  })
  it('데이터 부족이면 null', () => {
    expect(calcRunUpPct([100], 1)).toBeNull()
    expect(calcRunUpPct([100, 110], 5)).toBeNull()
    expect(calcRunUpPct([], 1)).toBeNull()
  })
  it('기준가가 0 이하면 null (0 나눗셈 가드)', () => {
    expect(calcRunUpPct([0, 50], 1)).toBeNull()
    expect(calcRunUpPct([-10, 50], 1)).toBeNull()
  })
  it('lookback이 1 미만이면 null', () => {
    expect(calcRunUpPct([100, 110], 0)).toBeNull()
    expect(calcRunUpPct([100, 110], -1)).toBeNull()
  })
  it('배열 아닌 입력이면 null', () => {
    expect(calcRunUpPct(null, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- indicators`
Expected: FAIL — `calcRunUpPct is not a function` (또는 import 에러)

- [ ] **Step 3: 구현**

`lib/indicators.mjs` 끝에 추가:

```js
// 진입 전 가격 상승폭(%) — 과열 판정용. lookback봉 전 종가 대비 최근 종가.
// 반환 단위는 퍼센트(10 = +10%). 임계 상수를 사람이 읽는 값으로 두기 위함이며,
// 분수로 저장되는 수익률(ret)과는 축이 다르다.
// 데이터 부족·기준가 0 이하·lookback 비정상이면 null.
export function calcRunUpPct(closes, lookback) {
  if (!Array.isArray(closes)) return null
  if (!(lookback >= 1)) return null
  if (closes.length < lookback + 1) return null
  const base = closes[closes.length - 1 - lookback]
  if (!(base > 0)) return null
  return (closes.at(-1) / base - 1) * 100
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- indicators`
Expected: PASS (신규 8 케이스 포함 전부 통과)

- [ ] **Step 5: 전체 회귀**

Run: `npm test`
Expected: 기존 559 + 신규 통과, 실패 0

- [ ] **Step 6: 커밋**

```bash
git add lib/indicators.mjs __tests__/indicators.test.mjs
git commit -m "feat(indicators): add calcRunUpPct for overextension measurement

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 백테스트 판정 로직 순수화 (`lib/exit-select.mjs`)

스크립트에서 **판정**을 분리한다. 그리드 선정·이웃 안정성·사전등록 규칙은 통계적 판단이므로 반드시 테스트되어야 하고, I/O와 섞이면 테스트할 수 없다.

**Files:**
- Create: `lib/exit-select.mjs`
- Test: `__tests__/exit-select.test.mjs`

**Interfaces:**
- Consumes: 없음 (순수)
- Produces:
  - `summarizeTrades(trades: {ret:number, reason:string}[]) => {n, winRate, meanRet, medianRet, reasons}` — `ret`는 **분수**
  - `cellKey(params: {slPct,tpPct,holdMax}) => string`
  - `neighborsOf(params, axes: {slPct:number[],tpPct:number[],holdMax:number[]}) => params[]`
  - `pickBest(cells: {params, summary}[], axes, {minTrades, baseline:{meanRet, medianRet}}) => {chosen, best, stability:{ratio, nbrMedian, stable}, passesGate, reason}`
  - `overextensionTable(rows: {runUpPct:number, fwd7:number}[], thresholds:number[]) => {threshold,n,winRate,medianRet}[]` — `fwd7`은 **분수**
  - `applyPreRegisteredRule(table, {tier1MedMax, tier1MinN, tier2MedMax, tier2MinN}) => {monotonic, tier1Pct, tier2Pct}` — `tier*MedMax`는 **분수**(-0.01 = -1%)

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/exit-select.test.mjs` 생성:

```js
import { describe, it, expect } from 'vitest'
import {
  summarizeTrades, cellKey, neighborsOf, pickBest,
  overextensionTable, applyPreRegisteredRule,
} from '../lib/exit-select.mjs'

describe('summarizeTrades', () => {
  it('승률·평균·중앙값·사유분포를 계산 (ret는 분수)', () => {
    const s = summarizeTrades([
      { ret: 0.10, reason: 'tp' }, { ret: -0.05, reason: 'sl' },
      { ret: 0.02, reason: 'time' }, { ret: -0.01, reason: 'time' },
    ])
    expect(s.n).toBe(4)
    expect(s.winRate).toBeCloseTo(0.5)
    expect(s.meanRet).toBeCloseTo(0.015)
    expect(s.medianRet).toBeCloseTo(0.005) // (-0.01 + 0.02)/2
    expect(s.reasons).toEqual({ tp: 1, sl: 1, time: 2 })
  })
  it('홀수 개수의 중앙값', () => {
    expect(summarizeTrades([{ ret: -0.1, reason: 'sl' }, { ret: 0.2, reason: 'tp' }, { ret: 0.05, reason: 'tp' }]).medianRet).toBeCloseTo(0.05)
  })
  it('비유효 거래(null/NaN)는 제외', () => {
    const s = summarizeTrades([{ ret: 0.1, reason: 'tp' }, { ret: null, reason: 'no-data' }, null, { ret: NaN, reason: 'x' }])
    expect(s.n).toBe(1)
  })
  it('빈 입력이면 n=0, 지표는 null', () => {
    const s = summarizeTrades([])
    expect(s).toEqual({ n: 0, winRate: null, meanRet: null, medianRet: null, reasons: {} })
  })
})

describe('neighborsOf', () => {
  const axes = { slPct: [5, 7, 10], tpPct: [8, 12], holdMax: [3, 5, 7] }
  it('각 축 ±1단계, 범위 밖은 제외', () => {
    const n = neighborsOf({ slPct: 7, tpPct: 8, holdMax: 5 }, axes)
    expect(n.map(cellKey).sort()).toEqual(['10/8/5', '5/8/5', '7/12/5', '7/8/3', '7/8/7'].sort())
  })
  it('모서리 셀은 이웃이 적다', () => {
    expect(neighborsOf({ slPct: 5, tpPct: 8, holdMax: 3 }, axes)).toHaveLength(3)
  })
})

describe('pickBest', () => {
  const axes = { slPct: [5, 7, 10], tpPct: [8, 12], holdMax: [3, 5] }
  const cell = (slPct, tpPct, holdMax, meanRet, winRate = 0.5, n = 500) =>
    ({ params: { slPct, tpPct, holdMax }, summary: { n, winRate, meanRet, medianRet: meanRet } })
  const baseline = { meanRet: 0.024, medianRet: 0.0 }

  it('minTrades 미달 셀은 후보에서 제외', () => {
    const cells = [cell(5, 8, 3, 0.20, 0.6, 10), cell(7, 8, 3, 0.05)]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.chosen.params.slPct).toBe(7)
  })
  it('후보가 전혀 없으면 passesGate=false', () => {
    const r = pickBest([cell(5, 8, 3, 0.2, 0.6, 10)], axes, { minTrades: 200, baseline })
    expect(r.chosen).toBeNull()
    expect(r.passesGate).toBe(false)
    expect(r.reason).toBe('no-eligible-cells')
  })
  it('이웃이 받쳐주면 최적 셀 채택 (stable)', () => {
    const cells = [
      cell(7, 8, 3, 0.10), cell(5, 8, 3, 0.09), cell(10, 8, 3, 0.08),
      cell(7, 12, 3, 0.09), cell(7, 8, 5, 0.08),
    ]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.chosen.params).toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
    expect(r.stability.stable).toBe(true)
    expect(r.passesGate).toBe(true)
  })
  it('혼자 튀는 봉우리는 불안정 → 안정성 비율 최대 셀로 교체', () => {
    const cells = [
      cell(7, 8, 3, 1.00),                                   // 봉우리(이웃 대비 과도)
      cell(5, 8, 3, 0.01), cell(10, 8, 3, 0.01),
      cell(7, 12, 3, 0.01), cell(7, 8, 5, 0.01),
      cell(5, 12, 3, 0.05), cell(5, 12, 5, 0.05), cell(10, 12, 3, 0.05), // 완만한 고원
    ]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.best.params).toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
    expect(r.stability.stable).toBe(false)
    expect(r.chosen.params).not.toEqual({ slPct: 7, tpPct: 8, holdMax: 3 })
  })
  it('기준선을 못 이기면 passesGate=false', () => {
    const cells = [cell(7, 8, 3, 0.01), cell(5, 8, 3, 0.009), cell(10, 8, 3, 0.009), cell(7, 12, 3, 0.009), cell(7, 8, 5, 0.009)]
    const r = pickBest(cells, axes, { minTrades: 200, baseline })
    expect(r.passesGate).toBe(false)
    expect(r.reason).toBe('below-baseline')
  })
})

describe('overextensionTable', () => {
  const rows = [
    { runUpPct: 10, fwd7: 0.05 }, { runUpPct: 25, fwd7: -0.02 },
    { runUpPct: 35, fwd7: -0.10 }, { runUpPct: 45, fwd7: -0.12 },
  ]
  it('임계 초과분만 집계', () => {
    const t = overextensionTable(rows, [20, 40])
    expect(t[0]).toMatchObject({ threshold: 20, n: 3 })
    expect(t[1]).toMatchObject({ threshold: 40, n: 1 })
    expect(t[0].winRate).toBe(0)
  })
  it('해당 없으면 n=0, 지표 null', () => {
    expect(overextensionTable(rows, [100])[0]).toEqual({ threshold: 100, n: 0, winRate: null, medianRet: null })
  })
})

describe('applyPreRegisteredRule', () => {
  const opts = { tier1MedMax: -0.01, tier1MinN: 60, tier2MedMax: -0.08, tier2MinN: 30 }
  it('조건을 만족하는 가장 작은 임계를 고른다 (argmax 아님)', () => {
    const table = [
      { threshold: 20, n: 159, winRate: 0.43, medianRet: -0.015 },
      { threshold: 30, n: 75, winRate: 0.35, medianRet: -0.062 },
      { threshold: 35, n: 59, winRate: 0.32, medianRet: -0.082 },
      { threshold: 50, n: 26, winRate: 0.19, medianRet: -0.137 },
    ]
    const r = applyPreRegisteredRule(table, opts)
    expect(r.tier1Pct).toBe(20)
    expect(r.tier2Pct).toBe(35) // 50은 n=26 < 30 이라 탈락
    expect(r.monotonic).toBe(true)
  })
  it('n 미달이면 그 임계는 선택되지 않는다', () => {
    const table = [{ threshold: 20, n: 10, winRate: 0.4, medianRet: -0.05 }]
    expect(applyPreRegisteredRule(table, opts).tier1Pct).toBeNull()
  })
  it('승률이 중간에 오르면 monotonic=false', () => {
    const table = [
      { threshold: 20, n: 100, winRate: 0.40, medianRet: -0.02 },
      { threshold: 30, n: 80, winRate: 0.48, medianRet: -0.03 },
    ]
    expect(applyPreRegisteredRule(table, opts).monotonic).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- exit-select`
Expected: FAIL — `Cannot find module '../lib/exit-select.mjs'`

- [ ] **Step 3: 구현**

`lib/exit-select.mjs` 생성:

```js
// 청산 파라미터 백테스트의 판정 로직 — 순수 함수.
// I/O(캔들 조회·파일 쓰기)는 scripts/exit-backtest.mjs가 담당하고
// 여기에는 통계적 판단만 둔다(테스트 가능성).
// 단위: ret·medianRet·meanRet는 분수(-0.05 = -5%). runUpPct·threshold만 퍼센트.

function median(sorted) {
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

// 거래 결과 배열 → 요약. ret이 유한수가 아닌 항목(no-data 등)은 제외한다.
export function summarizeTrades(trades) {
  const usable = (trades ?? []).filter((t) => t && Number.isFinite(t.ret))
  const n = usable.length
  if (n === 0) return { n: 0, winRate: null, meanRet: null, medianRet: null, reasons: {} }
  const rets = usable.map((t) => t.ret)
  const reasons = {}
  for (const t of usable) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1
  return {
    n,
    winRate: rets.filter((r) => r > 0).length / n,
    meanRet: rets.reduce((a, b) => a + b, 0) / n,
    medianRet: median([...rets].sort((a, b) => a - b)),
    reasons,
  }
}

export function cellKey(p) { return `${p.slPct}/${p.tpPct}/${p.holdMax}` }

// 각 축 ±1단계 이웃. 축 범위를 벗어나는 방향은 생략한다.
export function neighborsOf(params, axes) {
  const out = []
  for (const k of ['slPct', 'tpPct', 'holdMax']) {
    const vals = axes[k] ?? []
    const i = vals.indexOf(params[k])
    if (i < 0) continue
    for (const d of [-1, 1]) {
      const j = i + d
      if (j >= 0 && j < vals.length) out.push({ ...params, [k]: vals[j] })
    }
  }
  return out
}

const STABILITY_MIN_RATIO = 0.5 // 이웃 중앙값이 최적값의 50% 미만이면 봉우리로 간주

// 선정: minTrades 통과 셀 중 평균수익 최대(동률 시 승률) → 이웃 안정성 검사 → 채택.
// 불안정하면 기준선 이상인 셀 중 안정성 비율이 가장 높은 셀로 교체한다(스펙 §3.3.4).
export function pickBest(cells, axes, { minTrades, baseline }) {
  const eligible = (cells ?? []).filter((c) => c.summary.n >= minTrades)
  if (!eligible.length) {
    return { chosen: null, best: null, stability: null, passesGate: false, reason: 'no-eligible-cells' }
  }
  const byKey = new Map((cells ?? []).map((c) => [cellKey(c.params), c]))
  const stabilityOf = (c) => {
    const nbrs = neighborsOf(c.params, axes).map((p) => byKey.get(cellKey(p))).filter(Boolean)
    if (!nbrs.length) return { ratio: null, nbrMedian: null, stable: true } // 이웃 없음 → 판정 불가, 통과 처리
    const nbrMedian = median(nbrs.map((x) => x.summary.meanRet).sort((a, b) => a - b))
    const ratio = c.summary.meanRet > 0 ? nbrMedian / c.summary.meanRet : null
    return { ratio, nbrMedian, stable: ratio != null && ratio >= STABILITY_MIN_RATIO }
  }
  const best = [...eligible].sort((a, b) =>
    b.summary.meanRet - a.summary.meanRet || b.summary.winRate - a.summary.winRate)[0]
  let chosen = best
  let stability = stabilityOf(best)
  if (!stability.stable) {
    const cand = eligible
      .filter((c) => c.summary.meanRet >= baseline.meanRet)
      .map((c) => ({ c, s: stabilityOf(c) }))
      .filter((x) => x.s.ratio != null)
      .sort((a, b) => b.s.ratio - a.s.ratio)
    if (cand.length) { chosen = cand[0].c; stability = cand[0].s }
  }
  const passesGate = chosen.summary.meanRet >= baseline.meanRet && chosen.summary.medianRet >= baseline.medianRet
  return { chosen, best, stability, passesGate, reason: passesGate ? 'ok' : 'below-baseline' }
}

// 과열 임계별 집계. rows: [{ runUpPct(퍼센트), fwd7(분수) }]
export function overextensionTable(rows, thresholds) {
  return (thresholds ?? []).map((threshold) => {
    const g = (rows ?? []).filter((r) => r.runUpPct > threshold)
    if (!g.length) return { threshold, n: 0, winRate: null, medianRet: null }
    return {
      threshold,
      n: g.length,
      winRate: g.filter((r) => r.fwd7 > 0).length / g.length,
      medianRet: median(g.map((r) => r.fwd7).sort((a, b) => a - b)),
    }
  })
}

// 사전등록 규칙(스펙 §3.1) — argmax 금지.
// tier*MedMax는 분수(-0.01 = -1%). 조건을 만족하는 "가장 작은" 임계를 고른다.
// monotonic: 임계가 커질수록 승률이 비증가하는지(효과의 일관성 확인).
export function applyPreRegisteredRule(table, { tier1MedMax, tier1MinN, tier2MedMax, tier2MinN }) {
  const valid = (table ?? []).filter((r) => r.n > 0).sort((a, b) => a.threshold - b.threshold)
  let monotonic = true
  for (let i = 1; i < valid.length; i++) if (valid[i].winRate > valid[i - 1].winRate) monotonic = false
  const pick = (medMax, minN) => {
    const hit = valid.filter((r) => r.medianRet <= medMax && r.n >= minN)
    return hit.length ? hit[0].threshold : null
  }
  return { monotonic, tier1Pct: pick(tier1MedMax, tier1MinN), tier2Pct: pick(tier2MedMax, tier2MinN) }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- exit-select`
Expected: PASS (전 케이스)

- [ ] **Step 5: 전체 회귀**

Run: `npm test`
Expected: 실패 0

- [ ] **Step 6: 커밋**

```bash
git add lib/exit-select.mjs __tests__/exit-select.test.mjs
git commit -m "feat(exit-select): pure selection logic for exit-param backtest

Grid summary, neighbor-stability guard, and the pre-registered
overextension threshold rule (no argmax), split out from the script
so the statistical judgment is unit-testable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 백테스트 하네스 + **출시 게이트** (`scripts/exit-backtest.mjs`)

**이 태스크가 게이트다.** 리포트가 기준선을 이기지 못하면 Task 5~7은 진행하지 않는다.

**Files:**
- Create: `scripts/exit-backtest.mjs`
- Create (산출물): `data/exit-config.json`, `data/exit-backtest-report.json`

**Interfaces:**
- Consumes: `lib/exit-select.mjs`의 전 export, `lib/strategy.mjs::scoreStrategyOutcome`, `lib/indicators.mjs::calcRunUpPct`, `lib/upbit.mjs::getDayCandles/candlesToOhlcv`, `lib/ohlcv.mjs::confirmedOhlcv`, `lib/store.mjs::writeJson`
- Produces: `data/exit-config.json` = `{version:'general-exit-v1', confirmedAt, slPct, tpPct, holdMax}` (게이트 통과 시에만), `data/exit-backtest-report.json` = 전체 리포트

- [ ] **Step 1: 스크립트 작성**

스크립트는 무테스트 관례를 따른다(판정 로직은 Task 2에서 테스트됨). `scripts/exit-backtest.mjs` 생성:

```js
// 일반 매수픽 청산 파라미터 그리드 백테스트 — 기록된 스코어카드 에피소드 리플레이.
// 신호를 재생성하지 않는다: 스캐너 파이프라인(코인게코·펀딩·이벤트·레짐)에 의존해
// 캔들만으로 재현 불가하므로, 실제로 기록된 픽을 그대로 리플레이한다.
// simulateTrade(다음봉 시가 진입)가 아니라 scoreStrategyOutcome(스캔가 진입)을 쓴다 —
// 기록된 픽은 실제로 스캔가에 진입할 수 있었으므로 후자가 맞는 규약이다.
import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { scoreStrategyOutcome } from '../lib/strategy.mjs'
import { calcRunUpPct } from '../lib/indicators.mjs'
import { readJson, writeJson } from '../lib/store.mjs'
import { summarizeTrades, pickBest, overextensionTable, applyPreRegisteredRule, cellKey } from '../lib/exit-select.mjs'

const AXES = { slPct: [5, 7, 10, 12], tpPct: [6, 8, 12, 18, 25], holdMax: [3, 5, 7] }
const MIN_TRADES = 200
const TRAIN_END = '2026-08-15T23:59:59.999Z' // 학습/홀드아웃 경계 (스펙 §3.3.3)
const RUNUP_LOOKBACK = 7
const RUNUP_THRESHOLDS = [20, 25, 30, 35, 40, 50]
const RULE = { tier1MedMax: -0.01, tier1MinN: 60, tier2MedMax: -0.08, tier2MinN: 30 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(2) + '%')

async function main() {
  const sc = await readJson('scorecard.json', null)
  if (!sc?.episodes?.length) { console.error('스코어카드 없음 — scripts/scorecard.mjs 먼저 실행'); process.exit(1) }
  // 기준선 비교를 위해 ret7이 확정된 에피소드만 사용한다(동일 집합 원칙, 스펙 §3.3.2).
  const eps = sc.episodes.filter((e) => e.status === 'done' && e.ret7 != null && e.entryPrice > 0)
  console.log(`에피소드 ${eps.length}건 (전체 ${sc.episodes.length})`)

  // 마켓별 일봉 1회 조회
  const markets = [...new Set(eps.map((e) => e.market))]
  const candles = {}
  let skipped = 0
  for (const m of markets) {
    const c = await getDayCandles(m, 200)
    await sleep(200)
    if (!c || c.length < 30) { skipped++; continue }
    candles[m] = confirmedOhlcv(candlesToOhlcv(c))
  }
  console.log(`캔들 확보 ${Object.keys(candles).length} / 스킵 ${skipped}`)

  const usable = eps.filter((e) => candles[e.market])
  const train = usable.filter((e) => e.entryTs <= TRAIN_END)
  const holdout = usable.filter((e) => e.entryTs > TRAIN_END)
  console.log(`학습 ${train.length}건 (~${TRAIN_END.slice(0, 10)}) / 홀드아웃 ${holdout.length}건`)

  const nowMs = Date.now()
  // 기준선: 청산규칙 없이 7일 종가 보유. 선정값과 반드시 같은 집합에서 산출한다.
  const baselineOf = (set) => summarizeTrades(set.map((e) => ({ ret: e.ret7, reason: 'hold7' })))
  const trainBase = baselineOf(train)
  const holdBase = baselineOf(holdout)
  console.log(`\n[기준선 7일보유] 학습 n=${trainBase.n} 승률 ${pct(trainBase.winRate)} 평균 ${pct(trainBase.meanRet)} 중앙 ${pct(trainBase.medianRet)}`)

  const runGrid = (set) => {
    const cells = []
    for (const slPct of AXES.slPct) for (const tpPct of AXES.tpPct) for (const holdMax of AXES.holdMax) {
      const params = { slPct, tpPct, holdMax }
      const trades = set.map((e) => {
        const r = scoreStrategyOutcome(e, candles[e.market], params, nowMs)
        return r.reason === 'open' || r.reason === 'no-data' ? { ret: null, reason: r.reason } : { ret: r.ret, reason: r.reason }
      })
      cells.push({ params, summary: summarizeTrades(trades) })
    }
    return cells
  }

  const trainCells = runGrid(train)
  const sel = pickBest(trainCells, AXES, { minTrades: MIN_TRADES, baseline: trainBase })

  console.log('\n[상위 5조합 — 학습]')
  for (const c of [...trainCells].filter((c) => c.summary.n >= MIN_TRADES)
    .sort((a, b) => b.summary.meanRet - a.summary.meanRet).slice(0, 5)) {
    console.log(`  ${cellKey(c.params)}  n=${c.summary.n} 승률 ${pct(c.summary.winRate)} 평균 ${pct(c.summary.meanRet)} 중앙 ${pct(c.summary.medianRet)} ${JSON.stringify(c.summary.reasons)}`)
  }

  if (!sel.chosen) { console.log(`\n❌ 게이트 실패: ${sel.reason}`); await writeReport({ sel, trainBase, holdBase, trainCells, holdoutSummary: null, overext: null, regime: null }); process.exit(0) }

  console.log(`\n[선정] ${cellKey(sel.chosen.params)}  평균 ${pct(sel.chosen.summary.meanRet)} 중앙 ${pct(sel.chosen.summary.medianRet)}`)
  console.log(`[이웃안정성] 비율 ${sel.stability.ratio == null ? 'n/a' : sel.stability.ratio.toFixed(2)} (이웃중앙 ${pct(sel.stability.nbrMedian)}) → ${sel.stability.stable ? '안정' : '불안정(교체됨)'}`)
  if (cellKey(sel.best.params) !== cellKey(sel.chosen.params)) console.log(`  ⚠️ 최적 셀 ${cellKey(sel.best.params)}은 봉우리로 판정되어 교체됨`)

  // 홀드아웃은 확인용 1회만 — 보고 재선정하지 않는다.
  const holdTrades = holdout.map((e) => {
    const r = scoreStrategyOutcome(e, candles[e.market], sel.chosen.params, nowMs)
    return r.reason === 'open' || r.reason === 'no-data' ? { ret: null, reason: r.reason } : { ret: r.ret, reason: r.reason }
  })
  const holdoutSummary = summarizeTrades(holdTrades)
  console.log(`\n[홀드아웃 확인] n=${holdoutSummary.n} 승률 ${pct(holdoutSummary.winRate)} 평균 ${pct(holdoutSummary.meanRet)} 중앙 ${pct(holdoutSummary.medianRet)}`)
  console.log(`  vs 기준선 n=${holdBase.n} 평균 ${pct(holdBase.meanRet)} 중앙 ${pct(holdBase.medianRet)}`)

  // 레짐 구성비 — 아카이브의 스캔별 regime을 구간별로 집계
  const regime = await regimeComposition(TRAIN_END)
  console.log(`\n[레짐 구성비] 학습 ${JSON.stringify(regime.train)} / 홀드아웃 ${JSON.stringify(regime.holdout)}`)
  console.log('  ⚠️ 홀드아웃이 강세 구간에 몰리면 수치가 부풀어 보인다. 숫자만으로 결론 금지.')

  // 과열 민감도 — 학습 구간에서 사전등록 규칙 적용
  // 에피소드 참조를 함께 들고 간다 — 인덱스로 짝짓지 않는다(필터로 길이가 어긋난다).
  const rows = []
  for (const e of train) {
    const arr = candles[e.market]
    const d0 = Math.floor(Date.parse(e.entryTs) / 1000 / 86400)
    const upto = arr.filter((c) => Math.floor(c.time / 86400) < d0)
    const runUpPct = calcRunUpPct(upto.map((c) => c.close), RUNUP_LOOKBACK)
    if (runUpPct != null) rows.push({ runUpPct, fwd7: e.ret7, ep: e })
  }
  const table = overextensionTable(rows, RUNUP_THRESHOLDS)
  const rule = applyPreRegisteredRule(table, RULE)
  console.log('\n[과열 사전등록 규칙 — 학습 구간]')
  for (const r of table) console.log(`  >${r.threshold}%: n=${r.n} 승률 ${pct(r.winRate)} 중앙 ${pct(r.medianRet)}`)
  console.log(`  단조성 ${rule.monotonic ? '성립' : '❌ 불성립 — 과열 필터 보류'}`)
  console.log(`  ⇒ RUNUP_TIER1_PCT = ${rule.tier1Pct}, RUNUP_TIER2_PCT = ${rule.tier2Pct}`)

  // 과열 제외 부분집합 민감도 (스펙 §3.3.6)
  // 과열 에피소드를 id로 식별해 제외한다(인덱스 짝짓기 금지).
  const hotIds = new Set(
    rows.filter((r) => rule.tier2Pct != null && r.runUpPct > rule.tier2Pct).map((r) => r.ep.id),
  )
  const exHot = train.filter((e) => !hotIds.has(e.id))
  const exTrades = exHot.map((e) => {
    const r = scoreStrategyOutcome(e, candles[e.market], sel.chosen.params, nowMs)
    return r.reason === 'open' || r.reason === 'no-data' ? { ret: null, reason: r.reason } : { ret: r.ret, reason: r.reason }
  })
  const exSummary = summarizeTrades(exTrades)
  const exBase = baselineOf(exHot)
  console.log(`\n[과열 제외 민감도] n=${exSummary.n} 평균 ${pct(exSummary.meanRet)} vs 기준선 ${pct(exBase.meanRet)} → ${exSummary.meanRet >= exBase.meanRet ? '통과' : '⚠️ 미달'}`)

  console.log(`\n${sel.passesGate ? '✅ 게이트 통과' : '❌ 게이트 실패(기준선 미달)'} — ${sel.reason}`)
  await writeReport({ sel, trainBase, holdBase, trainCells, holdoutSummary, overext: { table, rule }, regime })

  if (sel.passesGate) {
    await writeJson('exit-config.json', {
      version: 'general-exit-v1',
      confirmedAt: new Date().toISOString(),
      slPct: sel.chosen.params.slPct,
      tpPct: sel.chosen.params.tpPct,
      holdMax: sel.chosen.params.holdMax,
    })
    console.log('data/exit-config.json 기록 완료')
  } else {
    console.log('기준선 미달 — exit-config.json을 쓰지 않는다. Task 5~7 중단.')
  }
}

// 아카이브 스캔의 regime.trend를 학습/홀드아웃 구간별로 집계
async function regimeComposition(trainEnd) {
  const { readFile } = await import('node:fs/promises')
  const { ARCHIVE } = await import('../lib/archive.mjs')
  const out = { train: {}, holdout: {} }
  try {
    const txt = await readFile(ARCHIVE, 'utf8')
    for (const line of txt.trim().split('\n')) {
      if (!line) continue
      let s
      try { s = JSON.parse(line) } catch { continue }
      const t = s?.regime?.trend
      if (!t || !s.timestamp) continue
      const b = s.timestamp <= trainEnd ? out.train : out.holdout
      b[t] = (b[t] ?? 0) + 1
    }
  } catch { /* 아카이브 없으면 빈 집계 — 리포트에 그대로 남긴다 */ }
  return out
}

async function writeReport(r) {
  await writeJson('exit-backtest-report.json', { generatedAt: new Date().toISOString(), ...r })
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: `ARCHIVE` export 확인**

`lib/archive.mjs`가 `ARCHIVE` 경로 상수를 export하는지 확인한다 (`scripts/seed-archive.mjs:4`가 이미 import하고 있으므로 존재해야 한다).

Run: `grep -n "export" lib/archive.mjs`
Expected: `ARCHIVE`가 export 목록에 있음. 없으면 `regimeComposition`의 import 경로를 실제 export명으로 맞춘다.

- [ ] **Step 3: 백테스트 실행 — 게이트 판정**

Run: `node scripts/exit-backtest.mjs`
Expected: 마켓 캔들 조회(수 분 소요) 후 리포트 출력. 마지막 줄이 `✅ 게이트 통과` 또는 `❌ 게이트 실패`.

**판정 기록:** 출력 전문을 `docs/superpowers/plans/` 옆이 아니라 커밋 메시지와 `data/exit-backtest-report.json`에 남긴다.

- [ ] **Step 4: 게이트 결과에 따른 분기**

- **게이트 통과:** `data/exit-config.json`이 생성됐는지 확인하고 Task 4로 진행
- **게이트 실패:** Task 4(과열 필터)만 진행하고 **Task 5·6·7은 중단**한다. 사용자에게 "청산 레벨은 기준선을 이기지 못해 출시하지 않는다"고 리포트 수치와 함께 보고한다. 파라미터를 바꿔가며 통과할 때까지 재시도하지 않는다 — 그것이 과적합이다.

또한 `단조성 ❌ 불성립`이 출력되면 **Task 4(과열 필터)도 보류**하고 사용자에게 보고한다.

- [ ] **Step 5: 커밋**

```bash
git add scripts/exit-backtest.mjs data/exit-config.json data/exit-backtest-report.json
git commit -m "feat(exit-backtest): replay recorded picks to select exit params

Grid (sl 5/7/10/12 x tp 6/8/12/18/25 x hold 3/5/7) replayed over
recorded scorecard episodes via scoreStrategyOutcome. Train/holdout
split at 2026-08-15, neighbor-stability guard, regime composition, and
the pre-registered overextension rule are all reported.

Gate result: <PASS|FAIL> — chosen <sl/tp/hold>, mean <x>% vs baseline <y>%

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**위 `<...>` 자리는 Step 3 실행 출력의 실제 수치로 치환한다** — 커밋 메시지가 게이트 판정의 기록이므로 비워두면 안 된다.

(게이트 실패 시 `data/exit-config.json`은 생성되지 않으므로 `git add`에서 제외한다.)

---

## Task 4: 과열 필터 — `volRatio` 추격감점 교체

**선행조건:** Task 3 리포트의 `단조성`이 **성립**이어야 한다. 불성립이면 이 태스크를 보류한다.

**Files:**
- Modify: `lib/buy-modifiers.mjs:1-43`
- Modify: `scripts/monitor.mjs` (import 추가, `ctx.runUpPct` 전달)
- Test: `__tests__/buy-modifiers.test.mjs`

**Interfaces:**
- Consumes: `lib/indicators.mjs::calcRunUpPct` (Task 1)
- Produces: `lib/buy-modifiers.mjs`가 `RUNUP_LOOKBACK` 상수를 export (monitor가 import). `applyBuyModifiers`의 `ctx`에 `runUpPct` 키 추가, 반환 객체에 `runUp: {pct, mult, tier}` 추가.

- [ ] **Step 1: Task 3 리포트에서 임계값 확보**

`data/exit-backtest-report.json`의 `overext.rule`에서 `tier1Pct`·`tier2Pct`를 읽는다.

Run: `node -e "const r=require('./data/exit-backtest-report.json'); console.log(JSON.stringify(r.overext.rule))"`

전체 표본 측정 기준 예상값은 `tier1Pct: 20`, `tier2Pct: 35`이지만 **학습 구간 리포트 값이 authoritative**하다. 아래 코드의 `RUNUP_TIER1_PCT`/`RUNUP_TIER2_PCT`를 그 값으로 채운다. 둘 중 하나가 `null`이면 해당 tier 감점을 생략하고(상수를 `null`로 두고 조건문이 건너뛰도록), 리포트에 그 사실을 남긴다.

- [ ] **Step 2: 실패하는 테스트 작성**

`__tests__/buy-modifiers.test.mjs` 끝에 추가. (아래 `20`/`35`는 Step 1에서 확정한 값으로 바꾼다.)

```js
describe('과열(가격 상승폭) 감점', () => {
  it('임계 미만이면 감점 없음', () => {
    const r = applyBuyModifiers(10, [], { ...base(), runUpPct: 19 })
    expect(r.score).toBe(10)
    expect(r.runUp.mult).toBe(1)
  })
  it('tier1 경계: 임계값과 같으면 감점 없음(초과만 감점)', () => {
    expect(applyBuyModifiers(10, [], { ...base(), runUpPct: 20 }).score).toBe(10)
  })
  it('tier1 초과 → ×0.85 + 라벨', () => {
    const r = applyBuyModifiers(10, [], { ...base(), runUpPct: 25 })
    expect(r.score).toBeCloseTo(8.5)
    expect(r.runUp.tier).toBe(1)
    expect(r.signals.some((s) => s.includes('과열주의'))).toBe(true)
  })
  it('tier2 초과 → ×0.60 (tier1과 중복 적용 안 함)', () => {
    const r = applyBuyModifiers(10, [], { ...base(), runUpPct: 40 })
    expect(r.score).toBeCloseTo(6.0)
    expect(r.runUp.tier).toBe(2)
    expect(r.signals.some((s) => s.includes('과열'))).toBe(true)
  })
  it('runUpPct가 null이면 감점 없음', () => {
    expect(applyBuyModifiers(10, [], { ...base(), runUpPct: null }).score).toBe(10)
  })
  it('[회귀] volRatio>=5는 더 이상 감점하지 않는다', () => {
    const r = applyBuyModifiers(10, [], { ...base(), volRatio: 9, runUpPct: 0 })
    expect(r.score).toBe(10)
    expect(r.signals.some((s) => s.includes('추격주의'))).toBe(false)
  })
  it('[회귀] pump=true가 과열 감점을 면제하지 않는다', () => {
    const r = applyBuyModifiers(10, [], { ...base(), pump: true, runUpPct: 40 })
    expect(r.score).toBeCloseTo(6.0)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- buy-modifiers`
Expected: FAIL — 과열 케이스는 `r.runUp`이 undefined, 회귀 케이스는 `volRatio: 9`에서 score가 8이 나옴

- [ ] **Step 4: 구현 — `lib/buy-modifiers.mjs`**

(a) 헤더 주석의 체인 설명에서 `추격`을 `과열`로 바꾸고, 파일 상단(import 아래)에 상수를 추가한다:

```js
// 과열(가격 상승폭) 2단 감점 — 기존 volRatio>=5 추격감점을 대체한다.
// 근거(기록된 픽 1,557건): 진입전 7일 상승폭이 클수록 단조적으로 악화
//   >20% 승률43%/중앙-1.5% … >35% 32%/-8.2% … >50% 19%/-13.7%
// 기존 감점은 같은 의도를 거래량으로 측정해 오탐이 컸다 — 라벨 픽의 79%(n=126)가
// 오히려 기준선을 상회(55%/+1.3%)했고 과열 포착률은 45%에 불과했다.
// 임계는 사전등록 규칙으로 선정(스펙 §3.1), 배수는 "약한 감점" 원칙으로 고정(피팅 안 함).
export const RUNUP_LOOKBACK = 7
const RUNUP_TIER1_PCT = 20   // Task 3 리포트 overext.rule.tier1Pct
const RUNUP_TIER2_PCT = 35   // Task 3 리포트 overext.rule.tier2Pct
const RUNUP_TIER1_MULT = 0.85
const RUNUP_TIER2_MULT = 0.60
```

(b) `ctx` 구조분해에 `runUpPct`를 추가한다 (`volRatio, pump,` 뒤):

```js
    fundingRate, circRatio, athChangePct, rank, caution, eventRisk, runUpPct,
```

(c) 기존 추격감점 2줄을 **삭제**한다:

```js
  // 추격 감점 ×0.8 (급증 후 진입). 🚀Pump Start는 면제.
  if (volRatio != null && volRatio >= 5 && !pump) { score *= 0.8; sig.push('⚠️추격주의(급등후)') }
```

그 자리에 다음을 넣는다:

```js
  // 과열 감점 — 진입 전 가격 상승폭 기준 2단. Pump Start 면제 없음:
  // 올바른 변수에선 초기 펌프는 상승폭이 작아 애초에 걸리지 않고,
  // 이미 크게 오른 상태의 Pump Start는 후기 펌프라 걸러야 맞다.
  const runUp = { pct: runUpPct ?? null, mult: 1, tier: 0 }
  if (runUpPct != null) {
    if (RUNUP_TIER2_PCT != null && runUpPct > RUNUP_TIER2_PCT) {
      runUp.mult = RUNUP_TIER2_MULT; runUp.tier = 2
      score *= runUp.mult; sig.push(`⚠️과열(${RUNUP_LOOKBACK}일 +${runUpPct.toFixed(0)}%)`)
    } else if (RUNUP_TIER1_PCT != null && runUpPct > RUNUP_TIER1_PCT) {
      runUp.mult = RUNUP_TIER1_MULT; runUp.tier = 1
      score *= runUp.mult; sig.push(`⚠️과열주의(${RUNUP_LOOKBACK}일 +${runUpPct.toFixed(0)}%)`)
    }
  }
```

(d) 반환 객체에 `runUp`을 추가한다:

```js
  return { score, signals: sig, lowLiq, dom, funding: { rate: fundingRate, mult: fundMult }, structuralRisk: sr, eventRisk: er, runUp }
```

**주의:** `volRatio`와 `pump`는 구조분해에 남겨둔다 — 제거하면 호출부가 넘기는 키와 어긋나 혼란을 준다. 다만 더 이상 점수에 쓰이지 않는다. (`pump`는 monitor가 다른 용도로도 넘기므로 ctx 계약을 유지한다.)

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- buy-modifiers`
Expected: PASS. 기존 테스트 중 `volRatio` 추격감점을 검증하던 케이스가 있으면 **삭제**한다(의도적 제거이므로 테스트도 함께 제거하고 커밋 메시지에 명시).

- [ ] **Step 6: monitor 배선**

`scripts/monitor.mjs`:

(a) import 추가:
```js
import { applyBuyModifiers, RUNUP_LOOKBACK } from '../lib/buy-modifiers.mjs'
import { calcStochastic, calcRunUpPct } from '../lib/indicators.mjs'
```
(기존 `import { applyBuyModifiers } from '../lib/buy-modifiers.mjs'`와 `import { calcStochastic } from '../lib/indicators.mjs'`를 각각 대체)

(b) `applyBuyModifiers` 호출 직전에 계산하고 ctx에 추가:
```js
      const runUpPct = calcRunUpPct(confirmed.map((c) => c.close), RUNUP_LOOKBACK)
```
ctx 객체의 `eventRisk: evE,` 다음 줄에:
```js
        runUpPct,
```

- [ ] **Step 7: 라이브 스캔 1회로 확인**

Run: `node scripts/monitor.mjs`
Expected: 정상 완료. 매수 상위 목록 출력. 과열 종목이 있으면 시그널에 `⚠️과열` 라벨이 붙는다.

Run: `node -e "const m=require('./data/monitor-log.json'); const l=m.scans.at(-1); const hot=(l.buy||[]).filter(p=>(p.signals||[]).some(s=>s.includes('과열'))); console.log('과열태그 픽:', hot.length, hot.slice(0,3).map(p=>p.korean_name+' '+p.score))"`
Expected: 숫자 출력(0일 수도 있음 — 과열은 전체의 5% 수준이므로 정상)

- [ ] **Step 8: 전체 회귀**

Run: `npm test`
Expected: 실패 0

- [ ] **Step 9: 커밋**

```bash
git add lib/buy-modifiers.mjs scripts/monitor.mjs __tests__/buy-modifiers.test.mjs
git commit -m "fix(buy-modifiers): replace volume-based chase penalty with price overextension guard

The volRatio>=5 penalty measured the wrong variable. Across 1,557
recorded picks it had 45% recall / 21% precision on actual
overextension, and 79% of what it flagged (n=126) beat the baseline at
55% win / +1.3% median -- it was demoting good picks.

Replaced with a 2-tier guard on pre-entry price run-up, whose effect is
monotonic (>20% 43% win -> >50% 19%). Thresholds come from the
pre-registered rule in the backtest report; multipliers are fixed at
0.85/0.60 rather than fitted. The !pump exemption is dropped: it was a
workaround for the wrong variable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 일반픽 청산 레벨 — 기록 + 표시

**선행조건:** Task 3 게이트 **통과**. 실패 시 이 태스크를 진행하지 않는다.

**Files:**
- Modify: `scripts/monitor.mjs`

**Interfaces:**
- Consumes: `data/exit-config.json` (Task 3), `lib/strategy.mjs::strategyLevels`
- Produces: 매수픽 레코드에 `item.exit = {slPct, tpPct, holdMax, stopLoss, takeProfit, cfgVersion}` (풀 정밀도)

- [ ] **Step 1: 설정 로드**

`scripts/monitor.mjs`에서 `strategyConfig`를 읽는 줄(현재 40행 부근) 옆에 추가:

```js
  const exitConfig = await readJson('exit-config.json', null) // 없으면 일반 청산 레벨 생략(스캔 불사침)
```

- [ ] **Step 2: 픽에 레벨 기록**

`const item = { market, ... }` 조립부에서 `if (strategyLv) item.strategy = strategyLv` 다음 줄에 추가:

```js
        if (exitConfig) {
          const el = strategyLevels(sig.price, exitConfig)
          // 풀 정밀도 저장 — 0.0x원대 코인에서 반올림하면 손절=목표로 붕괴한다.
          if (el) {
            item.exit = {
              slPct: exitConfig.slPct, tpPct: exitConfig.tpPct, holdMax: exitConfig.holdMax,
              stopLoss: el.stopLoss, takeProfit: el.takeProfit, cfgVersion: exitConfig.version,
            }
          }
        }
```

- [ ] **Step 3: 표시 폴백 추가**

현재 체인(269행 부근)의 마지막 `else if (b.pumpSL != null) ...` 다음에 추가:

```js
    else if (b.exit) lines.push(`  📐 청산 · 손절 ${fmt(b.exit.stopLoss)} / 목표 ${fmt(b.exit.takeProfit)} (${b.exit.holdMax}일)`)
```

우선순위는 `strategy`(조용한바닥) → `vbottomSL` → `pumpSL` → `exit` 순이며, 레벨 세트를 섞지 않는다(스펙 §3.2).

- [ ] **Step 4: 라이브 스캔으로 확인**

Run: `node scripts/monitor.mjs`
Expected: 정상 완료

Run: `node -e "const m=require('./data/monitor-log.json'); const l=m.scans.at(-1); const w=(l.buy||[]).filter(p=>p.exit); console.log('exit 기록 픽:', w.length, '/', (l.buy||[]).length); console.log(JSON.stringify(w[0]?.exit))"`
Expected: 전 매수픽에 `exit`가 붙음(`w.length === l.buy.length`). `stopLoss`/`takeProfit`이 반올림되지 않은 값

- [ ] **Step 5: 설정 부재 시 불사침 확인**

```bash
mv data/exit-config.json data/exit-config.json.bak
node scripts/monitor.mjs
mv data/exit-config.json.bak data/exit-config.json
```
Expected: 스캔이 정상 완료되고 `exit` 필드만 없음. 예외·크래시 없음

- [ ] **Step 6: 커밋**

```bash
git add scripts/monitor.mjs
git commit -m "feat(monitor): attach backtested exit levels to every buy pick

Records item.exit (full precision) on all buy picks so the scorecard can
measure the exit rule uniformly, and adds a display fallback after the
quiet-bottom / V-bottom / pump chain. Level sets are never mixed: the
(slPct, tpPct) pair was optimized jointly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 스코어카드 청산 성과 채점

**선행조건:** Task 3 게이트 **통과**.

**Files:**
- Modify: `lib/scorecard.mjs`
- Modify: `scripts/scorecard.mjs`
- Test: `__tests__/scorecard.test.mjs`

**Interfaces:**
- Consumes: `lib/strategy.mjs::scoreStrategyOutcome`, Task 5의 `item.exit`
- Produces: `scoreEpisodeExit(ep, confirmed, fallbackParams, nowMs) => ep'` — `ep.exit = {reason, ret, exitDay, cfgVersion, cfgSource}`. `ret`는 **분수**. `extractEpisodes`가 `item.exit`를 `ep.exitParams`로 승계.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/scorecard.test.mjs` 끝에 추가 (import에 `scoreEpisodeExit` 추가):

```js
describe('scoreEpisodeExit', () => {
  const DAY = 86400
  const d0 = Math.floor(Date.parse('2026-06-10T00:00:00Z') / 1000 / DAY)
  const bar = (dayOffset, { high, low, close }) => ({ time: (d0 + dayOffset) * DAY, high, low, close, open: close })
  const ep = (over = {}) => ({ id: 'x', market: 'KRW-X', entryTs: '2026-06-10T00:00:00Z', entryPrice: 100, status: 'done', ret1: 0.01, ret3: 0.02, ret7: 0.03, mfe1: 0.05, ...over })
  const params = { slPct: 10, tpPct: 18, holdMax: 7 }
  const now = Date.parse('2026-07-01T00:00:00Z')

  it('목표가 도달 → tp, ret은 분수', () => {
    const c = [bar(1, { high: 120, low: 99, close: 119 })]
    const r = scoreEpisodeExit(ep(), c, params, now)
    expect(r.exit.reason).toBe('tp')
    expect(r.exit.ret).toBeCloseTo(0.18)
    expect(r.exit.exitDay).toBe(1)
  })
  it('손절 도달 → sl', () => {
    const c = [bar(1, { high: 101, low: 85, close: 88 })]
    expect(scoreEpisodeExit(ep(), c, params, now).exit.reason).toBe('sl')
  })
  it('같은 봉에서 SL·TP 동시 도달 → 손절 우선(보수적)', () => {
    const c = [bar(1, { high: 130, low: 80, close: 100 })]
    const r = scoreEpisodeExit(ep(), c, params, now)
    expect(r.exit.reason).toBe('sl')
    expect(r.exit.ret).toBeCloseTo(-0.10)
  })
  it('미도달로 보유 만료 → time', () => {
    const c = [1, 2, 3, 4, 5, 6, 7].map((i) => bar(i, { high: 105, low: 95, close: 102 }))
    const r = scoreEpisodeExit(ep(), c, params, now)
    expect(r.exit.reason).toBe('time')
    expect(r.exit.ret).toBeCloseTo(0.02)
  })
  it('기존 ret/mfe를 변경하지 않는다 (순수 추가)', () => {
    const before = ep()
    const r = scoreEpisodeExit(before, [bar(1, { high: 120, low: 99, close: 119 })], params, now)
    expect(r.ret1).toBe(before.ret1)
    expect(r.ret7).toBe(before.ret7)
    expect(r.mfe1).toBe(before.mfe1)
  })
  it('픽에 스탬핑된 파라미터가 있으면 live, 없으면 backfill', () => {
    const c = [bar(1, { high: 120, low: 99, close: 119 })]
    const live = scoreEpisodeExit(ep({ exitParams: { slPct: 10, tpPct: 18, holdMax: 7, cfgVersion: 'general-exit-v1' } }), c, params, now)
    expect(live.exit.cfgSource).toBe('live')
    expect(live.exit.cfgVersion).toBe('general-exit-v1')
    expect(scoreEpisodeExit(ep(), c, params, now).exit.cfgSource).toBe('backfill')
  })
  it('파라미터가 아예 없으면 exit를 만들지 않는다', () => {
    expect(scoreEpisodeExit(ep(), [bar(1, { high: 120, low: 99, close: 119 })], null, now).exit).toBeUndefined()
  })
  it('entryPrice 비정상이면 no-data', () => {
    expect(scoreEpisodeExit(ep({ entryPrice: 0 }), [], params, now).exit.reason).toBe('no-data')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- scorecard`
Expected: FAIL — `scoreEpisodeExit is not a function`

- [ ] **Step 3: 구현 — `lib/scorecard.mjs`**

(a) 상단 import에 추가:
```js
import { scoreStrategyOutcome } from './strategy.mjs'
```

(b) `extractEpisodes`의 에피소드 객체에 `item.exit` 승계를 추가한다. `lowLiquidity: !!item.lowLiquidity,` 다음 줄:
```js
        exitParams: item.exit ?? null, // 픽 시점에 스탬핑된 청산 파라미터(없으면 백필 대상)
```

(c) 파일 끝에 추가:
```js
// 청산 규칙 성과 채점 — 기존 ret/mfe는 건드리지 않는 순수 추가.
// 파라미터 출처: 픽에 스탬핑된 exitParams(live) > 호출부가 넘긴 현재 설정(backfill).
// 소급 계산값과 라이브 확정값을 섞어 집계하면 안 되므로 cfgSource로 구분한다.
// ret 단위는 분수 — scoreStrategyOutcome의 규약을 그대로 따른다.
export function scoreEpisodeExit(ep, confirmed, fallbackParams, nowMs) {
  const stamped = ep.exitParams
  const params = stamped ?? fallbackParams
  if (!params) return { ...ep }
  const r = scoreStrategyOutcome(ep, confirmed, params, nowMs)
  return {
    ...ep,
    exit: {
      reason: r.reason,
      ret: r.ret ?? null,
      exitDay: r.exitDay ?? null,
      cfgVersion: params.cfgVersion ?? params.version ?? null,
      cfgSource: stamped ? 'live' : 'backfill',
    },
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- scorecard`
Expected: PASS

- [ ] **Step 5: 배치 배선 — `scripts/scorecard.mjs`**

`scoreEpisode`를 호출하는 지점을 찾아, 그 결과에 `scoreEpisodeExit`를 이어 적용한다. 설정은 `exit-config.json`에서 읽는다.

```js
// (import 추가)
import { scoreEpisodeExit } from '../lib/scorecard.mjs'
// (main 초기에)
const exitConfig = await readJson('exit-config.json', null) // 없으면 청산 채점 생략
```
그리고 기존 `const scored = scoreEpisode(ep, confirmed, nowMs)` 형태의 라인 뒤에:
```js
      const withExit = scoreEpisodeExit(scored, confirmed, exitConfig, nowMs)
```
이후 로직이 `scored` 대신 `withExit`를 쓰도록 변수명을 연결한다.

로그 한 줄을 추가해 live/backfill 구성을 드러낸다:
```js
  const live = episodes.filter((e) => e.exit?.cfgSource === 'live').length
  const back = episodes.filter((e) => e.exit?.cfgSource === 'backfill').length
  console.log(`청산 채점: live ${live} / backfill ${back}`)
```

- [ ] **Step 6: 배치 실행 확인**

Run: `node scripts/scorecard.mjs`
Expected: 기존 출력 + `청산 채점: live N / backfill M`

Run: `node -e "const s=require('./data/scorecard.json'); const e=s.episodes.filter(x=>x.exit); const P=x=>x*100; const d=e.filter(x=>['tp','sl','time'].includes(x.exit.reason)); const m=a=>a.reduce((x,y)=>x+y,0)/a.length; console.log('청산확정',d.length,'| 평균',P(m(d.map(x=>x.exit.ret))).toFixed(2)+'%','| 사유', d.reduce((a,x)=>{a[x.exit.reason]=(a[x.exit.reason]||0)+1;return a},{}))"`
Expected: 평균이 **분수×100 = 퍼센트**로 합리적 범위(한 자릿수~십몇 %)에 들어온다. 0.0x% 같은 값이 나오면 단위 버그다

- [ ] **Step 7: 전체 회귀**

Run: `npm test`
Expected: 실패 0

- [ ] **Step 8: 커밋**

```bash
git add lib/scorecard.mjs scripts/scorecard.mjs __tests__/scorecard.test.mjs
git commit -m "feat(scorecard): score exit-rule outcomes alongside ret/MFE

Adds ep.exit {reason, ret, exitDay, cfgVersion, cfgSource} computed by
the shared scoreStrategyOutcome. ret/mfe are left untouched -- they are
the release gate's baseline. cfgSource separates live-stamped params
from retroactive backfill so the two are never aggregated together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 대시보드 노출 (live/backfill 분리)

**선행조건:** Task 6 완료.

**Files:**
- Modify: `server/api.mjs` (스코어카드 집계부, 137행 부근)
- Test: `__tests__/api.test.mjs`

**Interfaces:**
- Consumes: `ep.exit` (Task 6)
- Produces: 스코어카드 API 응답에 `exitStats: {live: {...}, backfill: {...}}` 추가. 각 항목은 `{n, winRate, meanRet, medianRet, reasons}` (ret는 **분수**).

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/api.test.mjs`의 스코어카드 관련 describe에 추가 (기존 헬퍼·import 패턴을 따른다):

```js
it('청산 성과를 live/backfill로 분리 집계', () => {
  const sc = { updatedAt: 'x', episodes: [
    { id: 'a', status: 'done', ret7: 0.01, exit: { reason: 'tp', ret: 0.18, cfgSource: 'live' } },
    { id: 'b', status: 'done', ret7: -0.02, exit: { reason: 'sl', ret: -0.10, cfgSource: 'live' } },
    { id: 'c', status: 'done', ret7: 0.00, exit: { reason: 'time', ret: 0.02, cfgSource: 'backfill' } },
    { id: 'd', status: 'done', ret7: 0.00, exit: { reason: 'open', ret: null, cfgSource: 'live' } },
  ] }
  const out = buildScorecard(sc)
  expect(out.exitStats.live.n).toBe(2)       // open은 제외
  expect(out.exitStats.live.winRate).toBeCloseTo(0.5)
  expect(out.exitStats.backfill.n).toBe(1)
})
```

(함수명 `buildScorecard`는 `server/api.mjs`의 실제 집계 함수명으로 맞춘다 — Step 2에서 확인한다.)

- [ ] **Step 2: 집계 함수 확인**

Run: `grep -n "scorecard" server/api.mjs | head -20`
Expected: 137행 부근의 집계 함수명을 확인하고 테스트의 함수명·export 여부를 맞춘다. export되어 있지 않으면 테스트 가능하도록 export한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- api`
Expected: FAIL — `exitStats`가 undefined

- [ ] **Step 4: 구현**

`server/api.mjs`의 스코어카드 집계 함수에 추가. `lib/exit-select.mjs`의 `summarizeTrades`를 재사용한다(중복 구현 금지):

```js
import { summarizeTrades } from '../lib/exit-select.mjs'

// 청산 성과 — 소급(backfill)과 라이브 확정을 절대 합산하지 않는다.
// 'open'·'no-data'는 미확정이므로 summarizeTrades가 ret 비유한수로 걸러낸다.
function exitStatsOf(eps) {
  const pick = (src) => summarizeTrades(
    eps.filter((e) => e.exit?.cfgSource === src)
       .map((e) => ({ ret: e.exit.ret, reason: e.exit.reason })),
  )
  return { live: pick('live'), backfill: pick('backfill') }
}
```
그리고 응답 객체에 `exitStats: exitStatsOf(eps),`를 추가한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test -- api`
Expected: PASS

- [ ] **Step 6: 대시보드 표시**

대시보드 스코어카드 탭에 청산 성과 블록을 추가한다. **표시에서만 ×100**하고, live와 backfill을 **별도 행**으로 둔다. backfill 행에는 "소급 계산" 주석을 단다.

Run: `node server/server.mjs` 후 `curl -s localhost:8787/api/scorecard | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s).exitStats)))"`
Expected: `live`/`backfill` 양쪽 집계가 출력됨

- [ ] **Step 7: 전체 회귀**

Run: `npm test`
Expected: 실패 0

- [ ] **Step 8: 커밋**

```bash
git add server/api.mjs __tests__/api.test.mjs
git commit -m "feat(api): expose exit-rule performance split by live/backfill

Reuses summarizeTrades from lib/exit-select so the aggregation matches
the backtest exactly. live and backfill are never summed -- retroactive
numbers must not hide inside a headline result.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 최종 확인 (전 태스크 완료 후)

- [ ] `npm test` 전부 그린
- [ ] `node scripts/monitor.mjs` 정상 완료, 과열 태그·exit 레벨 확인
- [ ] `node scripts/scorecard.mjs` 정상 완료, live/backfill 분리 확인
- [ ] 메모리 갱신: 측정 결과(과열 2×2, MFE 반납률)와 게이트 판정을 기록
- [ ] 사용자 보고 시 **스펙 §8의 한계를 반드시 동반**한다:
  - 표본 3.5개월·레짐 혼합 한정
  - 에피소드 독립성 위반으로 신뢰구간이 낙관적
  - 과열 임계값은 인샘플(전향 재평가 2~3개월 후)
  - 추격감점 제거의 2차 효과(신규 유입 픽) 미측정
  - **순수 TA 엣지는 여전히 ≈0** — 이 작업은 엣지 생성이 아니라 마이너스 구간 제거·반납 축소다. 오버셀 금지
