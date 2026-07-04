# Momentum Scoring Engine (Subsystem A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pluggable, weighted momentum-scoring engine that runs in shadow mode alongside the existing scanner, producing a dual score (early-inflow + breakout-confirmation), tier, and heuristic confidence per coin — without touching the current output.

**Architecture:** New `lib/scoring/` module. Features are plugins (`compute(ctx)->raw` + optional `history(ctx)`); each declares a normalizer (`percentileVsUniverse` / `vsOwnHistory` / `fixedCurve`) that maps raw→0–100. A two-pass engine computes raws for the whole universe (pass 1), builds percentile distributions, then normalizes + weights per config (pass 2). Config (`scoring-config.json`) is the source of truth for weights/groups/cutoffs. `monitor.mjs` runs the engine on already-fetched candles and writes a `scoring` object into the archive for surfaced candidates; any engine error is caught and stored as `scoringError` so the live scan never breaks.

**Tech Stack:** Node ESM (`.mjs`), vitest. Reuses `lib/indicators.mjs` (calcEMA, calcVolRatio, calcBBWidthSeries), `lib/store.mjs`, `lib/archive.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-04-momentum-scoring-engine-design.md`

**Global rules:** Never modify existing `signals.mjs` scoring or the existing `buy`/`sell`/`regime` archive fields. New scoring is shadow-only. `compute`/`history` return `null` (never throw) on insufficient data; the engine excludes `null` features from weighted averages.

---

## File Structure

- Create `lib/scoring/normalizers.mjs` — 3 pure normalizers + dispatcher.
- Create `lib/scoring/features/index.mjs` — registry (array of feature modules).
- Create `lib/scoring/features/*.mjs` — one file per feature (10).
- Create `lib/scoring/config.mjs` — config loader + validation.
- Create `scoring-config.json` — weights, groups, cutoffs, thresholds, multipliers.
- Create `lib/scoring/engine.mjs` — two-pass engine, extension penalty, confidence, contextLabel, tier, archive-entry assembler.
- Create `lib/scoring/context.mjs` — FeatureContext builder from candles/ticker.
- Modify `scripts/monitor.mjs` — shadow-mode wiring (compute + archive attach + fallback).
- Create `__tests__/scoring/*.test.mjs` — per-unit tests.

---

## Task 1: Normalizers

