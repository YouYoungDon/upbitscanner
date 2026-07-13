# 신호 신뢰도 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일봉 신호를 확정(닫힌) 캔들 기준으로 판정하고, 가중치 학습에 수익 크기를 반영하며, 코드리뷰 버그 4건과 가중치 파일 git 위생을 함께 고친다.

**Architecture:** 신규 유틸 `lib/ohlcv.mjs`(confirmedOhlcv/ensureMinConfirmed)를 만들어 일봉 신호 판정 경로(monitor·momentum·backtest·server)에서 형성 중 봉을 제외한다(각 fetch는 N+1). 학습 순수 함수(hitComponent/returnComponent/qualityTarget)를 `lib/store.mjs`에 추가하고 `updateWeights`가 avgReturn을 반영한다. 가중치 파일은 backup/default(완화 baseline)/live(gitignore)/meta로 분리한다.

**Tech Stack:** Node.js ESM(.mjs), vitest, 내장 http 서버, 바닐라 JS SPA.

## Global Constraints

- `confirmedOhlcv` 계약: 입력은 `candlesToOhlcv()` 이후 chronological(오래된→최신) 배열, 마지막 요소는 형성 중 봉일 수 있어 신호 판정에서 제외. 빈/1개/비배열 → `[]`.
- 최소 캔들 원칙: 지표가 N개 확정봉을 요구하면 fetch는 최소 **N+1**. EMA200·200봉 신고가 사용부는 fetch 201.
- `returnComponent`(B안 확정): `clamp(1 + avgReturn/100, 0.85, 1.25)` (avgReturn은 퍼센트값, +25%에서 상한).
- `hitComponent`: 적중률 [0.4,0.7]을 [0.7,1.5]로 선형 매핑, 밖은 클램프.
- `newWeight = clampWeight(old*0.7 + qualityTarget*0.3)`, `clampWeight`=[0.5,2.0], `MIN_SAMPLES=8`.
- #0(네트워크 하드닝)은 코드·테스트 이미 존재 — 신규 구현 금지, AbortError→retry 테스트 1건만 추가.
- 파일 UTF-8(BOM 없음), 한글 문자열 포함. PowerShell로 .mjs 쓰지 말 것(테스트는 `npx vitest run <path>`).
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 서버/모니터는 script 변경 반영 위해 재시작 필요(구현 중 사용자의 8787 서버를 임의 재시작·종료 금지).

---

### Task 0: #0 네트워크 하드닝 — AbortError→retry 테스트 1건

**Files:**
- Test: `__tests__/upbit.retry.test.mjs` (기존 파일에 it 1개 추가)

**Interfaces:**
- Consumes: `getMarkets` from `lib/upbit.mjs` (기존)
- Produces: 없음 (테스트만)

- [ ] **Step 1: Add the failing test**

`__tests__/upbit.retry.test.mjs`의 `describe('get 재시도/백오프', ...)` 블록 안(마지막 it 뒤)에 추가:

```javascript
  it('fetch가 AbortError를 throw하면(타임아웃 발화) 재시도한다', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++
      if (n === 1) { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e }
      return { ok: true, json: async () => [{ market: 'KRW-BTC' }] }
    }))
    const r = await getMarkets()
    expect(n).toBe(2)
    expect(r).toEqual([{ market: 'KRW-BTC', warning: false, caution: false }])
  })
```

- [ ] **Step 2: Run test to verify it passes (code already handles it)**

Run: `npx vitest run __tests__/upbit.retry.test.mjs`
Expected: PASS — 기존 `get()`의 `catch { if (attempt >= retries) return null }`가 AbortError를 잡아 재시도하므로 통과. (이 테스트는 회귀 방지용 — 이미 통과해야 정상. FAIL이면 `lib/upbit.mjs get()`의 catch가 사라진 것.)

- [ ] **Step 3: Commit**

```bash
git add __tests__/upbit.retry.test.mjs
git commit -m "$(cat <<'EOF'
test(upbit): lock AbortError-triggers-retry behavior

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1: lib/ohlcv.mjs — confirmedOhlcv / ensureMinConfirmed

**Files:**
- Create: `lib/ohlcv.mjs`
- Test: `__tests__/ohlcv.test.mjs`

**Interfaces:**
- Produces:
  - `confirmedOhlcv(ohlcv)` → 마지막(형성 중) 봉 제외 배열. 빈/1개/비배열 → `[]`.
  - `ensureMinConfirmed(confirmed, min)` → `confirmed`가 배열이고 `length >= min`이면 그대로, 아니면 `null`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/ohlcv.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest'
import { confirmedOhlcv, ensureMinConfirmed } from '../lib/ohlcv.mjs'

describe('confirmedOhlcv', () => {
  it('마지막(형성 중) 봉 제외', () => {
    expect(confirmedOhlcv([1, 2, 3])).toEqual([1, 2])
  })
  it('1개 배열 → []', () => { expect(confirmedOhlcv([1])).toEqual([]) })
  it('빈 배열 → []', () => { expect(confirmedOhlcv([])).toEqual([]) })
  it('비배열 → []', () => { expect(confirmedOhlcv(null)).toEqual([]); expect(confirmedOhlcv(undefined)).toEqual([]) })
  it('원본 불변', () => { const a = [1, 2, 3]; confirmedOhlcv(a); expect(a).toEqual([1, 2, 3]) })
})

describe('ensureMinConfirmed', () => {
  it('길이 >= min이면 그대로', () => { expect(ensureMinConfirmed([1, 2, 3], 3)).toEqual([1, 2, 3]) })
  it('길이 < min이면 null', () => { expect(ensureMinConfirmed([1, 2], 3)).toBe(null) })
  it('비배열이면 null', () => { expect(ensureMinConfirmed(null, 1)).toBe(null) })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ohlcv.test.mjs`
