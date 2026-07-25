# 조용한 바닥 전략 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증된 "조용한 바닥" 시그니처를 순수 함수로 규칙화하고, 그리드 백테스트로 파라미터를 확정한 뒤, 스캐너가 전략픽(손절·목표 포함)과 추격 경고를 태깅한다.

**Architecture:** `lib/strategy.mjs`(판정·레벨·시뮬 순수 함수, 백테스트와 라이브가 동일 함수 공유) + `scripts/strategy-backtest.mjs`(216조합 그리드, 종목당 1-fetch, 지표 시리즈 사전계산) + `data/strategy-config.json`(git 추적 파라미터) + monitor.mjs 태깅 + 홈 탭 표시. 스펙: `docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md`.

**Tech Stack:** Node.js ESM(.mjs), vitest, 기존 lib/indicators.mjs 재사용.

## Global Constraints

- 시그니처: `RSI(14) <= rsiMax && Stoch K <= stochMax && volRatio(21봉) <= volMax`, 확정봉 60개 미만이면 null.
- 백테스트 룩어헤드 방지: 신호봉 다음날 **시가** 진입. 한 봉에서 손절·목표 동시 도달 시 **손절 우선**. 청산 전 재진입 금지.
- 파라미터 자동 선정: `trades >= 80` 조합 중 `avgRet` 최대, 동률이면 `winRate` 높은 쪽.
- 라이브 태깅은 점수를 변경하지 않는다(표시 전용). 태그 문자열: `'🎯전략(조용한바닥)'`, `'⚠️추격주의(급등후)'`(volRatio >= 5).
- `data/strategy-config.json`·`data/strategy-backtest-results.json`은 git 추적.
- strategy-config.json 없으면 전략 태깅 스킵, 스캔은 정상 진행.
- 라이브 8787 서버는 구현 중 건드리지 않는다(최종 검증 단계에서만 재시작).
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 새 파일 UTF-8(BOM 없음), Write/Edit 도구로만 작성.

---

### Task 1: lib/strategy.mjs — detectQuietBottom + strategyLevels

**Files:**
- Create: `lib/strategy.mjs`
- Test: `__tests__/strategy.test.mjs`

**Interfaces:**
- Consumes: `lib/indicators.mjs`의 `calcRSI(closes, p=14)`, `calcStochastic(highs, lows, closes)` → `{k,d,prevK,prevD}|null`, `calcVolRatio(volumes)` → `number|null`.
- Produces: `detectQuietBottom(confirmed, params) → {rsi, stochK, volRatio}|null` (params `{rsiMax, stochMax, volMax, minCandles?=60}`), `strategyLevels(entryPrice, {slPct, tpPct}) → {stopLoss, takeProfit}|null`.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/strategy.test.mjs` 생성:

```js
import { describe, it, expect } from 'vitest'
import { detectQuietBottom, strategyLevels } from '../lib/strategy.mjs'

// 합성 확정봉: 완만한 하락 + 조용한 거래량 (지표값은 실계산 결과를 기준으로 경계 검증)
const mkCandles = (n) => Array.from({ length: n }, (_, i) => {
  const close = 200 - i // 단조 하락 → RSI/Stoch 낮음
  return { time: i * 86400, open: close + 1, high: close + 2, low: close - 2, close, volume: 10 }
})

describe('detectQuietBottom', () => {
  const permissive = { rsiMax: 100, stochMax: 100, volMax: 10 }
  it('조건 전부 충족 시 지표값 반환', () => {
    const r = detectQuietBottom(mkCandles(70), permissive)
    expect(r).not.toBeNull()
    expect(r.rsi).toBeGreaterThanOrEqual(0)
    expect(r.stochK).toBeGreaterThanOrEqual(0)
    expect(r.volRatio).toBeCloseTo(1, 1) // 균일 거래량 → ~1.0
  })
  it('경계 포함(<=): rsiMax를 실제 rsi로 두면 매치, 그보다 낮추면 null', () => {
    const r = detectQuietBottom(mkCandles(70), permissive)
    expect(detectQuietBottom(mkCandles(70), { ...permissive, rsiMax: r.rsi })).not.toBeNull()
    expect(detectQuietBottom(mkCandles(70), { ...permissive, rsiMax: r.rsi - 0.01 })).toBeNull()
  })
  it('Stoch·vol 경계도 동일 규칙', () => {
    const r = detectQuietBottom(mkCandles(70), permissive)
    expect(detectQuietBottom(mkCandles(70), { ...permissive, stochMax: r.stochK - 0.01 })).toBeNull()
    expect(detectQuietBottom(mkCandles(70), { ...permissive, volMax: r.volRatio - 0.01 })).toBeNull()
  })
  it('확정봉 60개 미만 → null', () => {
    expect(detectQuietBottom(mkCandles(59), permissive)).toBeNull()
    expect(detectQuietBottom([], permissive)).toBeNull()
    expect(detectQuietBottom(null, permissive)).toBeNull()
  })
})