**Files:**
- Create: `lib/scoring/normalizers.mjs`
- Test: `__tests__/scoring/normalizers.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { percentileVsUniverse, vsOwnHistory, fixedCurve, normalize } from '../../lib/scoring/normalizers.mjs'

describe('percentileVsUniverse', () => {
  const dist = [1, 2, 3, 4, 5]
  it('백분위 0/50/100', () => {
    expect(percentileVsUniverse(1, dist)).toBe(20)   // 1개 이하 / 5 = 20
    expect(percentileVsUniverse(3, dist)).toBe(60)    // 3개 이하 / 5 = 60
    expect(percentileVsUniverse(5, dist)).toBe(100)
  })
  it('raw null/NaN → null', () => {
    expect(percentileVsUniverse(null, dist)).toBe(null)
    expect(percentileVsUniverse(NaN, dist)).toBe(null)
  })
  it('빈 분포 → null', () => {
    expect(percentileVsUniverse(3, [])).toBe(null)
  })
})

describe('vsOwnHistory', () => {
  it('자기 이력 대비 백분위', () => {
    expect(vsOwnHistory(10, [1, 2, 3, 4, 10])).toBe(100)
    expect(vsOwnHistory(2, [1, 2, 3, 4, 10])).toBe(40)
  })
  it('이력 부족(<5) → null', () => {
    expect(vsOwnHistory(2, [1, 2])).toBe(null)
  })
  it('raw null → null', () => {
    expect(vsOwnHistory(null, [1, 2, 3, 4, 5])).toBe(null)
  })
})

describe('fixedCurve', () => {
  const bp = [[100, 0], [500, 40], [2000, 70], [10000, 100]]
  it('구간 보간 + 클램프', () => {
    expect(fixedCurve(100, bp)).toBe(0)
    expect(fixedCurve(300, bp)).toBe(20)     // 100~500 사이 절반
    expect(fixedCurve(50, bp)).toBe(0)       // 하한 클램프
    expect(fixedCurve(99999, bp)).toBe(100)  // 상한 클램프
  })
  it('raw null → null', () => {
    expect(fixedCurve(null, bp)).toBe(null)
  })
})

describe('normalize dispatcher', () => {
  it('전략별 위임', () => {
    expect(normalize('percentileVsUniverse', 5, { dist: [1, 2, 3, 4, 5] })).toBe(100)
    expect(normalize('fixedCurve', 100, { params: [[100, 0], [200, 100]] })).toBe(0)
  })
  it('알 수 없는 전략 → null', () => {
    expect(normalize('bogus', 5, {})).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run __tests__/scoring/normalizers.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// lib/scoring/normalizers.mjs
const bad = (v) => v == null || Number.isNaN(v)

// 유니버스 raw 분포 대비 백분위 (0~100). dist는 non-null raw 배열.
export function percentileVsUniverse(raw, dist) {
  if (bad(raw) || !Array.isArray(dist) || dist.length === 0) return null
  const le = dist.reduce((n, x) => n + (x <= raw ? 1 : 0), 0)
  return +(le / dist.length * 100).toFixed(1)
}

// 코인 자기 과거 분포 대비 백분위. hist 길이 5 미만이면 null.
export function vsOwnHistory(raw, hist, { minLen = 5 } = {}) {
  if (bad(raw) || !Array.isArray(hist) || hist.length < minLen) return null
  const clean = hist.filter((x) => !bad(x))
  if (clean.length < minLen) return null
  const le = clean.reduce((n, x) => n + (x <= raw ? 1 : 0), 0)
  return +(le / clean.length * 100).toFixed(1)
}

// 구간 보간(piecewise linear) + [0,100] 클램프. breakpoints=[[x,y],...] x 오름차순.
export function fixedCurve(raw, breakpoints) {
  if (bad(raw) || !Array.isArray(breakpoints) || breakpoints.length < 2) return null
  const bp = breakpoints
  if (raw <= bp[0][0]) return bp[0][1]
  if (raw >= bp[bp.length - 1][0]) return bp[bp.length - 1][1]
  for (let i = 1; i < bp.length; i++) {
    const [x0, y0] = bp[i - 1], [x1, y1] = bp[i]
    if (raw <= x1) return +(y0 + (y1 - y0) * ((raw - x0) / (x1 - x0))).toFixed(1)
  }
  return null
}

// 전략 위임. opts: { dist, hist, params }
export function normalize(strategy, raw, { dist, hist, params } = {}) {
  if (strategy === 'percentileVsUniverse') return percentileVsUniverse(raw, dist)
  if (strategy === 'vsOwnHistory') return vsOwnHistory(raw, hist, params || {})
  if (strategy === 'fixedCurve') return fixedCurve(raw, params)
  return null
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run __tests__/scoring/normalizers.test.mjs` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/normalizers.mjs __tests__/scoring/normalizers.test.mjs
git commit -m "feat(scoring): add 0-100 normalizers (percentile/ownHistory/fixedCurve)"
```

---

## Task 2: Feature plugin contract + registry + reference feature

Establishes the plugin shape via the first feature (`relativeVolume`) and the registry.

**Files:**
- Create: `lib/scoring/features/relativeVolume.mjs`
- Create: `lib/scoring/features/index.mjs`
- Test: `__tests__/scoring/features.contract.test.mjs`

**Contract (documented in index.mjs):**
```
{ name, defaultGroup: 'early'|'confirm', normalizer, params?, compute(ctx)->raw|null, history?(ctx)->number[] }
```
- `compute` returns a numeric raw or `null` (never throws on bad data).
- `history` (only for `vsOwnHistory` features) returns the comparison distribution.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import registry from '../../lib/scoring/features/index.mjs'
import relativeVolume from '../../lib/scoring/features/relativeVolume.mjs'

const ctx = (volumes) => ({ coin: { ohlcvDaily: volumes.map((v) => ({ volume: v, close: 10, high: 11, low: 9, open: 10, tradeValue: v * 10 })) } })

describe('feature contract', () => {
  it('registry는 배열이고 각 항목이 name/defaultGroup/normalizer/compute를 가진다', () => {
    expect(Array.isArray(registry)).toBe(true)
    for (const f of registry) {
      expect(typeof f.name).toBe('string')
      expect(['early', 'confirm']).toContain(f.defaultGroup)
      expect(typeof f.compute).toBe('function')
    }
  })
})

describe('relativeVolume', () => {
  it('오늘 거래량 / 20일 평균 (volRatio) 반환', () => {
    const vols = Array.from({ length: 20 }, () => 10).concat([30]) // 21봉, 마지막 3x
    const raw = relativeVolume.compute(ctx(vols))
    expect(raw).toBeCloseTo(3, 1)
  })
  it('캔들 부족(<21) → null', () => {
    expect(relativeVolume.compute(ctx([10, 10, 10]))).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL (modules not found).

- [ ] **Step 3: Implement**

```js
// lib/scoring/features/relativeVolume.mjs
import { calcVolRatio } from '../../indicators.mjs'
export default {
  name: 'relative_volume',
  defaultGroup: 'early',
  normalizer: 'percentileVsUniverse',
  compute(ctx) {
    const vols = ctx.coin?.ohlcvDaily?.map((c) => c.volume) || []
    if (vols.length < 21) return null
    const r = calcVolRatio(vols)
    return r == null || Number.isNaN(r) ? null : +r.toFixed(3)
  },
}
```

```js
// lib/scoring/features/index.mjs
// 피처 plugin 계약:
//   { name, defaultGroup:'early'|'confirm', normalizer, params?, compute(ctx)->raw|null, history?(ctx)->number[] }
//   compute/history는 데이터 부족 시 null 반환(throw 금지). 최종 group은 scoring-config.json이 우선.
import relativeVolume from './relativeVolume.mjs'
export default [relativeVolume]
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/features/relativeVolume.mjs lib/scoring/features/index.mjs __tests__/scoring/features.contract.test.mjs
git commit -m "feat(scoring): feature plugin contract + registry + relativeVolume"
```

---

## Task 3: Remaining feature compute functions

Each sub-task: add the file, register it in `features/index.mjs`, add a test, run, commit. All operate on `ctx.coin.ohlcvDaily` (chronological) and/or `ctx.coin.ticker`. Reuse `lib/indicators.mjs`.

Helpers used: `calcEMA(closes,p)`, `calcBBWidthSeries(closes,period,mult)` (returns width% series). `ohlcvDaily[i]` has `{open,close,high,low,volume,tradeValue}`.

### 3.1 relativeTradingValue (early, percentileVsUniverse)
`lib/scoring/features/relativeTradingValue.mjs`
```js
export default {
  name: 'relative_trading_value', defaultGroup: 'early', normalizer: 'percentileVsUniverse',
  compute(ctx) { const v = ctx.coin?.ticker?.acc_trade_price_24h; return v == null || Number.isNaN(v) ? null : v },
}
```
Test: raw equals ticker value; null ticker → null.

### 3.2 absTradingValue (early quality-guard, fixedCurve)
`lib/scoring/features/absTradingValue.mjs`
```js
export default {
  name: 'abs_trading_value', defaultGroup: 'early', normalizer: 'fixedCurve',
  params: [[1e8, 0], [5e8, 40], [2e9, 70], [1e10, 100]],
  compute(ctx) { const v = ctx.coin?.ticker?.acc_trade_price_24h; return v == null || Number.isNaN(v) ? null : v },
}
```
Test: raw passthrough; combined with fixedCurve(params) gives 40 at 5e8 (engine-level, covered in Task 5).

### 3.3 moneyAcceleration (early, vsOwnHistory)
raw = mean(tradeValue last 3) / mean(tradeValue last 10). history = same ratio over last 30 days.
`lib/scoring/features/moneyAcceleration.mjs`
```js
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
function ratioAt(tv, i) { // i = 인덱스(최신 포함), 자료 충분 가정
  const short = tv.slice(i - 2, i + 1), long = tv.slice(i - 9, i + 1)
  const l = mean(long); return l > 0 ? mean(short) / l : null
}
export default {
  name: 'money_acceleration', defaultGroup: 'early', normalizer: 'vsOwnHistory',
  compute(ctx) {
    const tv = ctx.coin?.ohlcvDaily?.map((c) => c.tradeValue) || []
    if (tv.length < 10) return null
    return ratioAt(tv, tv.length - 1)
  },
  history(ctx) {
    const tv = ctx.coin?.ohlcvDaily?.map((c) => c.tradeValue) || []
    const out = []
    for (let i = tv.length - 1; i >= 9 && out.length < 30; i--) { const r = ratioAt(tv, i); if (r != null) out.push(r) }
    return out
  },
}
```
Test: rising tradeValue → raw > 1; short data → null; history length ≤ 30.

### 3.4 consolidation (early, vsOwnHistory)
raw = tightness = −(max(high,N) − min(low,N)) / mean(close,N), N=10. Higher(덜 음수)=더 수축.
`lib/scoring/features/consolidation.mjs`
```js
function tightAt(o, i, N = 10) {
  const seg = o.slice(i - N + 1, i + 1); if (seg.length < N) return null
  const hi = Math.max(...seg.map((c) => c.high)), lo = Math.min(...seg.map((c) => c.low))
  const m = seg.reduce((x, c) => x + c.close, 0) / seg.length
  return m > 0 ? -((hi - lo) / m) : null
}
export default {
  name: 'consolidation', defaultGroup: 'early', normalizer: 'vsOwnHistory',
  compute(ctx) { const o = ctx.coin?.ohlcvDaily || []; return o.length < 10 ? null : tightAt(o, o.length - 1) },
  history(ctx) { const o = ctx.coin?.ohlcvDaily || []; const out = []; for (let i = o.length - 1; i >= 9 && out.length < 40; i--) { const t = tightAt(o, i); if (t != null) out.push(t) } return out },
}
```
Test: flat range → raw near 0(높음); wide range → raw very negative; short → null.

### 3.5 volCompression (early, vsOwnHistory)
raw = −BBwidth 최신값. history = −BBwidth 시리즈.
`lib/scoring/features/volCompression.mjs`
```js
import { calcBBWidthSeries } from '../../indicators.mjs'
export default {
  name: 'vol_compression', defaultGroup: 'early', normalizer: 'vsOwnHistory',
  compute(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    const bw = calcBBWidthSeries(closes, 20, 2); if (!bw.length) return null
    const v = bw.at(-1); return v == null || Number.isNaN(v) ? null : -v
  },
  history(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    return calcBBWidthSeries(closes, 20, 2).slice(-40).map((v) => -v)
  },
}
```
Test: low-vol series → high raw(덜 음수); short → null.

### 3.6 liquidity (early quality-guard, fixedCurve)
raw = median(tradeValue last 20).
`lib/scoring/features/liquidity.mjs`
```js
function median(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null }
export default {
  name: 'liquidity', defaultGroup: 'early', normalizer: 'fixedCurve',
  params: [[1e8, 0], [3e8, 40], [1e9, 70], [5e9, 100]],
  compute(ctx) { const tv = ctx.coin?.ohlcvDaily?.map((c) => c.tradeValue) || []; return tv.length < 20 ? null : median(tv.slice(-20)) },
}
```
Test: median math; short → null.

### 3.7 breakoutStrength (confirm, percentileVsUniverse)
raw = (close − priorHigh) / priorRange, prior = 최근 20봉(당일 제외).
`lib/scoring/features/breakoutStrength.mjs`
```js
export default {
  name: 'breakout_strength', defaultGroup: 'confirm', normalizer: 'percentileVsUniverse',
  compute(ctx) {
    const o = ctx.coin?.ohlcvDaily || []; if (o.length < 21) return null
    const prior = o.slice(-21, -1)
    const hi = Math.max(...prior.map((c) => c.high)), lo = Math.min(...prior.map((c) => c.low))
    const range = hi - lo; if (!(range > 0)) return null
    return +(((o.at(-1).close - hi) / range)).toFixed(3)
  },
}
```
Test: close above prior high → positive; inside range → negative; short → null.

### 3.8 trendAlignment (confirm, fixedCurve)
**EMA200을 쓰지 않는다(60봉만 확보되므로 위험).** 60봉 기반 정의: raw = (e20>e50) + (close>e20) + (e20 상승기울기 over 5봉), 0..3.
`lib/scoring/features/trendAlignment.mjs`
```js
import { calcEMA } from '../../indicators.mjs'
export default {
  name: 'trend_alignment', defaultGroup: 'confirm', normalizer: 'fixedCurve',
  params: [[0, 0], [1, 40], [2, 70], [3, 100]],
  compute(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []; if (closes.length < 60) return null
    const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50)
    const e20 = ema20.at(-1), e50 = ema50.at(-1), e20prev = ema20.at(-6)
    if ([e20, e50, e20prev].some((v) => v == null || Number.isNaN(v))) return null
    const slopeUp = (e20 - e20prev) / e20prev > 0.005
    return (e20 > e50 ? 1 : 0) + (closes.at(-1) > e20 ? 1 : 0) + (slopeUp ? 1 : 0)
  },
}
```
Test: 60봉 상승 시리즈 → 3(정렬+가격상단+기울기); 하락 시리즈 → 0; 60봉 미만 → null.

### 3.9 volExpansionOnBreakout (confirm, vsOwnHistory)
raw = (가격 5봉 상승 시) BBwidth.at(-1)/mean(BBwidth last 20) else 0. relativeVolume(거래량)과 의미 분리: 이건 **돌파 시 변동성 밴드 확장**.
`lib/scoring/features/volExpansionOnBreakout.mjs`
```js
import { calcBBWidthSeries } from '../../indicators.mjs'
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
export default {
  name: 'vol_expansion_on_breakout', defaultGroup: 'confirm', normalizer: 'vsOwnHistory',
  compute(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    const bw = calcBBWidthSeries(closes, 20, 2); if (bw.length < 20 || closes.length < 6) return null
    const up = closes.at(-1) > closes.at(-6)
    return up ? +(bw.at(-1) / mean(bw.slice(-20))).toFixed(3) : 0
  },
  history(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    const bw = calcBBWidthSeries(closes, 20, 2); const out = []
    for (let i = bw.length - 1; i >= 19 && out.length < 30; i--) out.push(bw[i] / mean(bw.slice(i - 19, i + 1)))
    return out
  },
}
```
Test: expanding width + up → raw > 1; price down → 0; short → null.

**After each sub-task** append the feature to `features/index.mjs` import list, run its test, commit:
```bash
git add lib/scoring/features/<file>.mjs lib/scoring/features/index.mjs __tests__/scoring/<file>.test.mjs
git commit -m "feat(scoring): <feature_name> compute"
```

Final `features/index.mjs` exports all 10 in the order: relativeVolume, relativeTradingValue, absTradingValue, moneyAcceleration, consolidation, volCompression, liquidity, breakoutStrength, trendAlignment, volExpansionOnBreakout.

---

## Task 4: Config loader + validation

**Files:**
- Create: `scoring-config.json`
- Create: `lib/scoring/config.mjs`
- Test: `__tests__/scoring/config.test.mjs`

`scoring-config.json`:
```json
{
  "version": "scoring-v1",
  "weights": {
    "relative_volume": 1.0, "relative_trading_value": 1.0, "abs_trading_value": 0.3,
    "money_acceleration": 1.3, "consolidation": 1.0, "vol_compression": 1.0, "liquidity": 0.3,
    "breakout_strength": 1.0, "trend_alignment": 0.8, "vol_expansion_on_breakout": 0.8
  },
  "groups": {
    "relative_volume": "early", "relative_trading_value": "early", "abs_trading_value": "early",
    "money_acceleration": "early", "consolidation": "early", "vol_compression": "early", "liquidity": "early",
    "breakout_strength": "confirm", "trend_alignment": "confirm", "vol_expansion_on_breakout": "confirm"
  },
  "tierCutoffs": { "S": 85, "A": 70, "B": 55, "C": 40 },
  "thresholds": { "earlyHigh": 70, "confirmHigh": 60, "extensionLow": 0.15 },
  "regimeMultiplier": { "bull": 1.1, "neutral": 1.0, "bear": 0.9 },
  "qualityGuard": { "liquidity": { "mode": "weight" }, "abs_trading_value": { "mode": "weight" } },
  "archiveTopN": 20
}
```

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { validateConfig, resolveGroup } from '../../lib/scoring/config.mjs'
import registry from '../../lib/scoring/features/index.mjs'

const base = { weights: { relative_volume: 1 }, groups: { relative_volume: 'early' }, tierCutoffs: { S: 85, A: 70, B: 55, C: 40 } }

describe('validateConfig', () => {
  it('정상 config → errors 없음', () => {
    expect(validateConfig(base, registry).errors).toEqual([])
  })
  it('음수 weight → error', () => {
    const r = validateConfig({ ...base, weights: { relative_volume: -1 } }, registry)
    expect(r.errors.some((e) => e.includes('negative'))).toBe(true)
  })
  it('없는 feature weight → warning', () => {
    const r = validateConfig({ ...base, weights: { ...base.weights, ghost: 1 } }, registry)
    expect(r.warnings.some((w) => w.includes('ghost'))).toBe(true)
  })
  it('잘못된 group → error', () => {
    const r = validateConfig({ ...base, groups: { relative_volume: 'sideways' } }, registry)
    expect(r.errors.some((e) => e.includes('group'))).toBe(true)
  })
  it('tierCutoffs 비단조 → warning', () => {
    const r = validateConfig({ ...base, tierCutoffs: { S: 50, A: 70, B: 55, C: 40 } }, registry)
    expect(r.warnings.some((w) => w.includes('monotonic'))).toBe(true)
  })
})

describe('resolveGroup', () => {
  it('config group 우선', () => {
    expect(resolveGroup('relative_volume', { relative_volume: 'confirm' }, registry)).toBe('confirm')
  })
  it('config 없으면 plugin defaultGroup fallback', () => {
    expect(resolveGroup('relative_volume', {}, registry)).toBe('early')
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement**

```js
// lib/scoring/config.mjs
export function resolveGroup(name, groups = {}, registry = []) {
  if (groups[name]) return groups[name]
  const f = registry.find((x) => x.name === name)
  return f ? f.defaultGroup : null
}