Expected: FAIL — `Cannot find module '../lib/ohlcv.mjs'`

- [ ] **Step 3: Create lib/ohlcv.mjs**

```javascript
// OHLCV 시계열 계약 유틸 (API 클라이언트 upbit.mjs와 분리).
//
// confirmedOhlcv 계약:
//   입력: candlesToOhlcv() 이후의 chronological(오래된 봉 → 최신 봉) 배열.
//   마지막 요소는 current forming candle(오늘/이번 봉)일 수 있으므로 신호 판정에서 제외.
//   반환: 마지막(형성 중) 봉을 뺀 확정 캔들 배열. 빈/1개/비배열 → [].
export function confirmedOhlcv(ohlcv) {
  return Array.isArray(ohlcv) && ohlcv.length > 1 ? ohlcv.slice(0, -1) : []
}

// 확정봉이 최소 min개 있는지 보장. 부족하면 null(호출부가 스킵).
export function ensureMinConfirmed(confirmed, min) {
  return Array.isArray(confirmed) && confirmed.length >= min ? confirmed : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/ohlcv.test.mjs`
Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add lib/ohlcv.mjs __tests__/ohlcv.test.mjs
git commit -m "$(cat <<'EOF'
feat(ohlcv): confirmedOhlcv/ensureMinConfirmed candle-contract utils

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 확정봉 적용 (monitor / momentum / backtest / server)

**Files:**
- Modify: `scripts/monitor.mjs` (import + 메인 스캔 + `check4hStochGC` + `btcRegime`)
- Modify: `scripts/momentum-scan.mjs`
- Modify: `scripts/backtest.mjs`, `scripts/backtest-momentum.mjs`
- Modify: `server/server.mjs` (`/api/analyze`)

**Interfaces:**
- Consumes: `confirmedOhlcv`, `ensureMinConfirmed` from `lib/ohlcv.mjs` (Task 1)
- Produces: 없음 (동작 변경). 이 Task는 스크립트 엔트리 통합이라 단위 TDD 대신 `node --check` + 회귀 스위트 + 스모크로 검증한다(정직).

- [ ] **Step 1: monitor.mjs — import + 메인 스캔**

`scripts/monitor.mjs` 상단 import에 추가:
```javascript
import { confirmedOhlcv, ensureMinConfirmed } from '../lib/ohlcv.mjs'
```

메인 스캔 블록(현재):
```javascript
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      candleMap[market] = ohlcv
      const sig = detectSignals(ohlcv, weights)
      const pat = detectPatterns(ohlcv)
```
로 교체:
```javascript
      const candles = await getDayCandles(market, 201)
      if (!candles || candles.length < 61) return
      const ohlcv = candlesToOhlcv(candles)
      candleMap[market] = ohlcv // 표시/차트용 전체(형성봉 포함) 유지
      const confirmed = confirmedOhlcv(ohlcv) // 신호 판정은 확정봉만
      const sig = detectSignals(confirmed, weights)
      const pat = detectPatterns(confirmed)
```

같은 블록 뒤쪽 SMC detector 3곳의 인자 `ohlcv` → `confirmed`:
```javascript
      const sweep = detectLiquiditySweep(confirmed)
      const vbottom = detectVBottom(confirmed)
      const pump = detectPumpStart(confirmed)
```
(원래 `detectLiquiditySweep(ohlcv)`/`detectVBottom(ohlcv)`/`detectPumpStart(ohlcv)`였다.)

- [ ] **Step 2: monitor.mjs — check4hStochGC + btcRegime**

`check4hStochGC` 현재:
```javascript
  const candles = await getMinuteCandles(market, 240, 60)
  if (!Array.isArray(candles) || candles.length < 30) return false
  const ohlcv = candlesToOhlcv(candles)
```
교체:
```javascript
  const candles = await getMinuteCandles(market, 240, 61)
  if (!Array.isArray(candles) || candles.length < 31) return false
  const ohlcv = confirmedOhlcv(candlesToOhlcv(candles))
```

`btcRegime` 호출 현재:
```javascript
  const btcCandles = await getDayCandles('KRW-BTC', 200)
  const regime = btcRegime(btcCandles ? candlesToOhlcv(btcCandles) : [])
```
교체:
```javascript
  const btcCandles = await getDayCandles('KRW-BTC', 201)
  const regime = btcRegime(btcCandles ? confirmedOhlcv(candlesToOhlcv(btcCandles)) : [])
```