describe('strategyLevels', () => {
  it('손절·목표 계산', () => {
    const lv = strategyLevels(100, { slPct: 7, tpPct: 12 })
    expect(lv.stopLoss).toBeCloseTo(93)
    expect(lv.takeProfit).toBeCloseTo(112)
  })
  it('entry 0 이하 → null', () => {
    expect(strategyLevels(0, { slPct: 7, tpPct: 12 })).toBeNull()
    expect(strategyLevels(-1, { slPct: 7, tpPct: 12 })).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/strategy.test.mjs`
Expected: FAIL — `Cannot find module '../lib/strategy.mjs'`

- [ ] **Step 3: 최소 구현**

`lib/strategy.mjs` 생성:

```js
// 조용한 바닥(선행 진입) 전략 — 순수 함수.
// 검증 근거: 스코어카드 6주 — 거래량 조용한 깊은 과매도 진입이 추격 대비 우위
// (docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md)
// 파라미터는 data/strategy-config.json (백테스트로만 갱신, 주간 가중치 학습과 무관).
import { calcRSI, calcStochastic, calcVolRatio } from './indicators.mjs'

// 확정봉 배열에서 "조용한 바닥" 시그니처 판정. 충족 시 지표값, 아니면 null.
export function detectQuietBottom(confirmed, params) {
  const { rsiMax, stochMax, volMax, minCandles = 60 } = params ?? {}
  if (!Array.isArray(confirmed) || confirmed.length < Math.max(minCandles, 22)) return null
  const closes = confirmed.map((c) => c.close)
  const highs = confirmed.map((c) => c.high)
  const lows = confirmed.map((c) => c.low)
  const volumes = confirmed.map((c) => c.volume)
  const rsi = calcRSI(closes)
  const stoch = calcStochastic(highs, lows, closes)
  const volRatio = calcVolRatio(volumes)
  if (rsi == null || stoch == null || volRatio == null) return null
  if (rsi <= rsiMax && stoch.k <= stochMax && volRatio <= volMax) {
    return { rsi, stochK: stoch.k, volRatio }
  }
  return null
}

// 진입가 기준 손절·목표가. slPct/tpPct는 양수 %.
export function strategyLevels(entryPrice, params) {
  if (!(entryPrice > 0)) return null
  const { slPct, tpPct } = params
  return {
    stopLoss: entryPrice * (1 - slPct / 100),
    takeProfit: entryPrice * (1 + tpPct / 100),
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/strategy.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/strategy.mjs __tests__/strategy.test.mjs
git commit -m "feat: 조용한 바닥 시그니처 판정·레벨 계산"
```

---

### Task 2: lib/strategy.mjs — simulateTrade + quietBottomSeries

**Files:**
- Modify: `lib/strategy.mjs`
- Test: `__tests__/strategy.test.mjs` (추가)

**Interfaces:**
- Consumes: Task 1의 `strategyLevels`. `lib/indicators.mjs`의 `calcRSISeries(closes, p=14)` (각 봉의 RSI 배열, period 미만 인덱스 null — 마지막 값은 calcRSI와 일치).
- Produces:
  - `simulateTrade(candles, entryIdx, params) → {ret, exitIdx, reason:'sl'|'tp'|'time'}|null` — params `{slPct, tpPct, holdMax}`. 진입 `candles[entryIdx+1].open`, 보유는 진입봉 포함 최대 holdMax봉, 시간청산은 `candles[entryIdx+holdMax].close`. 히스토리가 끝나 청산 못 하면 null(미완료 거래).
  - `quietBottomSeries(confirmed, params) → boolean[]` — 각 인덱스 i에 대해 `detectQuietBottom(confirmed.slice(0, i+1), params) !== null`과 동일한 결과를 O(n)으로 계산 (백테스트 고속화용).

- [ ] **Step 1: 실패하는 테스트 추가**

`__tests__/strategy.test.mjs`의 import 줄을 다음으로 교체:

```js
import { detectQuietBottom, strategyLevels, simulateTrade, quietBottomSeries } from '../lib/strategy.mjs'
```

파일 끝에 append:

```js
describe('simulateTrade', () => {
  const P = { slPct: 5, tpPct: 10, holdMax: 3 }
  const c = (open, high, low, close) => ({ open, high, low, close, volume: 1, time: 0 })
  // idx0 = 신호봉, idx1부터 진입 (진입가 = idx1 open = 100)
  it('목표 도달 → tp 청산', () => {
    const r = simulateTrade([c(0, 0, 0, 0), c(100, 111, 99, 105)], 0, P)
    expect(r).toEqual({ ret: expect.closeTo(0.10, 5), exitIdx: 1, reason: 'tp' })
  })
  it('손절 도달 → sl 청산', () => {
    const r = simulateTrade([c(0, 0, 0, 0), c(100, 104, 94, 96)], 0, P)
    expect(r.reason).toBe('sl')
    expect(r.ret).toBeCloseTo(-0.05)
  })
  it('같은 봉에서 손절·목표 동시 도달 → 손절 우선', () => {
    const r = simulateTrade([c(0, 0, 0, 0), c(100, 120, 90, 100)], 0, P)
    expect(r.reason).toBe('sl')
  })
  it('미도달 → holdMax봉째 종가 시간청산', () => {
    const flat = c(100, 102, 98, 101)
    const r = simulateTrade([c(0, 0, 0, 0), flat, flat, c(100, 102, 98, 103)], 0, P)
    expect(r).toEqual({ ret: expect.closeTo(0.03, 5), exitIdx: 3, reason: 'time' })
  })
  it('히스토리 끝 — 청산 못 하면 null (미완료 거래 제외)', () => {
    expect(simulateTrade([c(0, 0, 0, 0), c(100, 102, 98, 101)], 0, P)).toBeNull()
  })
  it('진입봉 자체가 없으면 null', () => {
    expect(simulateTrade([c(0, 0, 0, 0)], 0, P)).toBeNull()
  })
})

describe('quietBottomSeries — detectQuietBottom 프리픽스 호출과 동치', () => {
  it('90봉 합성 데이터에서 전 인덱스 일치', () => {
    const candles = Array.from({ length: 90 }, (_, i) => {
      const close = 100 + 15 * Math.sin(i / 5) + (i % 3)
      return { time: i * 86400, open: close, high: close + 2, low: close - 2, close, volume: 10 + (i % 5) * 3 }
    })
    const params = { rsiMax: 48, stochMax: 55, volMax: 1.2, minCandles: 60 }
    const series = quietBottomSeries(candles, params)
    expect(series.length).toBe(90)
    for (let i = 0; i < 90; i++) {
      const expected = detectQuietBottom(candles.slice(0, i + 1), params) !== null
      expect(series[i], `index ${i}`).toBe(expected)
    }
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/strategy.test.mjs`
Expected: FAIL — `simulateTrade is not a function`

- [ ] **Step 3: 구현**

`lib/strategy.mjs`에 append:

```js
// 백테스트 거래 시뮬레이션. 진입은 신호봉(entryIdx) 다음봉 시가 — 룩어헤드 방지.
// 보유는 진입봉 포함 최대 holdMax봉. 한 봉에서 손절·목표 동시 도달 시 손절 우선(보수적).
// 히스토리가 끝나 청산하지 못한 거래는 null(집계 제외).
export function simulateTrade(candles, entryIdx, params) {
  const { slPct, tpPct, holdMax } = params
  const entryCandle = candles[entryIdx + 1]
  if (!entryCandle || !(entryCandle.open > 0)) return null
  const entry = entryCandle.open
  const { stopLoss, takeProfit } = strategyLevels(entry, { slPct, tpPct })
  const last = entryIdx + holdMax
  for (let i = entryIdx + 1; i <= last && i < candles.length; i++) {
    const c = candles[i]
    if (c.low <= stopLoss) return { ret: stopLoss / entry - 1, exitIdx: i, reason: 'sl' }
    if (c.high >= takeProfit) return { ret: takeProfit / entry - 1, exitIdx: i, reason: 'tp' }
    if (i === last) return { ret: c.close / entry - 1, exitIdx: i, reason: 'time' }
  }
  return null
}

// Stoch K 시리즈 (calcStochastic의 k와 프리픽스 단위로 동치 — 동치성은 테스트로 보증)
function stochKSeries(highs, lows, closes, period = 14, sk = 3) {
  const n = closes.length
  const rawK = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1))
    const l = Math.min(...lows.slice(i - period + 1, i + 1))
    rawK[i] = h === l ? 50 : ((closes[i] - l) / (h - l)) * 100
  }
  const out = new Array(n).fill(null)
  for (let i = period - 1 + sk - 1; i < n; i++) {
    let s = 0
    for (let j = i - sk + 1; j <= i; j++) s += rawK[j]
    out[i] = s / sk
  }
  return out
}

// 각 인덱스에서의 시그니처 판정 배열 — detectQuietBottom(slice(0,i+1))과 동치, O(n).
// 백테스트에서 (rsiMax,stochMax,volMax) 조합당 히스토리 1회 순회로 신호일을 뽑는다.
export function quietBottomSeries(confirmed, params) {
  const { rsiMax, stochMax, volMax, minCandles = 60 } = params ?? {}
  const n = Array.isArray(confirmed) ? confirmed.length : 0
  const out = new Array(n).fill(false)
  if (n === 0) return out
  const closes = confirmed.map((c) => c.close)
  const highs = confirmed.map((c) => c.high)
  const lows = confirmed.map((c) => c.low)
  const volumes = confirmed.map((c) => c.volume)
  const rsiS = calcRSISeries(closes)
  const kS = stochKSeries(highs, lows, closes)
  const first = Math.max(minCandles, 22) - 1
  for (let i = first; i < n; i++) {
    if (rsiS[i] == null || kS[i] == null || i < 20) continue
    let avg = 0
    for (let j = i - 20; j < i; j++) avg += volumes[j]
    avg /= 20
    if (avg <= 0) continue
    const volRatio = volumes[i] / avg
    out[i] = rsiS[i] <= rsiMax && kS[i] <= stochMax && volRatio <= volMax
  }
  return out
}
```

그리고 파일 상단 import를 다음으로 교체:

```js
import { calcRSI, calcRSISeries, calcStochastic, calcVolRatio } from './indicators.mjs'
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/strategy.test.mjs`
Expected: PASS (13 tests — 동치성 테스트가 프리픽스 90회 비교 포함)

- [ ] **Step 5: 커밋**

```bash
git add lib/strategy.mjs __tests__/strategy.test.mjs
git commit -m "feat: 전략 거래 시뮬·시그니처 시리즈 (백테스트 코어)"
```

---

### Task 3: scripts/strategy-backtest.mjs — 그리드 백테스트 러너

**Files:**
- Create: `scripts/strategy-backtest.mjs`
- Modify: `package.json` (scripts에 `"strategy-backtest": "node scripts/strategy-backtest.mjs"` 추가 — `"scorecard"` 줄 아래)

**Interfaces:**
- Consumes: `quietBottomSeries`, `simulateTrade` (lib/strategy.mjs), `getMarkets`/`getDayCandles`/`candlesToOhlcv` (lib/upbit.mjs), `confirmedOhlcv` (lib/ohlcv.mjs), `writeJson` (lib/store.mjs).
- Produces: `data/strategy-backtest-results.json` = `{ ranAt, markets, combos: [{params..., trades, winRate, avgRet, tpRate, slRate, timeRate}] (avgRet 내림차순) }`, `data/strategy-config.json` = `{ version:'quiet-bottom-v1', confirmedAt, rsiMax, stochMax, volMax, slPct, tpPct, holdMax }`.

- [ ] **Step 1: 러너 작성**

`scripts/strategy-backtest.mjs` 생성:

```js
// 조용한 바닥 전략 그리드 백테스트.
// 종목당 일봉 1회 fetch → 지표 시리즈 기반 신호일 추출(검출 8조합) → 청산 27조합 시뮬.
// 선정: trades >= MIN_TRADES 중 avgRet 최대(동률 시 winRate) → strategy-config.json 기록.
import { getMarkets, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { quietBottomSeries, simulateTrade } from '../lib/strategy.mjs'
import { writeJson } from '../lib/store.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN_TRADES = 80
const DETECT = []
for (const rsiMax of [26, 30]) for (const stochMax of [15, 20]) for (const volMax of [1.5, 2.0])
  DETECT.push({ rsiMax, stochMax, volMax })
const EXIT = []
for (const slPct of [5, 7, 10]) for (const tpPct of [8, 12, 18]) for (const holdMax of [3, 5, 7])
  EXIT.push({ slPct, tpPct, holdMax })

async function main() {
  const markets = await getMarkets()
  console.log(`전략 백테스트 — ${markets.length}종목 × ${DETECT.length * EXIT.length}조합`)
  const histories = []
  let failed = 0
  for (const m of markets) {
    const candles = await getDayCandles(m.market, 200)
    await sleep(200)
    if (!candles || candles.length < 80) { failed++; continue }
    histories.push(confirmedOhlcv(candlesToOhlcv(candles)))
  }
  console.log(`캔들 확보 ${histories.length} / 스킵 ${failed}`)

  const results = []
  for (const det of DETECT) {
    // 검출 조합당 신호일 시리즈를 히스토리별로 1회만 계산
    const signalSets = histories.map((h) => quietBottomSeries(h, det))
    for (const exit of EXIT) {
      let trades = 0, wins = 0, total = 0, tp = 0, sl = 0, time = 0
      for (let hIdx = 0; hIdx < histories.length; hIdx++) {
        const h = histories[hIdx]
        const sig = signalSets[hIdx]
        let i = 0
        while (i < h.length - 1) {
          if (sig[i]) {
            const t = simulateTrade(h, i, exit)
            if (t) {
              trades++; total += t.ret
              if (t.ret > 0) wins++
              if (t.reason === 'tp') tp++
              else if (t.reason === 'sl') sl++
              else time++
              i = t.exitIdx + 1 // 청산 전 재진입 금지
              continue
            }
          }
          i++
        }
      }
      results.push({
        ...det, ...exit, trades,
        winRate: trades ? +(wins / trades).toFixed(4) : null,
        avgRet: trades ? +(total / trades).toFixed(5) : null,
        tpRate: trades ? +(tp / trades).toFixed(3) : null,
        slRate: trades ? +(sl / trades).toFixed(3) : null,
        timeRate: trades ? +(time / trades).toFixed(3) : null,
      })
    }
  }

  results.sort((a, b) => (b.avgRet ?? -1) - (a.avgRet ?? -1) || (b.winRate ?? 0) - (a.winRate ?? 0))
  await writeJson('strategy-backtest-results.json', { ranAt: new Date().toISOString(), markets: histories.length, combos: results })

  console.log('--- 상위 10 조합 ---')
  for (const r of results.slice(0, 10)) {
    console.log(`RSI<=${r.rsiMax} K<=${r.stochMax} vol<=${r.volMax} SL${r.slPct} TP${r.tpPct} hold${r.holdMax}` +
      ` | n=${r.trades} 승률 ${(r.winRate * 100).toFixed(1)}% 평균 ${(r.avgRet * 100).toFixed(2)}% (tp ${(r.tpRate * 100).toFixed(0)}/sl ${(r.slRate * 100).toFixed(0)}/time ${(r.timeRate * 100).toFixed(0)}%)`)
  }

  const eligible = results.filter((r) => r.trades >= MIN_TRADES)
  if (!eligible.length) {
    console.error(`선정 실패: trades >= ${MIN_TRADES} 조합 없음 — strategy-config.json 미기록`)
    process.exitCode = 1
    return
  }
  const best = eligible[0] // results가 이미 avgRet→winRate 정렬이므로 첫 eligible이 최적
  const config = {
    version: 'quiet-bottom-v1', confirmedAt: new Date().toISOString(),
    rsiMax: best.rsiMax, stochMax: best.stochMax, volMax: best.volMax,
    slPct: best.slPct, tpPct: best.tpPct, holdMax: best.holdMax,
  }
  await writeJson('strategy-config.json', config)
  console.log('선정:', JSON.stringify(config))
}

main()
```

- [ ] **Step 2: 문법·스위트 확인 (네트워크 실행 금지 — 실제 실행은 Task 4)**

Run: `node --check scripts/strategy-backtest.mjs && npx vitest run __tests__/strategy.test.mjs`
Expected: 문법 OK, 13 tests PASS

- [ ] **Step 3: package.json 수정**

scripts의 `"scorecard"` 줄 아래에 추가:

```json
"strategy-backtest": "node scripts/strategy-backtest.mjs",
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/strategy-backtest.mjs package.json
git commit -m "feat: 전략 그리드 백테스트 러너 (216조합, 1-fetch)"
```

---

### Task 4: 백테스트 실행·파라미터 확정 (컨트롤러 인라인 — 네트워크·데이터 작업)

**Files:**
- 실행: `npm run strategy-backtest`
- 산출: `data/strategy-backtest-results.json`, `data/strategy-config.json` (커밋)

- [ ] **Step 1: 실행**

Run: `npm run strategy-backtest` (약 260종목 × 200ms ≈ 1분 + 로컬 시뮬)
Expected: `캔들 확보 N / 스킵 M`, 상위 10 조합 표, `선정: {...}` 출력. exitCode 0.

- [ ] **Step 2: 결과 새너티 체크**

- 선정 조합의 trades >= 80, avgRet > 0 확인.
- 상위 조합들의 승률·평균이 스코어카드 관측치(+3일 승률 ~57%, MFE ~11%)와 자릿수가 맞는지 눈으로 확인 — 크게 어긋나면(예: 승률 90%+) 시뮬 버그 의심하고 조사.

- [ ] **Step 3: 커밋**

```bash
git add data/strategy-backtest-results.json data/strategy-config.json
git commit -m "data: 전략 백테스트 결과·파라미터 확정 (quiet-bottom-v1)"
```

---

### Task 5: 라이브 태깅 + 추격 경고 + UI

**Files:**
- Modify: `scripts/monitor.mjs` (import 1줄, config 로드 1줄, 태깅 블록)
- Modify: `public/app.js` (topTable 신호 셀 1줄)

**Interfaces:**
- Consumes: `detectQuietBottom`, `strategyLevels` (lib/strategy.mjs), `data/strategy-config.json` (Task 4가 생성; 없으면 태깅 스킵), monitor.mjs 내부의 `confirmed`(확정봉 배열)·`sig.price`·`sig.volRatio`·`buySignals`·`item`.
- Produces: buy item에 `strategy: {stopLoss, takeProfit}` 필드(전략픽일 때만)와 태그 `'🎯전략(조용한바닥)'`, volRatio>=5일 때 태그 `'⚠️추격주의(급등후)'`. 홈 탭 신호 셀에 손절·목표 표시.

- [ ] **Step 1: monitor.mjs — import·config 로드 추가**

import 블록의 `import { detectLiquiditySweep, ... }` 줄 아래에 추가:

```js
import { detectQuietBottom, strategyLevels } from '../lib/strategy.mjs'
```

스캔 함수 안 `const weights = await readWeights()` 바로 아래에 추가:

```js
  const strategyConfig = await readJson('strategy-config.json', null) // 없으면 전략 태깅 스킵
```

- [ ] **Step 2: monitor.mjs — 태깅 블록 삽입**

`if (pers.signals.length) buySignals = [...buySignals, ...pers.signals]` 줄 바로 아래에 삽입:

```js
      // 추격 경고: 거래량 급증 후 진입은 통계적으로 불리 (+3일 승률 30%, 평균 -3.4%)
      if (sig.volRatio != null && sig.volRatio >= 5) buySignals = [...buySignals, '⚠️추격주의(급등후)']
      // 조용한 바닥 전략 태깅 (표시 전용 — 점수 불변)
      let strategyLv = null
      if (strategyConfig) {
        const qb = detectQuietBottom(confirmed, strategyConfig)
        if (qb) {
          const lv = strategyLevels(sig.price, strategyConfig)
          if (lv) {
            strategyLv = { stopLoss: +lv.stopLoss.toFixed(2), takeProfit: +lv.takeProfit.toFixed(2) }
            buySignals = [...buySignals, '🎯전략(조용한바닥)']
          }
        }
      }
```

그리고 item 생성 블록(`if (lowLiq) item.lowLiquidity = true` 줄 근처)에 한 줄 추가:

```js
        if (strategyLv) item.strategy = strategyLv
```

- [ ] **Step 3: app.js — topTable 신호 셀에 전략 레벨 표시**

`function topTable` 안의 `<td>${signalTags(x.signals)}</td>` 를 다음으로 교체:

```js
        <td>${signalTags(x.signals)}${x.strategy ? `<div class="text-xs mt-1 opacity-80">🎯 손절 ${fmt(x.strategy.stopLoss)} · 목표 ${fmt(x.strategy.takeProfit)}</div>` : ''}</td>
```

- [ ] **Step 4: 검증**

Run: `node --check scripts/monitor.mjs && node --check public/app.js && npx vitest run`
Expected: 문법 OK, 전체 스위트 PASS (스캔 실행은 Task 6에서)

- [ ] **Step 5: 커밋**

```bash
git add scripts/monitor.mjs public/app.js
git commit -m "feat: 전략픽 태깅(손절·목표)·추격 경고 — 표시 전용"
```

---

### Task 6: 최종 검증·CHANGELOG (컨트롤러 인라인)

**Files:**
- 실행: 수동 스캔 1회, 서버 재시작, 스크린샷 검증
- Modify: `docs/CHANGELOG-2026-07.md`

- [ ] **Step 1: 수동 스캔으로 라이브 태깅 확인**

Run: `node scripts/monitor.mjs` → 최신 스캔의 buy에 `🎯전략(조용한바닥)`/`⚠️추격주의(급등후)` 태그와 `strategy` 필드가 조건 맞는 종목에 붙는지 monitor-log.json에서 확인. (조건 맞는 종목이 그 시점에 없으면 태그 0개도 정상 — detectQuietBottom을 후보 1~2개 종목에 수동 호출해 로직 확인)

- [ ] **Step 2: 서버 재시작 + 홈 탭 스크린샷**

8787 종료 → `npm run dashboard` 백그라운드 → 헤드리스 Edge로 `#/home` 스크린샷 → 전략픽 행에 손절·목표 라인 표시 확인 (전략픽 없으면 태그 렌더링 회귀 없음만 확인).

- [ ] **Step 3: CHANGELOG 섹션 추가**

`docs/CHANGELOG-2026-07.md`의 `## 운영 메모` 위에 삽입:

```markdown
## 8. 조용한 바닥 전략 (2026-07-25)

- 스코어카드 검증 엣지(조용한 과매도 진입 우위, 추격 열위)를 규칙화 — `lib/strategy.mjs` 순수 함수(판정·레벨·시뮬), 백테스트와 라이브 동일 로직.
- 그리드 백테스트(`npm run strategy-backtest`, 216조합·룩어헤드 방지·손절 우선)로 파라미터 확정 → `data/strategy-config.json`(git 추적, 주간 학습과 분리).
- 스캐너: 시그니처 매칭 시 `🎯전략(조용한바닥)` 태그 + 손절·목표가, `volRatio>=5`면 `⚠️추격주의(급등후)` — 점수 불변(표시 전용).
- 레짐 게이트 없음(깊은 약세 ratio 0~0.2에서 승률 57%로 최고 — 데이터 근거). 스펙: `docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md`
```

- [ ] **Step 4: 커밋**

```bash
git add docs/CHANGELOG-2026-07.md
git commit -m "docs: CHANGELOG — 조용한 바닥 전략"
```
