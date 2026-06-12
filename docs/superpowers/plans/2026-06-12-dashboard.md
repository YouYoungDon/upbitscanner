# 업비트 스캐너 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 zero-dep Node 스캐너 위에 로컬 웹 대시보드(사이드바 4탭)와 캔들스틱 패턴 분석 모듈을 추가한다.

**Architecture:** Node 내장 `http` 서버가 `data/*.json`을 읽어 JSON API로 제공하고, `monitor.mjs`를 자식 프로세스로 실행해 비동기 스캔을 돌린다. 프론트는 의존성 없는 바닐라 JS SPA(해시 라우팅)이며 차트는 CDN lightweight-charts를 쓴다. 캔들스틱 패턴은 신규 순수 모듈로 감지해 개별분석 표시 + 스캔 점수에 반영한다.

**Tech Stack:** Node 24 (ESM, zero-dep), 내장 `http`/`child_process`, lightweight-charts(CDN), Vitest.

---

## Task 1: 캔들스틱 패턴 모듈 (lib/candle-patterns.mjs)

**Files:**
- Create: `lib/candle-patterns.mjs`
- Test: `__tests__/candle-patterns.test.mjs`

캔들 한 개의 형태 헬퍼와 다봉 패턴 감지를 분리한다. 입력 `ohlcv`는 과거→최신,
각 원소 `{ open, high, low, close, volume }`. 단, 기존 `candlesToOhlcv`는 `open`을
포함하지 않으므로 이 모듈은 `open`이 있으면 쓰고 없으면 직전 종가를 open으로 간주한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/candle-patterns.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { detectCandlePatterns } from '../lib/candle-patterns.mjs'

// 헬퍼: 봉 생성
const c = (open, high, low, close) => ({ open, high, low, close, volume: 10 })
// 하락추세 5봉 (망치형/장악형 컨텍스트용)
const downTrend = () => [c(100, 101, 99, 100), c(99, 100, 96, 97), c(97, 98, 94, 95), c(95, 96, 92, 93), c(93, 94, 90, 91)]
const upTrend = () => [c(90, 92, 89, 91), c(91, 94, 90, 93), c(93, 96, 92, 95), c(95, 98, 94, 97), c(97, 100, 96, 99)]