- [ ] **Step 3: momentum-scan.mjs**

상단 import에 `import { confirmedOhlcv, ensureMinConfirmed } from '../lib/ohlcv.mjs'` 추가. 현재:
```javascript
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      let { score, signals } = scoreMomentum(ohlcv)
```
교체:
```javascript
      const candles = await getDayCandles(market, 201)
      if (!candles || candles.length < 61) return
      const confirmed = ensureMinConfirmed(confirmedOhlcv(candlesToOhlcv(candles)), 60)
      if (!confirmed) return
      let { score, signals } = scoreMomentum(confirmed)
```

- [ ] **Step 4: backtest.mjs + backtest-momentum.mjs**

`scripts/backtest.mjs`: import `confirmedOhlcv`. 현재:
```javascript
  const candles = await getDayCandles(m.market, 200)
  await sleep(200)
  if (!candles || candles.length < 80) continue
  const ohlcv = candlesToOhlcv(candles)
```
교체:
```javascript
  const candles = await getDayCandles(m.market, 201)
  await sleep(200)
  if (!candles || candles.length < 81) continue
  const ohlcv = confirmedOhlcv(candlesToOhlcv(candles)) // 라이브와 동일: 형성봉 제외한 확정 히스토리로 시뮬
```

`scripts/backtest-momentum.mjs`: import `confirmedOhlcv`. 현재:
```javascript
  const c = await getDayCandles(m, 200)
  if (!c || c.length < 80) continue
  all.push(...backtestSamples(candlesToOhlcv(c), { horizons: HORIZONS }))
```
교체:
```javascript
  const c = await getDayCandles(m, 201)
  if (!c || c.length < 81) continue
  all.push(...backtestSamples(confirmedOhlcv(candlesToOhlcv(c)), { horizons: HORIZONS }))
```

- [ ] **Step 5: server.mjs — /api/analyze (지표는 확정봉, 차트는 전체)**

`server/server.mjs` 상단 import에 `import { confirmedOhlcv } from '../lib/ohlcv.mjs'` 추가. `/api/analyze` 현재:
```javascript
      const candles = tf === 'day' ? await getDayCandles(market, 200)
        : await getMinuteCandles(market, tf === '4h' ? 240 : 60, 200)
      if (!candles || candles.length < 30) return sendJson(res, 400, { error: 'no data' })
      const ohlcv = candlesToOhlcv(candles)
      const weights = await readJson('signal-weights.json', {})
      const result = analyzeMarket(ohlcv, { weights })
      return sendJson(res, 200, { market, tf, ohlcv, ...result })
```
교체:
```javascript
      const candles = tf === 'day' ? await getDayCandles(market, 201)
        : await getMinuteCandles(market, tf === '4h' ? 240 : 60, 201)
      if (!candles || candles.length < 31) return sendJson(res, 400, { error: 'no data' })
      const ohlcv = candlesToOhlcv(candles)
      const confirmed = confirmedOhlcv(ohlcv)
      const weights = await readJson('signal-weights.json', {})
      const result = analyzeMarket(confirmed, { weights }) // 지표/신호는 확정봉
      return sendJson(res, 200, { market, tf, ohlcv, ...result }) // 차트용 ohlcv는 전체 유지
```
(주: `readJson('signal-weights.json', {})`는 Task 5에서 `readWeights()`로 교체된다. 이 Task에서는 그대로 둔다.)

- [ ] **Step 6: Syntax check + regression**

Run:
```bash
node --check scripts/monitor.mjs && node --check scripts/momentum-scan.mjs && node --check scripts/backtest.mjs && node --check scripts/backtest-momentum.mjs && node --check server/server.mjs
npx vitest run __tests__/analyze.test.mjs __tests__/signals.test.mjs __tests__/momentum.test.mjs __tests__/smc-signals.test.mjs __tests__/regime.test.mjs
```
Expected: `node --check` 전부 종료코드 0(무출력), vitest 전부 PASS(신호/지표 로직 자체는 불변이므로 회귀 없어야 함).

- [ ] **Step 7: Commit**