export function validateConfig(config, registry = []) {
  const errors = [], warnings = []
  const known = new Set(registry.map((f) => f.name))
  for (const [name, w] of Object.entries(config.weights || {})) {
    if (typeof w !== 'number' || Number.isNaN(w)) errors.push(`weight for ${name} is not a number`)
    else if (w < 0) errors.push(`weight for ${name} is negative`)
    if (!known.has(name)) warnings.push(`weight for unknown feature: ${name}`)
  }
  for (const [name, g] of Object.entries(config.groups || {})) {
    if (g !== 'early' && g !== 'confirm') errors.push(`invalid group '${g}' for ${name}`)
  }
  const t = config.tierCutoffs || {}
  if (!(t.S > t.A && t.A > t.B && t.B > t.C)) warnings.push('tierCutoffs not monotonic (S>A>B>C)')
  return { errors, warnings }
}

// 로더: config JSON을 읽고 검증. hard error 시 throw.
export async function loadScoringConfig(readJson, registry) {
  const config = await readJson('scoring-config.json', null)
  if (!config) throw new Error('scoring-config.json missing')
  const { errors, warnings } = validateConfig(config, registry)
  if (errors.length) throw new Error('scoring-config invalid: ' + errors.join('; '))
  for (const w of warnings) console.warn('[scoring-config]', w)
  return config
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scoring-config.json lib/scoring/config.mjs __tests__/scoring/config.test.mjs
git commit -m "feat(scoring): config loader + validation (weights/groups/tiers)"
```

---

## Task 5: Two-pass engine core (raws → normalize → dual weighted score)

**Files:**
- Create: `lib/scoring/engine.mjs`
- Test: `__tests__/scoring/engine.core.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { computeRaws, buildUniverseDist, scoreCoin, weightedAverage } from '../../lib/scoring/engine.mjs'

const feat = (name, group, norm, computeFn, hist) => ({ name, defaultGroup: group, normalizer: norm, compute: computeFn, history: hist })
const reg = [
  feat('a', 'early', 'percentileVsUniverse', (ctx) => ctx.v),
  feat('b', 'confirm', 'fixedCurve', () => 50),
]
const config = { weights: { a: 1, b: 1 }, groups: { a: 'early', b: 'confirm' } }
// b는 fixedCurve params가 feature.params에 있어야 함 → 테스트용 params 주입
reg[1].params = [[0, 0], [100, 100]]

describe('weightedAverage', () => {
  it('null feature 제외 후 가중평균', () => {
    expect(weightedAverage([{ normalized: 80, weight: 1 }, { normalized: null, weight: 3 }, { normalized: 40, weight: 1 }])).toBe(60)
  })
  it('전부 null → null', () => {
    expect(weightedAverage([{ normalized: null, weight: 1 }])).toBe(null)
  })
})

describe('two-pass scoring', () => {
  it('유니버스 백분위 + 그룹별 가중평균', () => {
    const coins = [{ market: 'X', v: 10 }, { market: 'Y', v: 20 }, { market: 'Z', v: 30 }]
    const ctxs = coins.map((c) => ({ coin: { market: c.market }, v: c.v }))
    const raws = computeRaws(ctxs, reg)
    const dist = buildUniverseDist(raws, reg, config)
    const zResult = scoreCoin(ctxs[2], raws[2], dist, reg, config) // v=30 → a 백분위 100
    expect(zResult.features.a.normalized).toBe(100)
    expect(zResult.features.a.group).toBe('early')
    expect(zResult.earlyScoreRaw).toBe(100)     // early엔 a만
    expect(zResult.confirmScore).toBe(50)        // confirm엔 b(fixedCurve→50)
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement**

```js
// lib/scoring/engine.mjs
import { normalize } from './normalizers.mjs'
import { resolveGroup } from './config.mjs'

export function weightedAverage(items) {
  const valid = items.filter((i) => i.normalized != null && !Number.isNaN(i.normalized) && i.weight > 0)
  if (!valid.length) return null
  const wsum = valid.reduce((s, i) => s + i.weight, 0)
  return +(valid.reduce((s, i) => s + i.normalized * i.weight, 0) / wsum).toFixed(2)
}

// Pass 1: 코인×피처 raw. 예외/부족은 null.
export function computeRaws(ctxs, registry) {
  return ctxs.map((ctx) => {
    const row = {}
    for (const f of registry) { try { row[f.name] = f.compute(ctx) } catch { row[f.name] = null } }
    return row
  })
}

// percentile 피처의 유니버스 분포.
export function buildUniverseDist(raws, registry, config) {
  const dist = {}
  for (const f of registry) {
    if (f.normalizer !== 'percentileVsUniverse') continue
    dist[f.name] = raws.map((r) => r[f.name]).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b)
  }
  return dist
}

// Pass 2: 한 코인 정규화 + 그룹별 가중평균.
export function scoreCoin(ctx, raw, dist, registry, config) {
  const features = {}
  const early = [], confirm = []
  for (const f of registry) {
    const weight = (config.weights || {})[f.name] ?? 0
    const group = resolveGroup(f.name, config.groups, registry)
    const opts = { dist: dist[f.name], params: f.params }
    if (f.normalizer === 'vsOwnHistory') { try { opts.hist = f.history ? f.history(ctx) : null } catch { opts.hist = null }; opts.params = f.params }
    const normalized = normalize(f.normalizer, raw[f.name], opts)
    features[f.name] = { raw: raw[f.name], normalized, group, weight, normalizer: f.normalizer }
    if (weight > 0) (group === 'confirm' ? confirm : early).push({ normalized, weight })
  }
  const earlyScoreRaw = weightedAverage(early)
  const confirmScore = weightedAverage(confirm)
  return { market: ctx.coin?.market, features, earlyScoreRaw, confirmScore }
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/engine.mjs __tests__/scoring/engine.core.test.mjs
git commit -m "feat(scoring): two-pass engine core (raws, universe dist, dual weighted score)"
```

---

## Task 6: Extension penalty (engine-level)

**Files:**
- Modify: `lib/scoring/engine.mjs` (add `computeExtensionPenalty`, apply in a new `finalizeScore`)
- Test: `__tests__/scoring/engine.penalty.test.mjs`

Penalty = min(1, max(0, stretch)) where stretch = (close/EMA20 − 1) / cap, cap from config `thresholds.extensionCap` (default 0.30). Already-extended price → higher penalty.

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { computeExtensionPenalty, applyExtension } from '../../lib/scoring/engine.mjs'

const ctx = (closes) => ({ coin: { ohlcvDaily: closes.map((c) => ({ close: c })) } })

describe('extension penalty', () => {
  it('EMA20 근처 → 낮은 penalty', () => {
    const closes = Array.from({ length: 30 }, () => 100)
    expect(computeExtensionPenalty(ctx(closes), { thresholds: { extensionCap: 0.3 } })).toBeCloseTo(0, 2)
  })
  it('EMA20 대비 크게 상승 → 높은 penalty(캡 1)', () => {
    const closes = Array.from({ length: 29 }, () => 100).concat([200])
    expect(computeExtensionPenalty(ctx(closes), { thresholds: { extensionCap: 0.3 } })).toBe(1)
  })
  it('applyExtension: earlyScore = raw × (1 − penalty)', () => {
    expect(applyExtension(80, 0.25)).toBe(60)
  })
  it('raw null → null 유지', () => {
    expect(applyExtension(null, 0.2)).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** (append to `engine.mjs`)

```js
import { calcEMA } from '../indicators.mjs'

export function computeExtensionPenalty(ctx, config) {
  const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
  if (closes.length < 20) return 0
  const e20 = calcEMA(closes, 20).at(-1)
  if (!(e20 > 0)) return 0
  const cap = config?.thresholds?.extensionCap ?? 0.30
  const stretch = (closes.at(-1) / e20 - 1) / cap
  return +Math.min(1, Math.max(0, stretch)).toFixed(3)
}

export function applyExtension(earlyScoreRaw, penalty) {
  if (earlyScoreRaw == null) return null
  return +(earlyScoreRaw * (1 - penalty)).toFixed(2)
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/engine.mjs __tests__/scoring/engine.penalty.test.mjs
git commit -m "feat(scoring): engine-level extension penalty (stored separately)"
```

---

## Task 7: Confidence, contextLabel, tier

**Files:**
- Modify: `lib/scoring/engine.mjs` (add `tierFor`, `contextLabelFor`, `assessConfidence`)
- Test: `__tests__/scoring/engine.confidence.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import { describe, it, expect } from 'vitest'
import { tierFor, contextLabelFor, assessConfidence } from '../../lib/scoring/engine.mjs'

const cuts = { S: 85, A: 70, B: 55, C: 40 }
describe('tierFor', () => {
  it('earlyScore 기준 티어', () => {
    expect(tierFor(90, cuts)).toBe('S')
    expect(tierFor(72, cuts)).toBe('A')
    expect(tierFor(41, cuts)).toBe('C')
    expect(tierFor(30, cuts)).toBe(null)
    expect(tierFor(null, cuts)).toBe(null)
  })
})
describe('contextLabelFor', () => {
  const th = { earlyHigh: 70, confirmHigh: 60 }
  it('4상태 매트릭스', () => {
    expect(contextLabelFor(80, 40, th)).toBe('early_inflow_unconfirmed')
    expect(contextLabelFor(80, 70, th)).toBe('early_inflow_with_confirmation')
    expect(contextLabelFor(50, 70, th)).toBe('breakout_already_confirmed')
    expect(contextLabelFor(50, 40, th)).toBe('weak_signal')
  })
})
describe('assessConfidence', () => {
  const th = { thresholds: { extensionLow: 0.15 } }
  const early = { a: 80, b: 75, c: 90, d: 72, e: 80 }
  it('early 다수 강함 + 낮은 penalty + quality 충분 + coverage 충분 → high, quality reason 구분', () => {
    const r = assessConfidence({ earlyNormalized: early, extensionPenalty: 0.05, coverage: 1, qualityGuards: { liquidity: 60, abs_trading_value: 55 }, config: th })
    expect(r.type).toBe('heuristic')
    expect(r.label).toBe('high')
    expect(r.reasons).toContain('liquidity sufficient')
    expect(r.reasons).toContain('absolute trading value sufficient')
  })
  it('quality 둘 다 낮으면 하향 + 별도 reason', () => {
    const r = assessConfidence({ earlyNormalized: early, extensionPenalty: 0.05, coverage: 1, qualityGuards: { liquidity: 20, abs_trading_value: 10 }, config: th })
    expect(r.label).not.toBe('high')
    expect(r.reasons.some((x) => x.includes('both quality guards low'))).toBe(true)
  })
  it('coverage 낮으면 label 하향', () => {
    const r = assessConfidence({ earlyNormalized: early, extensionPenalty: 0.05, coverage: 0.4, qualityGuards: { liquidity: 60, abs_trading_value: 55 }, config: th })
    expect(r.label).not.toBe('high')
    expect(r.reasons.some((x) => x.toLowerCase().includes('coverage'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** (append to `engine.mjs`)

```js
export function tierFor(earlyScore, cuts) {
  if (earlyScore == null) return null
  if (earlyScore >= cuts.S) return 'S'
  if (earlyScore >= cuts.A) return 'A'
  if (earlyScore >= cuts.B) return 'B'
  if (earlyScore >= cuts.C) return 'C'
  return null
}

export function contextLabelFor(earlyScore, confirmScore, th) {
  const e = (earlyScore ?? 0) >= th.earlyHigh, c = (confirmScore ?? 0) >= th.confirmHigh
  if (e && c) return 'early_inflow_with_confirmation'
  if (e && !c) return 'early_inflow_unconfirmed'
  if (!e && c) return 'breakout_already_confirmed'
  return 'weak_signal'
}

// heuristic confidence object. quality guard는 개별 판정(수정 5), coverage 낮으면 하향(수정 8).
export function assessConfidence({ earlyNormalized, extensionPenalty, coverage, qualityGuards, config }) {
  const reasons = []
  const strong = Object.values(earlyNormalized).filter((v) => v != null && v > 70).length
  if (strong) reasons.push(`${strong} early features above 70`)
  const extLow = extensionPenalty <= (config?.thresholds?.extensionLow ?? 0.15)
  if (extLow) reasons.push('extension penalty low')
  const liqOk = (qualityGuards?.liquidity ?? 0) >= 40
  const absOk = (qualityGuards?.abs_trading_value ?? 0) >= 40
  if (liqOk) reasons.push('liquidity sufficient')
  if (absOk) reasons.push('absolute trading value sufficient')
  let label = 'low'
  if (strong >= 4 && extLow) label = 'high'
  else if (strong >= 2) label = 'medium'
  if (!liqOk && !absOk) { label = label === 'high' ? 'medium' : 'low'; reasons.push('both quality guards low') }
  if (coverage < 0.6) { label = label === 'high' ? 'medium' : 'low'; reasons.push(`low coverage (${(coverage * 100).toFixed(0)}%)`) }
  return { type: 'heuristic', label, reasons }
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/engine.mjs __tests__/scoring/engine.confidence.test.mjs
git commit -m "feat(scoring): tier, contextLabel, heuristic confidence (coverage-aware)"
```

---

## Task 8: Full scoring assembler (`scoreUniverse`) + archive entry builder

Ties Tasks 5–7 into one call and produces the exact archive `scoring` object from the spec.

**Files:**
- Modify: `lib/scoring/engine.mjs` (add `scoreUniverse`, `buildScoringEntry`)
- Test: `__tests__/scoring/engine.assemble.test.mjs`

- [ ] **Step 1: Write failing test**

```js
import { describe, it, expect } from 'vitest'
import { scoreUniverse } from '../../lib/scoring/engine.mjs'

const feat = (name, group, norm, fn, params) => ({ name, defaultGroup: group, normalizer: norm, compute: fn, params })
const reg = [
  feat('rv', 'early', 'percentileVsUniverse', (c) => c.v),
  feat('bs', 'confirm', 'fixedCurve', () => 3, [[0, 0], [3, 100]]),
]
const config = {
  version: 'scoring-v1', weights: { rv: 1, bs: 1 }, groups: { rv: 'early', bs: 'confirm' },
  tierCutoffs: { S: 85, A: 70, B: 55, C: 40 }, thresholds: { earlyHigh: 70, confirmHigh: 60, extensionLow: 0.15, extensionCap: 0.3 },
  regimeMultiplier: { bull: 1.1, neutral: 1.0, bear: 0.9 }, qualityGuard: {},
}

describe('scoreUniverse', () => {
  const ctxs = () => [10, 20, 30].map((v) => ({ coin: { market: 'C' + v, ohlcvDaily: Array.from({ length: 30 }, () => ({ close: 100 })) }, v }))
  it('코인별 완전한 scoring 객체 생성 (neutral: multiplier 1.0)', () => {
    const top = scoreUniverse(ctxs(), reg, config, { btcTrend: 'neutral' }).find((o) => o.market === 'C30')
    expect(top.version).toBe('scoring-v1')
    for (const k of ['earlyScoreRaw', 'extensionPenalty', 'earlyScoreAfterExtension', 'regimeMultiplier', 'timeMultiplier', 'earlyScore', 'confirmScore', 'tier', 'contextLabel']) expect(top).toHaveProperty(k)
    expect(top.confidence.type).toBe('heuristic')
    expect(top.features.rv.normalized).toBe(100)
    expect(top.earlyScoreRaw).toBe(100)
    expect(top.extensionPenalty).toBeCloseTo(0, 2)      // 가격 flat → EMA20 근처
    expect(top.earlyScoreAfterExtension).toBe(100)
    expect(top.earlyScore).toBe(100)                     // × 1.0
  })
  it('bear regimeMultiplier(0.9)가 earlyScore에 실제 곱해진다', () => {
    const top = scoreUniverse(ctxs(), reg, config, { btcTrend: 'bear' }).find((o) => o.market === 'C30')
    expect(top.regimeMultiplier).toBe(0.9)
    expect(top.earlyScoreAfterExtension).toBe(100)
    expect(top.earlyScore).toBe(90)                      // 100 × 0.9
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement** (append to `engine.mjs`)

```js
// lib/scoring/engine.mjs (append). resolveGroup는 이미 Task 5에서 import됨.
export function scoreUniverse(ctxs, registry, config, market = {}) {
  const raws = computeRaws(ctxs, registry)
  const dist = buildUniverseDist(raws, registry, config)
  const regimeMultiplier = (config.regimeMultiplier || {})[market.btcTrend] ?? 1.0
  const timeMultiplier = 1.0 // v1: time-of-day 미적용(seam), config.timeMultiplier 확장 지점
  return ctxs.map((ctx, i) => {
    const base = scoreCoin(ctx, raws[i], dist, registry, config)
    const extensionPenalty = computeExtensionPenalty(ctx, config)
    const earlyScoreAfterExtension = applyExtension(base.earlyScoreRaw, extensionPenalty)
    // 최종 earlyScore = afterExtension × regimeMult × timeMult, [0,100] 클램프. (수정 3)
    const earlyScore = earlyScoreAfterExtension == null ? null
      : +Math.min(100, Math.max(0, earlyScoreAfterExtension * regimeMultiplier * timeMultiplier)).toFixed(2)
    const earlyGroup = Object.fromEntries(Object.entries(base.features).filter(([, f]) => f.group === 'early').map(([k, f]) => [k, f.normalized]))
    const coverageAll = Object.values(base.features)
    const coverage = coverageAll.filter((f) => f.normalized != null).length / (coverageAll.length || 1)
    const qualityGuards = { liquidity: base.features.liquidity?.normalized ?? null, abs_trading_value: base.features.abs_trading_value?.normalized ?? null }
    const confidence = assessConfidence({ earlyNormalized: earlyGroup, extensionPenalty, coverage, qualityGuards, config })
    const tier = tierFor(earlyScore, config.tierCutoffs)                 // 최종 earlyScore 기준
    const contextLabel = contextLabelFor(earlyScore, base.confirmScore, config.thresholds)
    return {
      version: config.version, market: base.market,
      earlyScoreRaw: base.earlyScoreRaw, extensionPenalty, earlyScoreAfterExtension,
      regimeMultiplier, timeMultiplier, earlyScore, confirmScore: base.confirmScore,
      tier, contextLabel, confidence, features: base.features,
    }
  })
}
```

- [ ] **Step 4: Run to verify pass** — PASS. Also run whole suite: `npx vitest run` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scoring/engine.mjs __tests__/scoring/engine.assemble.test.mjs
git commit -m "feat(scoring): scoreUniverse assembler produces full archive scoring object"
```

---

## Task 9: FeatureContext builder + shadow-mode integration in monitor.mjs

**Files:**
- Create: `lib/scoring/context.mjs`
- Modify: `scripts/monitor.mjs` (compute scoring in shadow, attach to archive, fallback)
- Test: `__tests__/scoring/shadow.test.mjs`

**context.mjs** builds ctxs from the candle map monitor already has (no new API).

- [ ] **Step 1: Write failing tests** (pure shadow-runner + context, so monitor stays thin)

```js
import { describe, it, expect } from 'vitest'
import { buildContexts } from '../../lib/scoring/context.mjs'
import { runScoringShadow } from '../../lib/scoring/context.mjs'

const reg = [{ name: 'rv', defaultGroup: 'early', normalizer: 'percentileVsUniverse', compute: (c) => c.coin.ticker.acc_trade_price_24h }]
const config = { version: 'scoring-v1', weights: { rv: 1 }, groups: { rv: 'early' }, tierCutoffs: { S: 85, A: 70, B: 55, C: 40 }, thresholds: { earlyHigh: 70, confirmHigh: 60, extensionLow: 0.15, extensionCap: 0.3 }, regimeMultiplier: {}, archiveTopN: 1 }

describe('buildContexts', () => {
  it('candleMap + tickerMap → ctx 배열', () => {
    const ctxs = buildContexts(['KRW-A'], { 'KRW-A': [{ close: 1, high: 1, low: 1, open: 1, volume: 1, tradeValue: 1 }] }, { 'KRW-A': { trade_price: 1, acc_trade_price_24h: 5e8 } }, { btcTrend: 'neutral' })
    expect(ctxs[0].coin.market).toBe('KRW-A')
    expect(ctxs[0].coin.ticker.acc_trade_price_24h).toBe(5e8)
  })
})

describe('runScoringShadow', () => {
  const cmap = { 'KRW-A': [{ close: 1 }], 'KRW-B': [{ close: 1 }] }
  const tmap = { 'KRW-A': { acc_trade_price_24h: 9e8 }, 'KRW-B': { acc_trade_price_24h: 1e8 } }
  it('정상: earlyScore top-N ∪ buy 후보(중복 제거) 저장 (수정 2)', () => {
    // archiveTopN=1 → earlyScore 최상위(A)만, 그러나 buyMarkets=['KRW-B'] 이므로 B도 포함
    const res = runScoringShadow(['KRW-A', 'KRW-B'], cmap, tmap, { btcTrend: 'neutral' }, reg, config, ['KRW-B'])
    expect(res.scoringError).toBeUndefined()
    expect(res.scoring.map((s) => s.market).sort()).toEqual(['KRW-A', 'KRW-B'])
    expect(res.scoringMeta.universeSize).toBe(2)
  })
  it('buy 후보 없으면 top-N만', () => {
    const res = runScoringShadow(['KRW-A', 'KRW-B'], cmap, tmap, { btcTrend: 'neutral' }, reg, config, [])
    expect(res.scoring.map((s) => s.market)).toEqual(['KRW-A']) // top1
  })
  it('config null → scoringError, throw 안 함', () => {
    const res = runScoringShadow(['KRW-A'], cmap, tmap, { btcTrend: 'neutral' }, reg, null, [])
    expect(res.scoringError).toBeDefined()
    expect(res.scoring).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement**

```js
// lib/scoring/context.mjs
import { scoreUniverse } from './engine.mjs'

export function buildContexts(markets, candleMap, tickerMap, market) {
  return markets.map((mk) => ({
    coin: { market: mk, ohlcvDaily: candleMap[mk] || [], ticker: tickerMap[mk] || {} },
  }))
}

// 쉐도우 실행: 절대 throw하지 않고 {scoring, scoringMeta} 또는 {scoringError} 반환.
// 저장 대상 = earlyScore top-N ∪ buyMarkets(기존 buy 후보), 중복 제거. (수정 2)
export function runScoringShadow(markets, candleMap, tickerMap, market, registry, config, buyMarkets = []) {
  try {
    if (!config) throw new Error('scoring config missing')
    const ctxs = buildContexts(markets, candleMap, tickerMap, market)
    const scored = scoreUniverse(ctxs, registry, config, market)
    const topN = config.archiveTopN ?? 20
    const byEarly = scored.filter((s) => s.earlyScore != null).sort((a, b) => (b.earlyScore ?? 0) - (a.earlyScore ?? 0))
    const keep = new Set(byEarly.slice(0, topN).map((s) => s.market))
    for (const m of buyMarkets) keep.add(m) // 기존 buy 후보는 earlyScore 낮아도 비교용으로 포함
    const scoring = scored.filter((s) => keep.has(s.market))
    const covs = scored.map((s) => Object.values(s.features).filter((f) => f.normalized != null).length / (Object.keys(s.features).length || 1))
    const coverageAvg = +(covs.reduce((a, b) => a + b, 0) / (covs.length || 1)).toFixed(2)
    return { scoring, scoringMeta: { version: config.version, universeSize: markets.length, coverageAvg } }
  } catch (e) {
    return { scoringError: { message: String(e && e.message || e) } }
  }
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 4b: Mock 기반 fallback 테스트 (수정 6) — 엔진 자체가 throw해도 안전한지**

`computeRaws`가 compute의 throw를 흡수하므로, `scoreUniverse` 자체가 던지는 상황을 mock으로 만들어 검증한다.

`__tests__/scoring/shadow.fallback.test.mjs`:
```js
import { describe, it, expect, vi } from 'vitest'
vi.mock('../../lib/scoring/engine.mjs', () => ({ scoreUniverse: () => { throw new Error('engine boom') } }))
import { runScoringShadow } from '../../lib/scoring/context.mjs'

describe('runScoringShadow fallback (engine throws)', () => {
  const cfg = { version: 'scoring-v1', archiveTopN: 5 }
  it('scoreUniverse가 throw해도 runScoringShadow는 throw하지 않고 scoringError만 남긴다', () => {
    const res = runScoringShadow(['KRW-A'], { 'KRW-A': [{ close: 1 }] }, { 'KRW-A': { acc_trade_price_24h: 1 } }, { btcTrend: 'neutral' }, [], cfg, [])
    expect(res.scoringError).toBeDefined()
    expect(res.scoringError.message).toContain('engine boom')
    expect(res.scoring).toBeUndefined()
  })
})
```
Run: `npx vitest run __tests__/scoring/shadow.fallback.test.mjs` → PASS.

- [ ] **Step 5: Wire into monitor.mjs (shadow only; 구체적 데이터 소스, 신규 API 0) — 수정 7**

정확한 소스 (현재 `scripts/monitor.mjs` 기준):
- **candleMap**: 스캔 루프가 이미 `const ohlcv = candlesToOhlcv(candles)`(약 line 46)를 만든다. 루프 위(약 line 40)에 `const candleMap = {}`를 선언하고, 그 콜백 안 `if (!candles || candles.length < 60) return` **다음**에 `candleMap[market] = ohlcv` 한 줄만 추가한다. (신규 fetch 없음 — 이미 받은 ohlcv 재사용. ohlcv에는 `tradeValue`(candle_acc_trade_price) 포함.)
- **tickerMap**: `getScanUniverse()`가 반환하는 `tradePrice`가 곧 `acc_trade_price_24h`이다(`lib/scan-universe.mjs`: `tradePrice = Object.fromEntries(tickers.map(t => [t.market, t.acc_trade_price_24h]))`). 따라서:
  ```js
  const tickerMap = Object.fromEntries(Object.keys(candleMap).map((m) => [m, { acc_trade_price_24h: tradePrice[m] }]))
  ```
- **buyMarkets**: `const buyMarkets = buy.map((b) => b.market)` (기존 buy 후보).
- **fallback 정책**: `tradePrice[m]`가 없으면(유니버스 ticker 조회 누락) `acc_trade_price_24h`가 undefined → `relativeTradingValue`/`absTradingValue`/`liquidity`의 compute가 `null` 반환 → 해당 feature는 가중평균에서 자동 제외(엔진 §null 처리). 즉 데이터 없으면 조용히 coverage만 낮아지고 confidence가 하향된다. 별도 예외 없음.

`entry`를 만든 **직후, `withLock` 저장 전**에:
```js
// 상단 import 추가
import registry from '../lib/scoring/features/index.mjs'
import { loadScoringConfig } from '../lib/scoring/config.mjs'
import { runScoringShadow } from '../lib/scoring/context.mjs'
// ... main() 안, entry 생성 직후:
const tickerMap = Object.fromEntries(Object.keys(candleMap).map((m) => [m, { acc_trade_price_24h: tradePrice[m] }]))
const buyMarkets = buy.map((b) => b.market)
let scoringConfig = null
try { scoringConfig = await loadScoringConfig(readJson, registry) } catch (e) { console.warn('[scoring] config load failed:', e.message) }
const shadow = runScoringShadow(Object.keys(candleMap), candleMap, tickerMap, { btcTrend: regime.trend }, registry, scoringConfig, buyMarkets)
if (shadow.scoringError) entry.scoringError = shadow.scoringError
else { entry.scoring = shadow.scoring; entry.scoringMeta = shadow.scoringMeta }
```

`entry`는 monitor-log·archive에 저장되는 **동일 객체**라 scoring이 함께 실린다. **기존 `buy`/`sell`/`regime`는 불변.** `runScoringShadow`는 절대 throw하지 않고, config 로드도 별도 try/catch라 어떤 경우에도 `entry`는 유효하게 유지된다.

- [ ] **Step 6: Run the real monitor once to verify it still works and writes scoring**

Run: `node scripts/monitor.mjs` → expect normal completion, then check the last archive line has `scoring` (array) + `scoringMeta`, and existing `buy`/`sell` unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/scoring/context.mjs scripts/monitor.mjs __tests__/scoring/shadow.test.mjs __tests__/scoring/shadow.fallback.test.mjs
git commit -m "feat(scoring): shadow-mode integration in monitor (no new API, fallback-safe)"
```

---

## Task 10: Robustness + integration test pass

**Files:**
- Create: `__tests__/scoring/robustness.test.mjs`

Covers the spec's robustness matrix end-to-end through `scoreUniverse`/`runScoringShadow`.

- [ ] **Step 1: Write tests**

```js
import { describe, it, expect } from 'vitest'
import { scoreUniverse } from '../../lib/scoring/engine.mjs'
import { runScoringShadow } from '../../lib/scoring/context.mjs'

const config = { version: 'scoring-v1', weights: { rv: 1, tr: 1 }, groups: { rv: 'early', tr: 'confirm' }, tierCutoffs: { S: 85, A: 70, B: 55, C: 40 }, thresholds: { earlyHigh: 70, confirmHigh: 60, extensionLow: 0.15, extensionCap: 0.3 }, regimeMultiplier: {}, archiveTopN: 20 }
const reg = [
  { name: 'rv', defaultGroup: 'early', normalizer: 'percentileVsUniverse', compute: (c) => c.coin.ohlcvDaily.length >= 21 ? c.coin.ohlcvDaily.length : null },
  { name: 'tr', defaultGroup: 'confirm', normalizer: 'fixedCurve', params: [[0, 0], [100, 100]], compute: () => NaN },
]

describe('robustness', () => {
  it('NaN/부족 캔들 feature는 제외되고 엔진은 죽지 않는다', () => {
    const ctxs = [{ coin: { market: 'A', ohlcvDaily: [] } }, { coin: { market: 'B', ohlcvDaily: Array.from({ length: 25 }, () => ({ close: 1 })) } }]
    const out = scoreUniverse(ctxs, reg, config, {})
    const a = out.find((o) => o.market === 'A')
    expect(a.features.rv.normalized).toBe(null)   // 캔들 부족 → 제외
    expect(a.features.tr.normalized).toBe(null)   // NaN → 제외
    expect(a.earlyScoreRaw).toBe(null)            // early 전부 null → null
    expect(a.tier).toBe(null)
  })
  it('shadow는 어떤 입력에도 throw하지 않는다', () => {
    const res = runScoringShadow(['A'], { A: null }, { A: null }, {}, reg, config)
    expect(res.scoringError || res.scoring).toBeDefined()
  })
})
```

- [ ] **Step 2: Run** — `npx vitest run __tests__/scoring/robustness.test.mjs` → PASS. Then full suite `npx vitest run` → all PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/scoring/robustness.test.mjs
git commit -m "test(scoring): robustness matrix (null/NaN/short candles/shadow no-throw)"
```

---

## Task 11: Rollout checklist (no code)

- [ ] Confirm `scoring-config.json` weights/groups match the 10 registered features (run `validateConfig` — zero errors).
- [ ] Run `node scripts/monitor.mjs` once; verify last archive line: `scoring` present, `buy`/`sell`/`regime` byte-identical to prior format, and (on a forced failure) `scoringError` appears instead.
- [ ] Verify no new Upbit API calls added (scoring reuses fetched candles + ticker).
- [ ] Full suite green: `npx vitest run`.
- [ ] Let scheduled scans accrue `scoring` for a few days (shadow — no user-facing change).
- [ ] Do NOT flip monitor's displayed output to the new engine yet — that decision comes after Subsystem B (outcome tracking) validates new-vs-old.
- [ ] Commit the plan's completion note; open follow-up specs for B (outcome tracking) and C (5-state regime).

---

## 실행 체크포인트 (사용자 요청)
서브에이전트 실행 시, **각 태스크의 commit(마지막 스텝) 직전에 반드시 (a) 테스트 결과와 (b) 변경 diff 요약을 먼저 보고하고 승인받은 뒤 커밋**한다. 무단 커밋 금지.

## Self-Review notes (수정 8건 반영)
- **Spec coverage:** normalizers(T1) · plugin contract+registry(T2) · **10 features**(T3) · config+validation(T4) · two-pass engine(T5) · extension penalty stored separately(T6) · confidence object+contextLabel+tier-from-earlyScore(T7) · full archive object(T8) · shadow+fallback+context(T9) · robustness matrix(T10) · rollout(T11).
- **수정 1** tier=earlyScore only, contextLabel 4상태 (T7). **수정 2** runScoringShadow가 buyMarkets ∪ top-N 저장 (T9). **수정 3** regime/time multiplier 실제 적용 + `earlyScoreAfterExtension`/`earlyScore` 분리 + 클램프 (T8, spec §데이터흐름/archive). **수정 4** trendAlignment EMA200 제거·60봉 정의 (T3.8). **수정 5** quality guard 개별 판정(liquidity/absTradingValue reason 분리) (T7/T8). **수정 6** mock 기반 shadow fallback 테스트 (T9 Step 4b). **수정 7** monitor 데이터 소스 구체화(candleMap 캡처·tradePrice=acc_trade_price_24h·fallback 정책) (T9 Step 5). **수정 8** percentile inclusive 명시(spec) + null/NaN/coverage/config validation 테스트 (T1/T4/T7/T10).
- **Quality-guard**: config weights 0.3 + `qualityGuard.mode:'weight'` (T4), 미래 cap/filter seam.
- **No placeholders:** 모든 스텝에 실제 코드/명령.
- **Type consistency:** feature 객체 형태, `scoreCoin`/`scoreUniverse`/`runScoringShadow`(+buyMarkets) 시그니처, archive 필드명(`earlyScoreRaw`/`extensionPenalty`/`earlyScoreAfterExtension`/`regimeMultiplier`/`timeMultiplier`/`earlyScore`/`confirmScore`/`tier`/`contextLabel`/`confidence`/`features`)이 태스크 전반과 spec §archive에 일치.