describe('detectCandlePatterns', () => {
  it('망치형: 하락추세 + 긴 아래꼬리 → bullish', () => {
    const ohlcv = [...downTrend(), c(91, 91.5, 85, 91)] // 아래꼬리 6, 몸통 0, 위꼬리 0.5
    const r = detectCandlePatterns(ohlcv)
    expect(r.bullish).toContain('망치형')
  })

  it('상승장악형: 직전 음봉을 현재 양봉이 감쌈 → bullish', () => {
    const ohlcv = [...downTrend(), c(92, 92.5, 88, 89), c(88, 95, 87.5, 94)] // 음봉 후 큰 양봉
    const r = detectCandlePatterns(ohlcv)
    expect(r.bullish).toContain('상승장악형')
  })

  it('하락장악형: 직전 양봉을 현재 음봉이 감쌈 → bearish', () => {
    const ohlcv = [...upTrend(), c(98, 99, 97.5, 99), c(99.5, 100, 96, 96.5)]
    const r = detectCandlePatterns(ohlcv)
    expect(r.bearish).toContain('하락장악형')
  })

  it('도지: 몸통이 매우 작음 → neutral', () => {
    const ohlcv = [...downTrend(), c(91, 94, 88, 91.05)] // 몸통 0.05, 범위 6
    const r = detectCandlePatterns(ohlcv)
    expect(r.neutral).toContain('도지')
  })

  it('데이터 부족 시 빈 결과', () => {
    const r = detectCandlePatterns([c(1, 1, 1, 1)])
    expect(r).toEqual({ bullish: [], bearish: [], neutral: [] })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/candle-patterns.test.mjs`
Expected: FAIL — `Failed to resolve import '../lib/candle-patterns.mjs'`

- [ ] **Step 3: lib/candle-patterns.mjs 구현**

```javascript
// 일본식 캔들스틱 패턴 감지 (순수 함수). ohlcv: 과거→최신.
// 각 봉 { open?, high, low, close }. open 없으면 직전 종가를 open으로 간주.

function normalize(ohlcv) {
  return ohlcv.map((c, i) => {
    const open = c.open != null ? c.open : (i > 0 ? ohlcv[i - 1].close : c.close)
    return { open, high: c.high, low: c.low, close: c.close }
  })
}

function body(c) { return Math.abs(c.close - c.open) }
function range(c) { return c.high - c.low }
function upperWick(c) { return c.high - Math.max(c.open, c.close) }
function lowerWick(c) { return Math.min(c.open, c.close) - c.low }
function isBull(c) { return c.close > c.open }
function isBear(c) { return c.close < c.open }

// 직전 n봉의 추세 방향: 종가 기울기 부호
function trend(cs, n) {
  if (cs.length < n + 1) return 0
  const seg = cs.slice(-(n + 1), -1) // 현재봉 제외 직전 n봉
  return seg.at(-1).close - seg[0].close
}

export function detectCandlePatterns(ohlcv) {
  const bullish = [], bearish = [], neutral = []
  if (!Array.isArray(ohlcv) || ohlcv.length < 2) return { bullish, bearish, neutral }
  const cs = normalize(ohlcv)
  const last = cs.at(-1), prev = cs.at(-2)
  const before = trend(cs, 5) // 현재봉 직전 5봉 추세
  const b = body(last), r = range(last) || 1e-9

  // 도지 / 팽이형 (중립)
  if (b <= r * 0.1) neutral.push('도지')
  else if (b <= r * 0.3 && upperWick(last) > b && lowerWick(last) > b) neutral.push('팽이형')

  // 망치형 / 교수형 (긴 아래꼬리, 작은 위꼬리)
  if (lowerWick(last) >= b * 2 && upperWick(last) <= b * 0.5 && b > 0) {
    if (before < 0) bullish.push('망치형')
    else if (before > 0) bearish.push('교수형')
  }
  // 역망치 / 유성형 (긴 위꼬리, 작은 아래꼬리)
  if (upperWick(last) >= b * 2 && lowerWick(last) <= b * 0.5 && b > 0) {
    if (before < 0) bullish.push('역망치')
    else if (before > 0) bearish.push('유성형')
  }
  // 상승/하락 장악형
  if (isBull(last) && isBear(prev) && last.close >= prev.open && last.open <= prev.close)
    bullish.push('상승장악형')
  if (isBear(last) && isBull(prev) && last.open >= prev.close && last.close <= prev.open)
    bearish.push('하락장악형')
  // 관통형 / 흑운형
  const prevMid = (prev.open + prev.close) / 2
  if (isBear(prev) && isBull(last) && last.open < prev.close && last.close > prevMid && last.close < prev.open)
    bullish.push('관통형')
  if (isBull(prev) && isBear(last) && last.open > prev.close && last.close < prevMid && last.close > prev.open)
    bearish.push('흑운형')
  // 샛별 / 석별 (3봉)
  if (cs.length >= 3) {
    const a = cs.at(-3)
    if (isBear(a) && body(prev) <= body(a) * 0.5 && isBull(last) && last.close > (a.open + a.close) / 2)
      bullish.push('샛별')
    if (isBull(a) && body(prev) <= body(a) * 0.5 && isBear(last) && last.close < (a.open + a.close) / 2)
      bearish.push('석별')
  }

  return { bullish, bearish, neutral }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/candle-patterns.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/candle-patterns.mjs __tests__/candle-patterns.test.mjs
git commit -m "feat: add candlestick pattern detection"
```

---

## Task 2: 캔들 패턴을 스캔 점수에 반영 (lib/upbit.mjs + lib/signals.mjs)

**Files:**
- Modify: `lib/upbit.mjs` (candlesToOhlcv에 open 추가)
- Modify: `lib/signals.mjs` (PATTERN_SCORE/SIGNAL_KEYS + detectSignals 통합)
- Test: `__tests__/signals.test.mjs` (캔들 패턴 점수 반영 케이스)

`candlesToOhlcv`는 현재 open을 포함하지 않는다. 캔들 패턴 감지에 open이 필요하므로
업비트 캔들의 `opening_price`를 추가한다.

- [ ] **Step 1: candlesToOhlcv에 open 추가**

`lib/upbit.mjs`의 candlesToOhlcv를 아래로 교체:
```javascript
export function candlesToOhlcv(candles) {
  return [...candles].reverse().map((c) => ({
    open: c.opening_price,
    close: c.trade_price,
    high: c.high_price,
    low: c.low_price,
    volume: c.candle_acc_trade_volume,
  }))
}
```

- [ ] **Step 2: 실패하는 테스트 작성 (signals에 캔들패턴 통합)**

`__tests__/signals.test.mjs`의 `describe('detectSignals'...)` 안에 추가:
```javascript
  it('강세 캔들패턴(망치형)이 있으면 매수 신호/점수에 반영', () => {
    // 하락 후 망치형 → detectSignals가 캔들패턴을 매수 신호로 포함
    const base = Array.from({ length: 59 }, (_, i) => {
      const close = 200 - i // 하락추세
      return { open: close + 1, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const hammer = { open: 141, high: 141.5, low: 135, close: 141, volume: 10 }
    const r = detectSignals([...base, hammer], {})
    expect(r.buy.some((s) => s.startsWith('캔들'))).toBe(true)
  })
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run __tests__/signals.test.mjs`
Expected: FAIL — 캔들 신호 없음

- [ ] **Step 4: signals.mjs에 캔들 패턴 통합**

`lib/signals.mjs` 상단 import에 추가:
```javascript
import { detectCandlePatterns } from './candle-patterns.mjs'
```

`SIGNAL_KEYS` 배열 끝(`'박스권 돌파 패턴',` 다음)에 추가:
```javascript
  '캔들 강세형', '캔들 약세형',
```

`detectSignals` 함수의 `// 매도: 데드크로스 ...` 블록 **바로 위**에 삽입:
```javascript
  // 캔들스틱 패턴 (강세=매수+2, 약세=매도+2). 라벨에 패턴명 부기.
  const cp = detectCandlePatterns(ohlcv)
  if (cp.bullish.length) addBuy(`캔들 강세형 (${cp.bullish.join(',')})`, 2)
  if (cp.bearish.length) addSell(`캔들 약세형 (${cp.bearish.join(',')})`, 2)
```

- [ ] **Step 5: 테스트 통과 확인 (전체)**

Run: `npx vitest run`
Expected: PASS (기존 + 신규 모두 통과)

- [ ] **Step 6: signal-weights.json에 캔들 가중치 추가**

`data/signal-weights.json`의 `"박스권 돌파 패턴": 1.1` 다음에 추가(쉼표 주의):
```json
  "박스권 돌파 패턴": 1.1,
  "캔들 강세형": 1.0,
  "캔들 약세형": 1.0
```

- [ ] **Step 7: Commit**

```bash
git add lib/upbit.mjs lib/signals.mjs data/signal-weights.json __tests__/signals.test.mjs
git commit -m "feat: integrate candlestick patterns into scan scoring"
```

---

## Task 3: 분석 코어 추출 (lib/analyze.mjs)

**Files:**
- Create: `lib/analyze.mjs`
- Test: `__tests__/analyze.test.mjs`

개별 분석 로직(지표 묶음 + 신호 + 캔들패턴)을 순수 함수로 추출해 API가 사용한다.
(기존 `scripts/analyze.mjs` CLI는 그대로 두며, 이번 범위에서 리팩터링하지 않는다.)

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/analyze.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { analyzeMarket } from '../lib/analyze.mjs'

describe('analyzeMarket', () => {
  it('지표/신호/캔들패턴/점수를 담은 객체 반환', () => {
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 100 + i
      return { open: close - 0.5, close, high: close + 1, low: close - 1, volume: 10 }
    })
    const r = analyzeMarket(ohlcv, { weights: {} })
    expect(r).toHaveProperty('indicators')
    expect(r.indicators).toHaveProperty('rsi')
    expect(r).toHaveProperty('buy')
    expect(r).toHaveProperty('sell')
    expect(r).toHaveProperty('candlePatterns')
    expect(typeof r.buyScore).toBe('number')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/analyze.test.mjs`
Expected: FAIL — import 실패

- [ ] **Step 3: lib/analyze.mjs 구현**

```javascript
import {
  calcRSI, calcBB, calcMACD, calcStochastic, calcWilliamsR, calcVolRatio, calcEMA,
} from './indicators.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from './signals.mjs'
import { detectCandlePatterns } from './candle-patterns.mjs'

// ohlcv: 과거→최신 [{open,high,low,close,volume}]
export function analyzeMarket(ohlcv, { weights = {} } = {}) {
  const closes = ohlcv.map((c) => c.close)
  const highs = ohlcv.map((c) => c.high)
  const lows = ohlcv.map((c) => c.low)
  const volumes = ohlcv.map((c) => c.volume)
  const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50)

  const indicators = {
    price: closes.at(-1),
    rsi: calcRSI(closes),
    bb: calcBB(closes),
    macd: calcMACD(closes),
    stoch: calcStochastic(highs, lows, closes),
    wr: calcWilliamsR(highs, lows, closes),
    volRatio: calcVolRatio(volumes),
    ema20: ema20.at(-1),
    ema50: ema50.at(-1),
    recentCloses: closes.slice(-7),
  }

  const sig = detectSignals(ohlcv, weights)
  const pat = detectPatterns(ohlcv)
  let buyScore = sig.buyScore
  for (const p of pat.buy) buyScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1)
  let sellScore = sig.sellScore
  for (const p of pat.sell) sellScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1)
  const combo = applyCombos([...sig.buy, ...pat.buy], [...sig.sell, ...pat.sell], buyScore)

  return {
    indicators,
    buy: combo.buy,
    sell: [...sig.sell, ...pat.sell],
    candlePatterns: detectCandlePatterns(ohlcv),
    buyScore: combo.buyScore,
    sellScore,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/analyze.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/analyze.mjs __tests__/analyze.test.mjs
git commit -m "feat: extract analyzeMarket core for CLI/API reuse"
```

---

## Task 4: 인사이트/검증 집계 코어 (lib/insights.mjs)

**Files:**
- Create: `lib/insights.mjs`
- Test: `__tests__/insights.test.mjs`

대시보드 인사이트(오늘 최다 신호 / 적중률 1위)와 검증 데이터를 만드는 순수 함수.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/insights.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { topSignalsOfScan, bestHitRateSignal } from '../lib/insights.mjs'

describe('topSignalsOfScan', () => {
  it('스캔의 매수/매도 신호 라벨 빈도 집계 (콤보/태그 제외)', () => {
    const scan = {
      buy: [
        { signals: ['Stoch 과매도 골든크로스 (5)', '[콤보] 반등확인 보너스'] },
        { signals: ['Stoch 과매도 골든크로스 (7)', 'BB 하단 지지'] },
      ],
      sell: [{ signals: ['MACD 하락'] }],
    }
    const r = topSignalsOfScan(scan)
    expect(r[0]).toEqual({ key: 'Stoch 과매도 골든크로스', count: 2 })
  })
})

describe('bestHitRateSignal', () => {
  it('MIN_SAMPLES 이상 중 최고 적중률 신호', () => {
    const stats = {
      'RSI 과매도': { count: 5, hitRate: 0.2 },
      'Stoch 과매수 데드크로스': { count: 4, hitRate: 0.76 },
      'BB 상단 돌파': { count: 2, hitRate: 0.9 }, // 샘플 부족 제외
    }
    expect(bestHitRateSignal(stats)).toEqual({ key: 'Stoch 과매수 데드크로스', count: 4, hitRate: 0.76 })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/insights.test.mjs`
Expected: FAIL — import 실패

- [ ] **Step 3: lib/insights.mjs 구현**

```javascript
import { keyOf } from './signals.mjs'

// 한 스캔 내 신호 라벨 빈도 (콤보/익절/MTF 태그 제외), 빈도순 정렬
export function topSignalsOfScan(scan) {
  const counts = {}
  for (const side of ['buy', 'sell']) {
    for (const item of scan[side] ?? []) {
      for (const label of item.signals ?? []) {
        const key = keyOf(label)
        if (!key) continue
        counts[key] = (counts[key] || 0) + 1
      }
    }
  }
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

// 최소 표본(기본 3) 이상 신호 중 적중률 최고
export function bestHitRateSignal(stats, minSamples = 3) {
  let best = null
  for (const [key, { count, hitRate }] of Object.entries(stats)) {
    if (count < minSamples) continue
    if (!best || hitRate > best.hitRate) best = { key, count, hitRate }
  }
  return best
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/insights.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/insights.mjs __tests__/insights.test.mjs
git commit -m "feat: add insights aggregation helpers"
```

---

## Task 5: 비동기 스캔 작업 관리 (server/scan-job.mjs)

**Files:**
- Create: `server/scan-job.mjs`
- Test: `__tests__/scan-job.test.mjs`

`monitor.mjs`를 자식 프로세스로 돌리고 진행 상태를 메모리에서 관리. spawn은 주입 가능하게 해 테스트한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/scan-job.test.mjs`:
```javascript
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createScanRunner } from '../server/scan-job.mjs'

function fakeSpawn() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return { child, spawn: vi.fn(() => child) }
}

describe('createScanRunner', () => {
  it('시작하면 running, 종료코드 0이면 done', async () => {
    const { child, spawn } = fakeSpawn()
    const runner = createScanRunner({ spawn })
    const { jobId } = runner.start()
    expect(runner.get(jobId).status).toBe('running')
    child.stdout.emit('data', Buffer.from('스캔 대상 247종목 (전체 260)\n'))
    expect(runner.get(jobId).progress).toBeGreaterThanOrEqual(0)
    child.emit('close', 0)
    expect(runner.get(jobId).status).toBe('done')
  })

  it('이미 running이면 같은 jobId 반환', () => {
    const { spawn } = fakeSpawn()
    const runner = createScanRunner({ spawn })
    const a = runner.start()
    const b = runner.start()
    expect(a.jobId).toBe(b.jobId)
  })

  it('종료코드 1이면 error', () => {
    const { child, spawn } = fakeSpawn()
    const runner = createScanRunner({ spawn })
    const { jobId } = runner.start()
    child.emit('close', 1)
    expect(runner.get(jobId).status).toBe('error')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/scan-job.test.mjs`
Expected: FAIL — import 실패

- [ ] **Step 3: server/scan-job.mjs 구현**

```javascript
import { spawn as nodeSpawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MONITOR = join(ROOT, 'scripts', 'monitor.mjs')

// spawn 주입 가능(테스트용). 동시 1개 실행 제한.
export function createScanRunner({ spawn = nodeSpawn } = {}) {
  const jobs = new Map()
  let activeId = null

  function start() {
    if (activeId && jobs.get(activeId)?.status === 'running') {
      return { jobId: activeId }
    }
    const jobId = `scan-${Date.now()}`
    const job = { status: 'running', progress: 0, startedAt: Date.now(), finishedAt: null, message: '' }
    jobs.set(jobId, job)
    activeId = jobId

    const child = spawn(process.execPath, [MONITOR], { cwd: ROOT })
    child.stdout.on('data', (d) => {
      const text = d.toString()
      if (/스캔 대상/.test(text)) job.progress = 10
      if (/완료/.test(text)) { job.progress = 100; job.message = text.trim() }
    })
    child.stderr.on('data', (d) => { job.message = d.toString().trim() })
    child.on('close', (code) => {
      job.finishedAt = Date.now()
      job.status = code === 0 ? 'done' : 'error'
      if (code === 0 && job.progress < 100) job.progress = 100
    })
    return { jobId }
  }

  function get(jobId) {
    return jobs.get(jobId) || null
  }

  return { start, get }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/scan-job.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/scan-job.mjs __tests__/scan-job.test.mjs
git commit -m "feat: add async scan job runner"
```

---

## Task 6: API 핸들러 (server/api.mjs)

**Files:**
- Create: `server/api.mjs`
- Test: `__tests__/api.test.mjs`

순수 데이터 변환 핸들러. 파일 IO는 store.mjs 통해서. 네트워크(개별분석 캔들 조회)는
upbit.mjs 함수를 주입받아 테스트 가능하게 한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/api.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { buildResults, buildInsights, buildVerify } from '../server/api.mjs'

const log = {
  totalScans: 5,
  scans: [{
    timestamp: '2026-06-12T00:00:00Z',
    buy: [{ market: 'KRW-A', korean_name: '에이', price: 10, score: 7, signals: ['Stoch 과매도 골든크로스 (5)'] }],
    sell: [{ market: 'KRW-B', korean_name: '비', price: 20, score: 4, signals: ['MACD 하락'] }],
  }],
}

describe('buildResults', () => {
  it('최신 스캔의 매수/매도 + KPI', () => {
    const r = buildResults(log)
    expect(r.kpi.buyCount).toBe(1)
    expect(r.kpi.sellCount).toBe(1)
    expect(r.kpi.totalScans).toBe(5)
    expect(r.buy[0].market).toBe('KRW-A')
  })
  it('스캔 없으면 empty', () => {
    expect(buildResults({ scans: [] }).empty).toBe(true)
  })
})

describe('buildInsights', () => {
  it('최다 신호와 적중률 1위', () => {
    const weekly = { weeks: [{ signalStats: { 'Stoch 과매도 골든크로스': { count: 4, hitRate: 0.7 } } }] }
    const r = buildInsights(log, weekly)
    expect(r.topSignal.key).toBe('Stoch 과매도 골든크로스')
    expect(r.bestHitRate.key).toBe('Stoch 과매도 골든크로스')
  })
})

describe('buildVerify', () => {
  it('최신 주간 분석의 적중률/시간별/가중치 결합', () => {
    const weekly = { weeks: [{ overallHitRate: 0.4, timedHitRates: { '+1일': { hitRate: 0.5 } }, signalStats: { X: { count: 3, hitRate: 0.6 } } }] }
    const weights = { X: 1.2 }
    const r = buildVerify(weekly, weights)
    expect(r.overallHitRate).toBe(0.4)
    expect(r.timedHitRates['+1일'].hitRate).toBe(0.5)
    expect(r.weights.X).toBe(1.2)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: FAIL — import 실패

- [ ] **Step 3: server/api.mjs 구현**

```javascript
import { topSignalsOfScan, bestHitRateSignal } from '../lib/insights.mjs'

export function buildResults(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { buyCount: 0, sellCount: 0, totalScans: log?.totalScans || 0 }, buy: [], sell: [] }
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { buyCount: scan.buy.length, sellCount: scan.sell.length, totalScans: log.totalScans || 0 },
    buy: scan.buy,
    sell: scan.sell,
  }
}

export function buildInsights(log, weekly) {
  const scan = log?.scans?.at(-1)
  const topSignal = scan ? (topSignalsOfScan(scan)[0] || null) : null
  const stats = weekly?.weeks?.at(-1)?.signalStats || {}
  return { topSignal, bestHitRate: bestHitRateSignal(stats) }
}

export function buildVerify(weekly, weights) {
  const latest = weekly?.weeks?.at(-1) || {}
  return {
    overallHitRate: latest.overallHitRate ?? null,
    timedHitRates: latest.timedHitRates ?? null,
    signalStats: latest.signalStats ?? {},
    weights: weights || {},
    history: (weekly?.weeks || []).map((w) => ({ timestamp: w.timestamp, overallHitRate: w.overallHitRate })),
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/api.mjs __tests__/api.test.mjs
git commit -m "feat: add API data builders"
```

---

## Task 7: HTTP 서버 (server/server.mjs)

**Files:**
- Create: `server/server.mjs`
- Modify: `package.json` (dashboard 스크립트)

라우팅 + 정적 서빙 + API 결선. 실제 네트워크라 실행으로 검증.

- [ ] **Step 1: server/server.mjs 구현**

```javascript
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson } from '../lib/store.mjs'
import { getDayCandles, getMinuteCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { analyzeMarket } from '../lib/analyze.mjs'
import { buildResults, buildInsights, buildVerify } from './api.mjs'
import { createScanRunner } from './scan-job.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const PORT = process.env.DASHBOARD_PORT || 8787
const runner = createScanRunner()

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath
  const file = join(PUBLIC, rel)
  if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); res.end('Not found'); return }
  const data = await readFile(file)
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(data)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const p = url.pathname

    if (p === '/api/results') {
      return sendJson(res, 200, buildResults(await readJson('monitor-log.json', { scans: [] })))
    }
    if (p === '/api/insights') {
      const [log, weekly] = await Promise.all([
        readJson('monitor-log.json', { scans: [] }),
        readJson('weekly-analysis.json', { weeks: [] }),
      ])
      return sendJson(res, 200, buildInsights(log, weekly))
    }
    if (p === '/api/verify') {
      const [weekly, weights] = await Promise.all([
        readJson('weekly-analysis.json', { weeks: [] }),
        readJson('signal-weights.json', {}),
      ])
      return sendJson(res, 200, buildVerify(weekly, weights))
    }
    if (p === '/api/weights') {
      return sendJson(res, 200, await readJson('signal-weights.json', {}))
    }
    if (p === '/api/analyze') {
      const market = url.searchParams.get('market')
      const tf = url.searchParams.get('tf') || 'day'
      if (!market || !/^KRW-[A-Z0-9]+$/.test(market)) return sendJson(res, 400, { error: 'invalid market' })
      const candles = tf === 'day' ? await getDayCandles(market, 200)
        : await getMinuteCandles(market, tf === '4h' ? 240 : 60, 200)
      if (!candles || candles.length < 30) return sendJson(res, 400, { error: 'no data' })
      const ohlcv = candlesToOhlcv(candles)
      const weights = await readJson('signal-weights.json', {})
      const result = analyzeMarket(ohlcv, { weights })
      return sendJson(res, 200, { market, tf, ohlcv, ...result })
    }
    if (p === '/api/scan' && req.method === 'POST') {
      return sendJson(res, 200, runner.start())
    }
    if (p.startsWith('/api/scan/')) {
      const job = runner.get(p.slice('/api/scan/'.length))
      return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'no job' })
    }
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })

    await serveStatic(res, p)
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`대시보드: http://127.0.0.1:${PORT}`)
})
```

- [ ] **Step 2: package.json에 dashboard 스크립트 추가**

`scripts` 객체에 추가:
```json
    "dashboard": "node server/server.mjs",
```

- [ ] **Step 3: 정적 디렉토리 임시 확인용 placeholder 생성**

(Task 8에서 실제 구현. 서버 기동만 먼저 검증)
Run: `node -e "import('node:fs').then(fs=>fs.mkdirSync('public',{recursive:true}))"`
그리고 `public/index.html`에 임시로 `<h1>ok</h1>` 작성.

- [ ] **Step 4: 서버 기동 + API 스모크 테스트**

서버 백그라운드 실행 후:
```bash
node server/server.mjs &
```
검증:
```bash
curl -s http://127.0.0.1:8787/api/results
curl -s http://127.0.0.1:8787/api/verify
curl -s "http://127.0.0.1:8787/api/analyze?market=KRW-BTC&tf=day" | head -c 200
```
Expected: 각각 JSON 응답(results는 최신 스캔, analyze는 indicators/candlePatterns 포함). 확인 후 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add server/server.mjs package.json public/index.html
git commit -m "feat: add zero-dep http dashboard server"
```

---

## Task 8: 프론트엔드 셸 + 대시보드 탭 (public/)

**Files:**
- Create: `public/index.html`, `public/styles.css`, `public/app.js`
- Create: `public/charts.js`

탭 셸(사이드바 + 해시 라우팅)과 대시보드 탭(KPI/TOP5/인사이트/스캔버튼)을 구현.

- [ ] **Step 1: public/index.html 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>업비트 스캐너</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
  <aside class="sidebar">
    <h1>🪙 스캐너</h1>
    <nav>
      <a href="#/dashboard" data-tab="dashboard">📊 대시보드</a>
      <a href="#/recommend" data-tab="recommend">🟢 추천</a>
      <a href="#/analyze" data-tab="analyze">🔍 개별분석</a>
      <a href="#/verify" data-tab="verify">✅ 신호검증</a>
    </nav>
  </aside>
  <main id="view"></main>
  <script src="/charts.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: public/styles.css 작성 (다크 테마)**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { display: flex; font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; }
.sidebar { width: 160px; background: #161b22; padding: 16px 10px; position: sticky; top: 0; height: 100vh; }
.sidebar h1 { font-size: 18px; margin-bottom: 20px; }
.sidebar nav { display: flex; flex-direction: column; gap: 4px; }
.sidebar a { color: #adbac7; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 14px; }
.sidebar a:hover, .sidebar a.active { background: #21262d; color: #fff; }
main { flex: 1; padding: 24px; overflow-x: hidden; }
h2 { margin-bottom: 16px; }
.kpis { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.kpi { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 18px; flex: 1; min-width: 110px; }
.kpi .label { font-size: 12px; color: #8b949e; }
.kpi .val { font-size: 24px; font-weight: 700; margin-top: 4px; }
.panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.panel h3 { font-size: 14px; margin-bottom: 10px; color: #8b949e; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #21262d; }
th { color: #8b949e; font-weight: 600; }
tr.clickable:hover { background: #1c2128; cursor: pointer; }
.tag { display: inline-block; background: #1f6feb33; color: #58a6ff; border-radius: 4px; padding: 1px 6px; font-size: 11px; margin-right: 3px; }
.tag.warn { background: #f8514933; color: #ff7b72; }
.tag.good { background: #2ea04333; color: #3fb950; }
button { background: #238636; color: #fff; border: none; border-radius: 6px; padding: 8px 14px; cursor: pointer; font-size: 13px; }
button:hover { background: #2ea043; }
button:disabled { opacity: .5; cursor: default; }
input { background: #0d1117; border: 1px solid #30363d; color: #e6edf3; border-radius: 6px; padding: 8px; }
.bar { background: #21262d; border-radius: 4px; height: 8px; overflow: hidden; }
.bar > div { background: #3fb950; height: 100%; }
.controls { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.controls .seg { cursor: pointer; padding: 4px 10px; border: 1px solid #30363d; border-radius: 6px; font-size: 12px; }
.controls .seg.active { background: #21262d; color: #fff; }
.muted { color: #8b949e; font-size: 12px; }
#chart { height: 300px; }
</style>
```
(주의: `.css` 파일이므로 `<style>` 태그 없이 위 CSS 본문만 저장. 마지막 `</style>` 줄은 넣지 말 것.)

- [ ] **Step 3: public/charts.js 작성**

```javascript
// lightweight-charts 래퍼. 전역 LightweightCharts 사용.
window.Charts = {
  candle(el, ohlcv, { volume = true } = {}) {
    el.innerHTML = ''
    if (!window.LightweightCharts) { el.textContent = '차트 로드 실패 (오프라인)'; return }
    const chart = LightweightCharts.createChart(el, {
      layout: { background: { color: '#161b22' }, textColor: '#adbac7' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      width: el.clientWidth, height: 300,
    })
    const s = chart.addCandlestickSeries()
    const base = Date.now() - ohlcv.length * 86400000
    s.setData(ohlcv.map((c, i) => ({
      time: Math.floor((base + i * 86400000) / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    if (volume) {
      const v = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } })
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      v.setData(ohlcv.map((c, i) => ({ time: Math.floor((base + i * 86400000) / 1000), value: c.volume, color: '#30363d' })))
    }
    chart.timeScale().fitContent()
  },
  line(el, closes) {
    el.innerHTML = ''
    if (!window.LightweightCharts) { el.textContent = '차트 로드 실패'; return }
    const chart = LightweightCharts.createChart(el, {
      layout: { background: { color: '#161b22' }, textColor: '#adbac7' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      width: el.clientWidth, height: 300,
    })
    const s = chart.addLineSeries({ color: '#58a6ff' })
    const base = Date.now() - closes.length * 86400000
    s.setData(closes.map((v, i) => ({ time: Math.floor((base + i * 86400000) / 1000), value: v })))
    chart.timeScale().fitContent()
  },
}
```

- [ ] **Step 4: public/app.js — 셸 + 대시보드 탭**

```javascript
const view = document.getElementById('view')
const $ = (sel, el = document) => el.querySelector(sel)
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'))

async function api(path, opts) {
  const r = await fetch(path, opts)
  return r.json()
}

function setActiveTab(tab) {
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab))
}

function signalTags(signals) {
  return signals.map((s) => {
    if (s.includes('골든크로스')) return '<span class="tag good">GC</span>'
    if (s.includes('[MTF]')) return '<span class="tag">MTF</span>'
    if (s.includes('함정')) return '<span class="tag warn">함정</span>'
    if (s.includes('데드크로스')) return '<span class="tag warn">DC</span>'
    return ''
  }).join('') || ''
}

const routes = {
  async dashboard() {
    setActiveTab('dashboard')
    view.innerHTML = '<h2>대시보드</h2><p class="muted">불러오는 중…</p>'
    const [res, ins] = await Promise.all([api('/api/results'), api('/api/insights')])
    const kpi = res.kpi || {}
    view.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>대시보드</h2>
        <button id="scanBtn">🔄 수동 스캔</button>
      </div>
      <p class="muted">마지막 스캔: ${res.timestamp ? new Date(res.timestamp).toLocaleString('ko-KR') : '없음'}</p>
      <div id="scanProgress"></div>
      <div class="kpis">
        <div class="kpi"><div class="label">매수</div><div class="val">${kpi.buyCount ?? 0}</div></div>
        <div class="kpi"><div class="label">매도</div><div class="val">${kpi.sellCount ?? 0}</div></div>
        <div class="kpi"><div class="label">누적 스캔</div><div class="val">${kpi.totalScans ?? 0}</div></div>
        <div class="kpi"><div class="label">최다 신호</div><div class="val" style="font-size:15px">${ins.topSignal?.key ?? '-'}</div></div>
        <div class="kpi"><div class="label">적중률 1위</div><div class="val" style="font-size:15px">${ins.bestHitRate ? ins.bestHitRate.key + ' ' + Math.round(ins.bestHitRate.hitRate * 100) + '%' : '-'}</div></div>
      </div>
      <div class="panel"><h3>🟢 매수 TOP 5</h3>${topTable(res.buy)}</div>
      <div class="panel"><h3>🔴 매도 TOP 5</h3>${topTable(res.sell)}</div>`
    $('#scanBtn').onclick = runScan
  },
}

function topTable(list = []) {
  if (!list.length) return '<p class="muted">없음</p>'
  return `<table><tbody>${list.slice(0, 5).map((x) => `
    <tr class="clickable" onclick="location.hash='#/analyze?market=${x.market}'">
      <td>${x.korean_name}</td><td>${x.market.replace('KRW-', '')}</td>
      <td>${x.score}</td><td>${signalTags(x.signals)}</td>
    </tr>`).join('')}</tbody></table>`
}

async function runScan() {
  const btn = $('#scanBtn'); const prog = $('#scanProgress')
  btn.disabled = true
  const { jobId } = await api('/api/scan', { method: 'POST' })
  prog.innerHTML = '<div class="bar"><div style="width:5%"></div></div><p class="muted">스캔 중…</p>'
  const timer = setInterval(async () => {
    const job = await api('/api/scan/' + jobId)
    $('.bar > div', prog).style.width = (job.progress || 0) + '%'
    if (job.status === 'done') { clearInterval(timer); btn.disabled = false; routes.dashboard() }
    if (job.status === 'error') { clearInterval(timer); btn.disabled = false; prog.innerHTML = '<p class="muted">스캔 실패</p>' }
  }, 1500)
}

function router() {
  const hash = location.hash || '#/dashboard'
  const name = hash.slice(2).split('?')[0]
  ;(routes[name] || routes.dashboard)()
}
window.addEventListener('hashchange', router)
window.addEventListener('DOMContentLoaded', router)
```

- [ ] **Step 5: 서버 실행 + 브라우저 확인**

```bash
node server/server.mjs &
```
브라우저 `http://127.0.0.1:8787` → 대시보드 탭에 KPI/TOP5/인사이트 표시, [수동 스캔] 클릭 시 진행률 바 동작 확인. 확인 후 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add public/
git commit -m "feat: add dashboard shell and overview tab"
```

---

## Task 9: 추천 탭 + 개별분석 탭 (public/app.js 확장)

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: 추천 탭 라우트 추가**

`routes` 객체에 추가:
```javascript
  async recommend() {
    setActiveTab('recommend')
    view.innerHTML = '<h2>추천</h2><p class="muted">불러오는 중…</p>'
    const res = await api('/api/results')
    let side = 'buy'
    const render = (q = '') => {
      const list = (res[side] || []).filter((x) => !q || x.korean_name.includes(q) || x.market.includes(q.toUpperCase()))
      $('#recBody').innerHTML = `<table>
        <thead><tr><th>종목</th><th>마켓</th><th>점수</th><th>현재가</th><th>신호</th></tr></thead>
        <tbody>${list.map((x) => `<tr class="clickable" onclick="location.hash='#/analyze?market=${x.market}'">
          <td>${x.korean_name}</td><td>${x.market.replace('KRW-', '')}</td><td>${x.score}</td>
          <td>${fmt(x.price)}</td><td>${signalTags(x.signals)} <span class="muted">${x.signals.length}개</span></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">없음</td></tr>'}</tbody></table>`
    }
    view.innerHTML = `<h2>추천</h2>
      <div class="controls">
        <span class="seg active" id="segBuy">매수</span>
        <span class="seg" id="segSell">매도</span>
        <input id="recSearch" placeholder="🔎 종목 검색" style="flex:1">
      </div>
      <div class="panel" id="recBody"></div>`
    const sw = (s) => { side = s; $('#segBuy').classList.toggle('active', s === 'buy'); $('#segSell').classList.toggle('active', s === 'sell'); render($('#recSearch').value) }
    $('#segBuy').onclick = () => sw('buy')
    $('#segSell').onclick = () => sw('sell')
    $('#recSearch').oninput = (e) => render(e.target.value)
    render()
  },
```

- [ ] **Step 2: 개별분석 탭 라우트 추가**

`routes` 객체에 추가:
```javascript
  async analyze() {
    setActiveTab('analyze')
    const market = new URLSearchParams((location.hash.split('?')[1] || '')).get('market') || ''
    view.innerHTML = `<h2>개별 분석</h2>
      <div class="controls">
        <input id="mkt" placeholder="KRW-BTC" value="${market}" style="width:160px">
        <button id="goBtn">분석</button>
        <span class="seg active" data-tf="day">일봉</span>
        <span class="seg" data-tf="4h">4시간</span>
        <span class="seg" data-tf="1h">1시간</span>
        <span class="seg active" data-ct="candle">캔들</span>
        <span class="seg" data-ct="line">라인</span>
      </div>
      <div class="panel"><div id="chart"></div></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div class="panel" style="flex:1;min-width:260px"><h3>지표</h3><div id="ind" class="muted">종목을 입력하세요</div></div>
        <div class="panel" style="flex:1;min-width:260px"><h3>🕯️ 캔들 모양분석</h3><div id="cp" class="muted">-</div></div>
      </div>
      <div class="panel"><h3>종합 신호</h3><div id="sig" class="muted">-</div></div>`
    let tf = 'day', ct = 'candle', cache = null
    const draw = () => {
      if (!cache) return
      if (ct === 'candle') Charts.candle($('#chart'), cache.ohlcv)
      else Charts.line($('#chart'), cache.ohlcv.map((c) => c.close))
    }
    const load = async () => {
      const mkt = $('#mkt').value.trim().toUpperCase()
      if (!/^KRW-[A-Z0-9]+$/.test(mkt)) { $('#ind').textContent = '잘못된 마켓 코드'; return }
      $('#ind').textContent = '불러오는 중…'
      const r = await api(`/api/analyze?market=${mkt}&tf=${tf}`)
      if (r.error) { $('#ind').textContent = '조회 실패: ' + r.error; return }
      cache = r; draw()
      const ind = r.indicators
      $('#ind').innerHTML = `현재가 <b>${fmt(ind.price)}</b><br>
        RSI ${ind.rsi?.toFixed(1) ?? '-'} · Stoch K ${ind.stoch?.k.toFixed(1) ?? '-'} D ${ind.stoch?.d.toFixed(1) ?? '-'}<br>
        MACD hist ${ind.macd?.hist.toFixed(2) ?? '-'} · WR ${ind.wr?.toFixed(1) ?? '-'}<br>
        EMA20 ${fmt(ind.ema20?.toFixed(2))} / EMA50 ${fmt(ind.ema50?.toFixed(2))} · Vol ${ind.volRatio?.toFixed(2) ?? '-'}x`
      const cp = r.candlePatterns
      $('#cp').innerHTML = [
        ...cp.bullish.map((p) => `<div class="tag good">▲ ${p}</div>`),
        ...cp.bearish.map((p) => `<div class="tag warn">▼ ${p}</div>`),
        ...cp.neutral.map((p) => `<div class="tag">· ${p}</div>`),
      ].join(' ') || '<span class="muted">감지된 패턴 없음</span>'
      $('#sig').innerHTML = `매수: ${r.buy.join(', ') || '없음'} <b>(${r.buyScore.toFixed(1)})</b><br>매도: ${r.sell.join(', ') || '없음'} <b>(${r.sellScore.toFixed(1)})</b>`
    }
    view.querySelectorAll('[data-tf]').forEach((el) => el.onclick = () => {
      tf = el.dataset.tf; view.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('active', x === el)); load()
    })
    view.querySelectorAll('[data-ct]').forEach((el) => el.onclick = () => {
      ct = el.dataset.ct; view.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('active', x === el)); draw()
    })
    $('#goBtn').onclick = load
    if (market) load()
  },
```

- [ ] **Step 2b: 라우터가 쿼리스트링 포함 해시도 처리하도록 확인**

`router()`는 이미 `hash.slice(2).split('?')[0]`로 탭명을 추출하므로 `#/analyze?market=...`도 `analyze`로 라우팅된다. 변경 불필요(확인만).

- [ ] **Step 3: 서버 실행 + 브라우저 확인**

```bash
node server/server.mjs &
```
- 추천 탭: 매수/매도 토글, 검색, 행 클릭 시 개별분석 이동 확인
- 개별분석 탭: KRW-BTC 입력 → 차트 + 지표 + 캔들패턴 + 종합신호, 타임프레임/캔들·라인 전환 확인
확인 후 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: add recommend and analyze tabs"
```

---

## Task 10: 신호 검증 탭 + 마무리 (public/app.js + README)

**Files:**
- Modify: `public/app.js`
- Modify: `README.md`

- [ ] **Step 1: 검증 탭 라우트 추가**

`routes` 객체에 추가:
```javascript
  async verify() {
    setActiveTab('verify')
    view.innerHTML = '<h2>신호 검증</h2><p class="muted">불러오는 중…</p>'
    const v = await api('/api/verify')
    const bar = (rate) => `<div class="bar" style="width:120px;display:inline-block"><div style="width:${Math.round((rate || 0) * 100)}%"></div></div>`
    const statsRows = Object.entries(v.signalStats || {})
      .sort((a, b) => (b[1].hitRate) - (a[1].hitRate))
      .map(([k, s]) => `<tr><td>${k}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}% ${bar(s.hitRate)}</td><td>${(v.weights[k] ?? 1).toFixed(2)}</td></tr>`).join('')
    const timed = v.timedHitRates || {}
    view.innerHTML = `<h2>신호 검증</h2>
      <div class="kpis">
        <div class="kpi"><div class="label">전체 적중률</div><div class="val">${v.overallHitRate != null ? Math.round(v.overallHitRate * 100) + '%' : '-'}</div></div>
        <div class="kpi"><div class="label">+1일</div><div class="val">${timed['+1일'] ? Math.round(timed['+1일'].hitRate * 100) + '%' : '-'}</div></div>
        <div class="kpi"><div class="label">+3일</div><div class="val">${timed['+3일'] ? Math.round(timed['+3일'].hitRate * 100) + '%' : '-'}</div></div>
        <div class="kpi"><div class="label">+7일</div><div class="val">${timed['+7일'] ? Math.round(timed['+7일'].hitRate * 100) + '%' : '-'}</div></div>
      </div>
      <div class="panel"><h3>신호별 적중률 / 가중치</h3>
        <table><thead><tr><th>신호</th><th>표본</th><th>적중률</th><th>가중치</th></tr></thead>
        <tbody>${statsRows || '<tr><td colspan="4" class="muted">데이터 없음 (주간 분석 필요)</td></tr>'}</tbody></table>
      </div>`
  },
```

- [ ] **Step 2: 서버 실행 + 검증 탭 확인**

```bash
node server/server.mjs &
```
검증 탭 → 전체/+1/+3/+7일 KPI + 신호별 적중률 바 + 가중치 표 확인. 서버 종료.

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 모든 테스트 PASS (기존 34 + 캔들패턴/analyze/insights/scan-job/api 신규)

- [ ] **Step 4: README에 대시보드 섹션 추가**

`README.md`의 `## 사용` 코드블록에 추가:
```
npm run dashboard          # 로컬 대시보드 http://127.0.0.1:8787
```
그리고 `## 구조` 표 아래에 새 섹션:
```markdown
## 대시보드

`npm run dashboard` → 브라우저에서 `http://127.0.0.1:8787` (localhost 전용, 인증 없음).

- **대시보드 탭**: KPI(매수/매도/누적스캔/최다신호/적중률1위) + 매수·매도 TOP5 + 수동 스캔(진행률)
- **추천 탭**: 매수/매도 전체 리스트, 검색·정렬·콤보 태그
- **개별분석 탭**: 종목 검색 → 캔들/라인 차트(일/4h/1h) + 지표 + 🕯️ 캔들 모양분석 + 종합 점수
- **신호검증 탭**: 전체·시간별(+1/+3/+7일) 적중률 + 신호별 적중률/가중치

캔들 모양분석은 일본식 캔들스틱 패턴 12종(망치형·장악형·샛별/석별·도지 등)을 감지하며,
개별분석에 표시되고 스캔 점수에도 강세/약세 보너스(작은 가중치, EWM 자동 조정)로 반영된다.
```

- [ ] **Step 5: Commit**

```bash
git add public/app.js README.md
git commit -m "feat: add verify tab and dashboard docs"
```

---

## 완료 기준

- [ ] `npx vitest run` 전체 통과 (캔들패턴/analyze/insights/scan-job/api 포함)
- [ ] `npm run dashboard` → 4탭 모두 동작
- [ ] 대시보드 KPI/TOP5/인사이트 표시, 수동 스캔 진행률 동작
- [ ] 추천 탭 검색/토글/행클릭 이동
- [ ] 개별분석: 차트(캔들/라인, 일/4h/1h) + 지표 + 캔들패턴 + 종합점수
- [ ] 검증 탭: 적중률 + 시간별 + 가중치 표
- [ ] README 대시보드 섹션 추가
```