```bash
git add scripts/monitor.mjs scripts/momentum-scan.mjs scripts/backtest.mjs scripts/backtest-momentum.mjs server/server.mjs
git commit -m "$(cat <<'EOF'
feat(scanner): judge daily signals on confirmed (closed) candles

Drop the still-forming candle before signal/indicator detection across
monitor, momentum, backtest, and /api/analyze; bump each fetch to N+1 so
EMA200 / 200-day-high inputs keep 200 confirmed bars. Charts keep the
full series.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 가중치 학습 = 적중률 + 수익크기

**Files:**
- Modify: `lib/store.mjs` (hitComponent/returnComponent/qualityTarget 추가, newWeight 교체)
- Modify: `lib/weekly.mjs` (updateWeights: avgReturn 반영, MIN_SAMPLES 8)
- Modify: `scripts/weekly-analysis.mjs` (mixed-horizon 라벨 필드 추가)
- Modify: `server/api.mjs` + `public/app.js` (검증 화면 horizonMode 배지)
- Test: `__tests__/store.test.mjs`, `__tests__/weekly.test.mjs` (추가)

**Interfaces:**
- Consumes: `clampWeight` (기존, store.mjs)
- Produces:
  - `hitComponent(hitRate)` → 0.7~1.5
  - `returnComponent(avgReturn)` → 0.85~1.25 (null/NaN → 1)
  - `qualityTarget(hitRate, avgReturn)` → clampWeight된 목표
  - `newWeight(oldWeight, hitRate, avgReturn)` → 0.7/0.3 블렌드 (avgReturn 선택 인자, 하위호환)
  - `updateWeights(weights, stats)` — stats 항목 `{count, hitRate, avgReturn}`, count<8 스킵

- [ ] **Step 1: Write failing tests (store)**

`__tests__/store.test.mjs` 상단 import에 `hitComponent, returnComponent, qualityTarget, newWeight` 추가(기존 import 라인에 병합). 파일 끝에 추가:

```javascript
import { hitComponent, returnComponent, qualityTarget, newWeight } from '../lib/store.mjs'

describe('학습 컴포넌트 (적중률+수익)', () => {
  it('hitComponent 선형 매핑 + 클램프', () => {
    expect(hitComponent(0.4)).toBeCloseTo(0.7, 5)
    expect(hitComponent(0.7)).toBeCloseTo(1.5, 5)
    expect(hitComponent(0.55)).toBeCloseTo(1.1, 5)
    expect(hitComponent(0.2)).toBeCloseTo(0.7, 5) // <0.4 클램프
    expect(hitComponent(0.9)).toBeCloseTo(1.5, 5) // >0.7 클램프
  })
  it('returnComponent B안: +25% 상한, 하한 0.85, null→1', () => {
    expect(returnComponent(0)).toBeCloseTo(1.0, 5)
    expect(returnComponent(25)).toBeCloseTo(1.25, 5)
    expect(returnComponent(40)).toBeCloseTo(1.25, 5) // 상한
    expect(returnComponent(10)).toBeCloseTo(1.10, 5)
    expect(returnComponent(-3)).toBeCloseTo(0.97, 5)
    expect(returnComponent(-30)).toBeCloseTo(0.85, 5) // 하한
    expect(returnComponent(null)).toBe(1)
    expect(returnComponent(NaN)).toBe(1)
  })
  it('qualityTarget = hit×return, 검증값', () => {
    expect(qualityTarget(0.754, 9.79)).toBeCloseTo(1.647, 2)
    expect(qualityTarget(0.318, -1.96)).toBeCloseTo(0.686, 2)
  })
  it('newWeight 0.7/0.3 블렌드, avgReturn 반영', () => {
    // old 1.0, hit 0.7(→1.5), ret +25(→1.25) → target clamp(1.875)=1.875 → 1*0.7+1.875*0.3=1.2625
    expect(newWeight(1.0, 0.7, 25)).toBeCloseTo(1.2625, 3)
    // avgReturn 생략 시 return성분 1.0
    expect(newWeight(1.0, 0.7)).toBeCloseTo(1.0 * 0.7 + 1.5 * 0.3, 3)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run __tests__/store.test.mjs`
Expected: FAIL — `hitComponent is not a function`.

- [ ] **Step 3: Implement store.mjs functions**

`lib/store.mjs`의 `newWeight`를 아래로 교체하고, 그 앞에 3개 함수 추가(기존 `ewmTarget`은 하위호환 위해 남겨둔다):

```javascript
// 적중률을 [0.7, 1.5]로 선형 매핑 (0.4 이하 → 0.7, 0.7 이상 → 1.5)
export function hitComponent(hitRate) {
  const t = Math.max(0, Math.min(1, (hitRate - 0.4) / (0.7 - 0.4)))
  return 0.7 + t * (1.5 - 0.7)
}
// 평균수익(%) 배수 — B안(보수적). avgReturn 퍼센트값. +25%에서 상한 1.25, 하한 0.85, null/NaN→1.
export function returnComponent(avgReturn) {
  if (avgReturn == null || Number.isNaN(avgReturn)) return 1
  return Math.max(0.85, Math.min(1.25, 1 + avgReturn / 100))
}
// 목표 가중치 = 적중률성분 × 수익성분 (클램프)
export function qualityTarget(hitRate, avgReturn) {
  return clampWeight(hitComponent(hitRate) * returnComponent(avgReturn))
}
// 이전 가중치에서 목표로 30% 이동 (하위호환: avgReturn 생략 가능)
export function newWeight(oldWeight, hitRate, avgReturn) {
  return clampWeight(oldWeight * 0.7 + qualityTarget(hitRate, avgReturn) * 0.3)
}
```

- [ ] **Step 4: Run store tests**

Run: `npx vitest run __tests__/store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write failing test (weekly updateWeights)**

`__tests__/weekly.test.mjs`에 추가(기존 import에 `updateWeights` 포함 확인):

```javascript
import { updateWeights } from '../lib/weekly.mjs'

describe('updateWeights (avgReturn 반영 + MIN_SAMPLES 8)', () => {
  it('count<8이면 스킵', () => {
    const out = updateWeights({ A: 1 }, { A: { count: 7, hitRate: 0.9, avgReturn: 20 } })
    expect(out.A).toBe(1)
  })
  it('count>=8이면 avgReturn 반영해 갱신', () => {
    const out = updateWeights({ A: 1 }, { A: { count: 8, hitRate: 0.7, avgReturn: 25 } })
    expect(out.A).toBeCloseTo(1.2625, 3) // newWeight(1,0.7,25)
  })
  it('avgReturn 없어도 동작(성분 1)', () => {
    const out = updateWeights({ A: 1 }, { A: { count: 10, hitRate: 0.7 } })
    expect(out.A).toBeCloseTo(1.2, 3)
  })
})
```

- [ ] **Step 6: Run to verify fail**

Run: `npx vitest run __tests__/weekly.test.mjs`
Expected: FAIL — count 7 케이스가 MIN_SAMPLES 3(기존)에서 갱신되어 `out.A !== 1`, 또는 avgReturn 미반영으로 값 불일치.

- [ ] **Step 7: Update weekly.mjs updateWeights**

`lib/weekly.mjs`의 `const MIN_SAMPLES = 3`을 `const MIN_SAMPLES = 8`로, `updateWeights`를 교체:

```javascript
export function updateWeights(weights, stats) {
  const out = { ...weights }
  for (const [key, { count, hitRate, avgReturn }] of Object.entries(stats)) {
    if (count < MIN_SAMPLES) continue
    out[key] = newWeight(out[key] ?? 1, hitRate, avgReturn)
  }
  return out
}
```
(`import { newWeight } from './store.mjs'`는 이미 존재. `topSignalsBySide`가 MIN_SAMPLES를 공유하는데 8로 올라가면 리포트 표본 하한도 8이 된다 — 의도된 노이즈 감소.)

- [ ] **Step 8: Run weekly tests**

Run: `npx vitest run __tests__/weekly.test.mjs`
Expected: PASS.

- [ ] **Step 9: mixed-horizon 라벨 (weekly-analysis + api + app.js)**

`scripts/weekly-analysis.mjs`에서 주 항목을 쓰는 객체(현재 `signalStats: stats,`가 포함된 리터럴)에 `horizonMode: 'current-price-mixed',` 필드를 추가한다.

`server/api.mjs`의 `buildVerify`가 반환하는 객체에 `horizonMode: weekly?.weeks?.slice(-1)[0]?.horizonMode ?? 'current-price-mixed'`를 추가한다(정확한 위치는 buildVerify의 return 객체).

`public/app.js`의 review 렌더 `showVerify` 안, 신호통계 카드 제목 근처(`신호별 적중률 / 평균수익 / 가중치` 헤더)에 배지 추가:
```javascript
`<span class="badge badge-ghost badge-xs" title="학습이 current-price 기준 aggregate라 보유기간이 혼재됨(후속: +3일 고정 horizon)">⏱ mixed-horizon</span>`
```
(`v.horizonMode`가 있으면 표시; 문자열 그대로 노출하지 말고 위 고정 배지로.)

- [ ] **Step 10: Syntax check + commit**

Run: `node --check scripts/weekly-analysis.mjs && node --check server/api.mjs && node --check public/app.js && npx vitest run __tests__/store.test.mjs __tests__/weekly.test.mjs`
Expected: 종료코드 0, 테스트 PASS.

```bash
git add lib/store.mjs lib/weekly.mjs scripts/weekly-analysis.mjs server/api.mjs public/app.js __tests__/store.test.mjs __tests__/weekly.test.mjs
git commit -m "$(cat <<'EOF'
feat(scanner): return-aware weight learning + mixed-horizon label

qualityTarget = hitComponent(hitRate) x returnComponent(avgReturn),
newWeight blends 0.7/0.3, MIN_SAMPLES raised 3->8. Verify view shows a
current-price mixed-horizon badge (fixed-3d horizon is future work).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 코드리뷰 버그 4건

**Files:**
- Modify: `public/app.js` (게이지 널 가드, posSave/pos-del try/catch)
- Modify: `server/server.mjs` (readBody Buffer.concat, positions withLock)
- Test: `__tests__/routes.test.mjs` 또는 신규 `__tests__/readbody.test.mjs` (readBody), 기존 store.withLock 재사용

**Interfaces:**
- Consumes: `withLock`, `readJson`/`writeJson` (store.mjs, 기존), `readPositions`/`upsertPosition`/`deletePosition`/`writePositions` (positions.mjs, 기존)
- Produces: `readBody`를 테스트 위해 `server/server.mjs`에서 export.

- [ ] **Step 1: readBody Buffer.concat + export + test**

`server/server.mjs`의 `readBody`를 교체하고 `export`를 붙인다:
```javascript
// 요청 본문을 상한(16KB)까지 바이트로 모아 1회 UTF-8 디코드 후 JSON 파싱.
export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('본문이 너무 큽니다')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) } catch { reject(new Error('잘못된 JSON')) }
    })
    req.on('error', reject)
  })
}
```

Create `__tests__/readbody.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { readBody } from '../server/server.mjs'

// req 목: data 청크를 순차 emit 후 end.
function fakeReq(chunks) {
  const req = new EventEmitter()
  req.destroy = () => {}
  queueMicrotask(async () => {
    for (const c of chunks) { req.emit('data', c); await Promise.resolve() }
    req.emit('end')
  })
  return req
}

describe('readBody', () => {
  it('멀티바이트 한글이 청크 경계로 쪼개져도 온전히 파싱', async () => {
    const json = JSON.stringify({ korean_name: '스페이스아이디', entry: 60 })
    const buf = Buffer.from(json, 'utf-8')
    // 한글 문자 중간에서 강제 분할
    const mid = 20
    const body = await readBody(fakeReq([buf.subarray(0, mid), buf.subarray(mid)]))
    expect(body).toEqual({ korean_name: '스페이스아이디', entry: 60 })
  })
  it('빈 본문 → {}', async () => {
    expect(await readBody(fakeReq([]))).toEqual({})
  })
  it('16KB 초과 → reject', async () => {
    const big = Buffer.alloc(17 * 1024, 0x61)
    await expect(readBody(fakeReq([big]))).rejects.toThrow()
  })
})
```

Run: `npx vitest run __tests__/readbody.test.mjs`
Expected: 먼저 FAIL(import 시 서버가 listen 시도로 부작용 가능 → 아래 주의). 서버가 top-level에서 `server.listen`을 호출하므로, import 부작용을 피하기 위해 **`server.listen`을 `if (process.env.NODE_ENV !== 'test')` 가드로 감싸거나**, `readBody`를 별도 모듈로 뽑는다. 이 플랜은 후자를 택한다 → 다음 스텝.

- [ ] **Step 2: readBody를 lib/http-body.mjs로 분리(테스트 가능·부작용 없음)**

Create `lib/http-body.mjs`, 위 `readBody` 본문을 이동(export). `server/server.mjs`는 `import { readBody } from '../lib/http-body.mjs'`로 사용, 서버 파일 내 정의는 제거. `__tests__/readbody.test.mjs`의 import를 `'../lib/http-body.mjs'`로 변경.

Run: `npx vitest run __tests__/readbody.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 3: positions withLock (server.mjs POST/DELETE)**

`server/server.mjs` 상단 import에 `withLock`가 있는지 확인(없으면 `readJson` 옆 store import에 추가). POST/DELETE의 RMW를 `withLock`로 감싼다.

POST 현재:
```javascript
      const next = upsertPosition(readPositions(), v.position)
      await writePositions(next)
      return sendJson(res, 200, { ok: true, positions: next })
```
교체:
```javascript
      const next = await withLock('positions', async () => {
        const merged = upsertPosition(readPositions(), v.position)
        await writePositions(merged)
        return merged
      })
      return sendJson(res, 200, { ok: true, positions: next })
```

DELETE 현재:
```javascript
      const next = deletePosition(readPositions(), market)
      await writePositions(next)
      return sendJson(res, 200, { ok: true, positions: next })
```
교체:
```javascript
      const next = await withLock('positions', async () => {
        const remaining = deletePosition(readPositions(), market)
        await writePositions(remaining)
        return remaining
      })
      return sendJson(res, 200, { ok: true, positions: next })
```

- [ ] **Step 4: app.js 게이지 널 가드 + 핸들러 try/catch**

게이지: `posCardInner`의 gauge 분기 진입 조건에 price 널 가드 추가. 현재 조건:
```javascript
      if (p.stopLoss != null && p.takeProfit != null && p.takeProfit > p.stopLoss) {
```
교체:
```javascript
      if (p.price != null && p.stopLoss != null && p.takeProfit != null && p.takeProfit > p.stopLoss) {
```
(price 널이면 else 분기의 텍스트 fallback으로 빠져 `.pos-cur` NaN 마커를 렌더하지 않음.)

posSave 핸들러(현재 `$m('posSave').onclick = async () => { ... }`)의 `api(...)` 호출을 try/catch로 감싼다. 현재:
```javascript
    const r = await api('/api/positions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r && r.ok) { dlg.close(); routes.home() }
    else { $m('posErr').textContent = (r && r.error) || '저장 실패' }
```
교체:
```javascript
    try {
      const r = await api('/api/positions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r && r.ok) { dlg.close(); routes.home() }
      else { $m('posErr').textContent = (r && r.error) || '저장 실패' }
    } catch { $m('posErr').textContent = '네트워크 오류 — 다시 시도하세요' }
```

pos-del 핸들러(현재 `b.onclick = async (e) => { ... await api(DELETE...); routes.home() }`)를 try/catch로:
```javascript
      b.onclick = async (e) => {
        e.stopPropagation()
        if (!confirm(`${b.dataset.name} 포지션을 삭제할까요?`)) return
        try {
          await api(`/api/positions?market=${encodeURIComponent(b.dataset.market)}`, { method: 'DELETE' })
          routes.home()
        } catch { alert('삭제 실패 — 네트워크를 확인하세요') }
      }
```

- [ ] **Step 5: Syntax check + tests + smoke**

Run:
```bash
node --check server/server.mjs && node --check lib/http-body.mjs && node --check public/app.js
npx vitest run __tests__/readbody.test.mjs __tests__/positions.test.mjs __tests__/routes.test.mjs
```
Expected: 종료코드 0, 테스트 PASS.

정직: positions withLock의 동시성은 단위 테스트가 무거워 코드 인스펙션 + (선택) 스모크로 검증한다. `withLock`는 `store.test.mjs`에 이미 커버됨.

- [ ] **Step 6: Commit**

```bash
git add public/app.js server/server.mjs lib/http-body.mjs __tests__/readbody.test.mjs
git commit -m "$(cat <<'EOF'
fix(dashboard,server): gauge null guard, handler try/catch, readBody
utf8, positions RMW lock

readBody moved to lib/http-body.mjs, buffers bytes then decodes once;
POST/DELETE /api/positions wrapped in withLock; gauge skips marker when
price is null; modal save/delete handlers catch network errors.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 가중치 파일 분리 (backup/default/live/meta + readWeights)

**Files:**
- Create: `data/signal-weights.backup-preconfirmed.json`, `data/signal-weights.default.json`, `data/signal-weights.meta.json`
- Modify: `.gitignore`, `lib/store.mjs` (readWeights), `scripts/monitor.mjs`, `scripts/momentum-scan.mjs`, `server/server.mjs`, `scripts/weekly-analysis.mjs`
- Test: `__tests__/store.test.mjs` (readWeights)

**Interfaces:**
- Produces: `readWeights()` → Promise: 라이브(`signal-weights.json`) 있으면 그것, 없거나 빈 객체면 `signal-weights.default.json`.

- [ ] **Step 1: Generate backup, relaxed default, meta**

Run (현재 라이브 weights로 백업 + 50% 완화 default + meta 생성):
```bash
cd /c/Users/toodo/workspace/upbit-dashboard
cp data/signal-weights.json data/signal-weights.backup-preconfirmed.json
node -e '
const fs=require("fs");
const w=JSON.parse(fs.readFileSync("data/signal-weights.json","utf8"));
const relaxed={}; for(const[k,v]of Object.entries(w)){ relaxed[k]=+(1+(v-1)*0.5).toFixed(4); }
fs.writeFileSync("data/signal-weights.default.json", JSON.stringify(relaxed,null,2)+"\n");
fs.writeFileSync("data/signal-weights.meta.json", JSON.stringify({signalVersion:"confirmed-candle-v1",seededFrom:"preconfirmed-7wk-relaxed50",createdAt:"2026-07-13"},null,2)+"\n");
console.log("default keys:", Object.keys(relaxed).length);
'
```
Expected: `default keys: 30`. `signal-weights.default.json`은 각 값이 1.0 쪽으로 절반 당겨진 값(예 역삼중바닥 1.30 → 1.15, MACD 골든크로스 0.75 → 0.875).

- [ ] **Step 2: Reset live to relaxed baseline (cutover)**

Run:
```bash
cp data/signal-weights.default.json data/signal-weights.json
```
(라이브를 완화 baseline으로 리셋 — 확정봉 regime 재학습 시작점. 기존 튜닝은 backup에 보존.)

- [ ] **Step 3: .gitignore + untrack live**

`.gitignore`에 한 줄 추가:
```
data/signal-weights.json
```
Run: `git rm --cached data/signal-weights.json`

- [ ] **Step 4: readWeights + test**

`__tests__/store.test.mjs`에 추가:
```javascript
import { readWeights } from '../lib/store.mjs'
// (참고: readWeights는 DATA_DIR 실제 파일을 읽으므로, 여기선 함수 존재/폴백 계약만 가볍게 확인)
describe('readWeights', () => {
  it('함수이며 Promise 반환', async () => {
    expect(typeof readWeights).toBe('function')
    const w = await readWeights()
    expect(w && typeof w === 'object').toBe(true)
  })
})
```

`lib/store.mjs`에 추가:
```javascript
// 라이브 가중치(signal-weights.json)를 읽되 없거나 비면 default 시드로 폴백.
export async function readWeights() {
  const live = await readJson('signal-weights.json', null)
  if (live && Object.keys(live).length) return live
  return await readJson('signal-weights.default.json', {})
}
```

Run: `npx vitest run __tests__/store.test.mjs`
Expected: PASS.

- [ ] **Step 5: Swap call sites to readWeights**

아래 `readJson('signal-weights.json', {})` (또는 `readJson('signal-weights.json', ...)`)를 `readWeights()`로 교체하고, 각 파일에 `readWeights` import 추가:
- `scripts/monitor.mjs`: `const weights = await readJson('signal-weights.json', {})` → `const weights = await readWeights()`
- `scripts/momentum-scan.mjs`: 동일 패턴 있으면 교체(없으면 스킵)
- `server/server.mjs` `/api/analyze`: `const weights = await readJson('signal-weights.json', {})` → `const weights = await readWeights()`
- `server/server.mjs` `/api/weights` 라우트: `return sendJson(res, 200, await readJson('signal-weights.json', {}))` → `return sendJson(res, 200, await readWeights())`
- `scripts/weekly-analysis.mjs`: 락 안 `oldWeights = await readJson('signal-weights.json', {})` → `oldWeights = await readWeights()` (쓰기 `writeJson('signal-weights.json', newWeights)`는 그대로).

- [ ] **Step 6: Syntax check + commit**

Run: `node --check scripts/monitor.mjs && node --check scripts/momentum-scan.mjs && node --check server/server.mjs && node --check scripts/weekly-analysis.mjs && npx vitest run __tests__/store.test.mjs`
Expected: 종료코드 0, PASS.

```bash
git add .gitignore lib/store.mjs scripts/monitor.mjs scripts/momentum-scan.mjs server/server.mjs scripts/weekly-analysis.mjs __tests__/store.test.mjs data/signal-weights.backup-preconfirmed.json data/signal-weights.default.json data/signal-weights.meta.json
git commit -m "$(cat <<'EOF'
chore(weights): split live/default/backup, gitignore live, readWeights

Live signal-weights.json is now gitignored runtime state; default is a
50%-relaxed baseline seed for the confirmed-candle regime; the prior
7-week tuning is preserved in backup-preconfirmed.json. signalVersion
recorded in meta. All readers use readWeights() with default fallback.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 회귀 + CHANGELOG

**Files:**
- Modify: `docs/CHANGELOG-2026-07.md`

- [ ] **Step 1: Full suite green**

Run: `npx vitest run`
Expected: 전체 PASS (신규 ohlcv/readbody 포함, 기존 회귀 없음). 실패 시 해당 Task로 돌아가 수정.

- [ ] **Step 2: CHANGELOG 항목 추가**

`docs/CHANGELOG-2026-07.md`의 "## 5. 대시보드 — 포지션 직접 편집" 뒤, "## 운영 메모" 앞에 추가:

```markdown
## 6. 신호 신뢰도 개선 (2026-07-13)

- **확정봉 판정**: 일봉 신호를 형성 중(오늘) 봉 제외한 확정 캔들로 판정(`lib/ohlcv.mjs::confirmedOhlcv`). monitor·momentum·backtest·`/api/analyze` 적용, 각 fetch N+1(EMA200·200봉 신고가 위해 201). 09:00 신호가 종가에 뒤집히는 구조적 문제(시커·게임빌드 손절 원인) 제거. 차트는 전체 봉 유지.
- **수익 반영 학습**: `qualityTarget = hitComponent(적중률) × returnComponent(평균수익, B안 clamp 0.85~1.25)`, `newWeight` 0.7/0.3 블렌드, `MIN_SAMPLES 3→8`. 보유기간 혼재는 후속(+3일 고정 horizon), 검증 화면에 `mixed-horizon` 배지.
- **버그 4건**: 게이지 널 시세 가드, 모달 저장/삭제 네트워크 예외 처리, `readBody` 바이트 누적 후 1회 디코드(한글 청크 손상 방지, `lib/http-body.mjs`), positions RMW `withLock`.
- **가중치 파일 위생**: 라이브 `signal-weights.json` gitignore, `signal-weights.default.json`(완화 baseline)·`backup-preconfirmed.json`·`meta.json`(signalVersion). 확정봉 regime 재학습 시작.
- 설계·계획: `docs/superpowers/specs|plans/2026-07-13-signal-reliability*.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/CHANGELOG-2026-07.md
git commit -m "$(cat <<'EOF'
docs: changelog for signal-reliability improvements

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (작성자 체크)

**1. Spec coverage:**
- #0 검증+갭테스트 → Task 0 ✓
- #1 confirmedOhlcv 헬퍼(lib/ohlcv.mjs, 계약) → Task 1 ✓; 적용+N+1 → Task 2 ✓
- #2 hit/return/quality/newWeight + updateWeights avgReturn·MIN8 + mixed-horizon 라벨 → Task 3 ✓
- #3 버그 4건 → Task 4 ✓
- #4 backup/default/live/meta + gitignore + readWeights → Task 5 ✓
- 테스트 계획 항목 → Task별 테스트 ✓; 회귀+CHANGELOG → Task 6 ✓

**2. Placeholder scan:** 모든 스텝에 실제 코드/명령. TBD 없음. (Task 2·4 일부는 스크립트 통합/동시성이라 node --check + 회귀 + 스모크로 검증한다고 명시 — 근거 있는 비-단위검증.)

**3. Type consistency:**
- `confirmedOhlcv`/`ensureMinConfirmed`(Task1) = Task2 사용 일치 ✓
- `hitComponent`/`returnComponent`/`qualityTarget`/`newWeight(old,hit,avgReturn)`(Task3 store) = Task3 weekly 사용 일치 ✓
- `readWeights()`(Task5) = Task5 호출부 교체 일치 ✓; Task2에서 남겨둔 `readJson('signal-weights.json')`은 Task5에서 교체(명시) ✓
- `readBody`(Task4, lib/http-body.mjs) = server import 일치 ✓
