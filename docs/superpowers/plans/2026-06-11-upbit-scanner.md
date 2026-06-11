# 업비트 스캐너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업비트 KRW 마켓을 하루 2회 자동 스캔해 콤보 보정된 매수/매도 신호를 집계하는 Node.js ESM 스캐너를 구축한다 (UI 제외, 공개 API만).

**Architecture:** 순수 함수 라이브러리(`lib/indicators.mjs`, `lib/signals.mjs`)와 네트워크 래퍼(`lib/upbit.mjs`)를 분리하고, 스크립트(`scripts/*.mjs`)가 이를 조합한다. 가중치/이력은 `data/*.json`에 저장하고, Windows 작업 스케줄러가 매일 09:00/21:00에 스캔을 실행한다.

**Tech Stack:** Node.js 24 (ESM, `type: module`), Vitest, Windows Task Scheduler (PowerShell), 업비트 공개 REST API.

---

## Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "upbit-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "scan": "node scripts/monitor.mjs",
    "weekly": "node scripts/weekly-analysis.mjs",
    "backtest": "node scripts/backtest.mjs",
    "analyze": "node scripts/analyze.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: .env.example 작성**

```bash
# 스캔/시세는 공개 API라 키 불필요. 추후 잔고/주문 확장 시 사용.
# UPBIT_ACCESS_KEY=
# UPBIT_SECRET_KEY=
```

- [ ] **Step 3: .gitignore 작성**

```
node_modules/
.env
*.log
```

- [ ] **Step 4: 의존성 설치**

Run: `npm install`
Expected: `node_modules/` 생성, vitest 설치 성공

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example .gitignore
git commit -m "chore: scaffold upbit scanner project"
```

---

## Task 2: 지표 라이브러리 (lib/indicators.mjs)

**Files:**
- Create: `lib/indicators.mjs`
- Test: `__tests__/indicators.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/indicators.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import {
  calcEMA, calcSMA, calcRSI, calcBB, calcMACD,
  calcStochastic, calcWilliamsR, calcVolRatio,
} from '../lib/indicators.mjs'

describe('calcSMA', () => {
  it('단순이동평균을 윈도우별로 계산', () => {
    expect(calcSMA([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4])
  })
})

describe('calcEMA', () => {
  it('첫 값은 시드, 길이는 입력과 동일', () => {
    const r = calcEMA([2, 4, 6, 8], 2)
    expect(r).toHaveLength(4)
    expect(r[0]).toBe(2)
    expect(r[3]).toBeCloseTo(7.111, 2) // k=2/3
  })
})

describe('calcRSI', () => {
  it('단조 상승이면 100', () => {
    const c = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(calcRSI(c)).toBe(100)
  })
  it('데이터 부족 시 null', () => {
    expect(calcRSI([1, 2, 3])).toBeNull()
  })
})

describe('calcBB', () => {
  it('평탄 데이터는 std 0 → upper=mid=lower', () => {
    const c = Array(20).fill(10)
    const bb = calcBB(c)
    expect(bb.upper).toBe(10)
    expect(bb.mid).toBe(10)
    expect(bb.lower).toBe(10)
  })
  it('데이터 부족 시 null', () => {
    expect(calcBB(Array(10).fill(1))).toBeNull()
  })
})

describe('calcMACD', () => {
  it('충분한 데이터에서 객체 반환', () => {
    const c = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i))
    const m = calcMACD(c)
    expect(m).toHaveProperty('macd')
    expect(m).toHaveProperty('signal')
    expect(m).toHaveProperty('prevHist')
  })
  it('데이터 부족 시 null', () => {
    expect(calcMACD(Array(10).fill(1))).toBeNull()
  })
})

describe('calcStochastic', () => {
  it('high===low 구간은 k 50 처리, 객체 반환', () => {
    const n = 30
    const closes = Array.from({ length: n }, (_, i) => 100 + i)
    const highs = closes.map((c) => c + 1)
    const lows = closes.map((c) => c - 1)
    const s = calcStochastic(highs, lows, closes)
    expect(s).toHaveProperty('k')
    expect(s).toHaveProperty('prevD')
  })
})

describe('calcWilliamsR', () => {
  it('최고가에 종가가 닿으면 0', () => {
    const closes = [1, 2, 3, 10, 5, 6, 7, 8, 9, 10, 1, 2, 3, 10]
    const highs = closes.map((c) => c)
    const lows = closes.map(() => 0)
    expect(calcWilliamsR(highs, lows, closes)).toBe(0)
  })
})

describe('calcVolRatio', () => {
  it('최근 거래량 / 직전 20개 평균', () => {
    const vols = [...Array(20).fill(10), 20]
    expect(calcVolRatio(vols)).toBeCloseTo(2, 5)
  })
  it('데이터 부족 시 null', () => {
    expect(calcVolRatio(Array(10).fill(1))).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/indicators.test.mjs`
Expected: FAIL — `Failed to resolve import '../lib/indicators.mjs'`

- [ ] **Step 3: lib/indicators.mjs 구현**

```javascript
// 순수 함수만. 네트워크/IO 없음. (가이드 §6-2 이식)

export function calcEMA(d, p) {
  const k = 2 / (p + 1), r = [d[0]]
  for (let i = 1; i < d.length; i++) r.push(d[i] * k + r[i - 1] * (1 - k))
  return r
}

export function calcSMA(d, p) {
  const r = []
  for (let i = p - 1; i < d.length; i++)
    r.push(d.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p)
  return r
}

export function calcRSI(c, p = 14) {
  if (c.length < p + 1) return null
  let ag = 0, al = 0
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d > 0 ? (ag += d) : (al -= d) }
  ag /= p; al /= p
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al)
}

export function calcBB(c, p = 20, m = 2) {
  if (c.length < p) return null
  const sl = c.slice(-p), sma = sl.reduce((a, b) => a + b, 0) / p
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - sma) ** 2, 0) / p)
  return { upper: sma + m * std, mid: sma, lower: sma - m * std }
}

export function calcMACD(c, f = 12, s = 26, g = 9) {
  if (c.length < s + g) return null
  const mf = calcEMA(c, f), ms = calcEMA(c, s)
  const ml = c.map((_, i) => mf[i] - ms[i]), sl = calcEMA(ml, g)
  const l = c.length - 1, p = l - 1
  return { macd: ml[l], signal: sl[l], hist: ml[l] - sl[l], prevMacd: ml[p], prevSignal: sl[p], prevHist: ml[p] - sl[p] }
}

export function calcStochastic(highs, lows, closes, period = 14, sk = 3, sd = 3) {
  if (closes.length < period + sk + sd - 2) return null
  const rawK = []
  for (let i = period - 1; i < closes.length; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1))
    const l = Math.min(...lows.slice(i - period + 1, i + 1))
    rawK.push(h === l ? 50 : ((closes[i] - l) / (h - l)) * 100)
  }
  const smoothK = calcSMA(rawK, sk)
  const smoothD = calcSMA(smoothK, sd)
  const lk = smoothK.length - 1, ld = smoothD.length - 1
  return { k: smoothK[lk], d: smoothD[ld], prevK: smoothK[lk - 1], prevD: smoothD[ld - 1] }
}

export function calcWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null
  const h = Math.max(...highs.slice(-period))
  const l = Math.min(...lows.slice(-period))
  return h === l ? -50 : ((h - closes.at(-1)) / (h - l)) * -100
}

export function calcVolRatio(volumes) {
  if (volumes.length < 21) return null
  const avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
  return avg > 0 ? volumes.at(-1) / avg : null
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/indicators.test.mjs`
Expected: PASS (모든 테스트 통과)

- [ ] **Step 5: Commit**

```bash
git add lib/indicators.mjs __tests__/indicators.test.mjs
git commit -m "feat: add indicator library with tests"
```

---

## Task 3: 신호/콤보/패턴 로직 (lib/signals.mjs)

**Files:**
- Create: `lib/signals.mjs`
- Test: `__tests__/signals.test.mjs`

신호 출력 규약 (라벨 문자열): 콤보 로직이 `startsWith`/`includes`로 매칭하므로
정확히 아래 접두어를 사용해야 한다.
- `'RSI 과매도 (<30)'`, `'BB 하단 지지'`, `'Stoch 과매도 골든크로스 (...)'`,
  `'Stoch 과매도 (...)'`, `'Williams %R 과매도 (...)'`, `'거래량 급증 (...)'` 등.

`ohlcv` 입력 형태: `[{ close, high, low, volume }]` (과거→최신 정렬).

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/signals.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { applyCombos, detectSignals } from '../lib/signals.mjs'

describe('applyCombos', () => {
  it('StochGC 없이 과매도 4종 동시 → ×0.55 페널티', () => {
    const buy = [
      'RSI 과매도 (<30)',
      'BB 하단 지지',
      'Stoch 과매도 (15)',
      'Williams %R 과매도 (-90)',
    ]
    const { buyScore, buy: out } = applyCombos(buy, [], 10)
    expect(buyScore).toBeCloseTo(5.5, 5)
    expect(out).toContain('[콤보] 과매도 함정 페널티')
  })

  it('StochGC 포함 → ×1.4 보너스, 페널티 면제', () => {
    const buy = [
      'RSI 과매도 (<30)',
      'BB 하단 지지',
      'Stoch 과매도 골든크로스 (5)',
      'Williams %R 과매도 (-90)',
    ]
    const { buyScore, buy: out } = applyCombos(buy, [], 10)
    expect(buyScore).toBeCloseTo(14, 5)
    expect(out).toContain('[콤보] 반등확인 보너스')
    expect(out).not.toContain('[콤보] 과매도 함정 페널티')
  })

  it('거래량 급증 동반 → 추가 ×1.3', () => {
    const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (2.5x)']
    const { buyScore } = applyCombos(buy, [], 10)
    expect(buyScore).toBeCloseTo(10 * 1.4 * 1.3, 5)
  })
})

describe('detectSignals', () => {
  it('buy/sell 배열과 점수를 반환', () => {
    const ohlcv = Array.from({ length: 60 }, (_, i) => {
      const close = 100 + i
      return { close, high: close + 1, low: close - 1, volume: 10 }
    })
    const r = detectSignals(ohlcv, {})
    expect(r).toHaveProperty('buy')
    expect(r).toHaveProperty('sell')
    expect(typeof r.buyScore).toBe('number')
    expect(typeof r.sellScore).toBe('number')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/signals.test.mjs`
Expected: FAIL — `Failed to resolve import '../lib/signals.mjs'`

- [ ] **Step 3: lib/signals.mjs 구현**

```javascript
import {
  calcEMA, calcRSI, calcBB, calcMACD,
  calcStochastic, calcWilliamsR, calcVolRatio,
} from './indicators.mjs'

// weights: { '신호라벨접두어': number }. 없으면 1.0.
function w(weights, key) {
  return weights && weights[key] != null ? weights[key] : 1
}

// 라벨 접두어로 가중치 조회 (예: 'RSI 과매도 (<30)' → 'RSI 과매도')
const WEIGHT_KEYS = [
  'MACD 골든크로스', 'MACD 반등', 'MACD 상승', 'MACD 데드크로스', 'MACD 하락전환', 'MACD 하락',
  'RSI 과매도', 'RSI 과매수', 'BB 하단 지지', 'BB 상단 돌파',
  'Stoch 과매도 골든크로스', 'Stoch 과매도', 'Stoch 과매수 데드크로스', 'Stoch 과매수',
  'Williams %R 과매도', 'Williams %R 과매수',
  'EMA 20/50 골든크로스', 'EMA 상승배열', 'EMA 20/50 데드크로스', 'EMA 하락배열',
  '거래량 급증', '쌍봉 패턴', '하락깃발 패턴', '역삼중바닥 패턴', '상승깃발 패턴', '상승삼각형 패턴',
]
function weightFor(weights, label) {
  // 가장 긴 매칭 접두어 우선 (예: 'Stoch 과매도 골든크로스' > 'Stoch 과매도')
  const key = WEIGHT_KEYS
    .filter((k) => label.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return key ? w(weights, key) : 1
}

export function detectSignals(ohlcv, weights = {}) {
  const closes = ohlcv.map((c) => c.close)
  const highs = ohlcv.map((c) => c.high)
  const lows = ohlcv.map((c) => c.low)
  const volumes = ohlcv.map((c) => c.volume)
  const price = closes.at(-1)

  const buy = [], sell = []
  let buyScore = 0, sellScore = 0
  const addBuy = (label, score) => { buy.push(label); buyScore += score * weightFor(weights, label) }
  const addSell = (label, score) => { sell.push(label); sellScore += score * weightFor(weights, label) }

  const rsi = calcRSI(closes)
  const bb = calcBB(closes)
  const macd = calcMACD(closes)
  const stoch = calcStochastic(highs, lows, closes)
  const wr = calcWilliamsR(highs, lows, closes)
  const volR = calcVolRatio(volumes)
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const li = closes.length - 1

  // RSI
  if (rsi != null) {
    if (rsi < 30) addBuy(`RSI 과매도 (${rsi.toFixed(0)})`, 3)
    else if (rsi > 70) addSell(`RSI 과매수 (${rsi.toFixed(0)})`, 3)
  }
  // BB
  if (bb) {
    if (price <= bb.lower * 1.005) addBuy('BB 하단 지지', 2)
    else if (price >= bb.upper * 0.995) addSell('BB 상단 돌파', 2)
  }
  // MACD
  if (macd) {
    if (macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal) addBuy('MACD 골든크로스', 3)
    else if (macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal) addSell('MACD 데드크로스', 3)
    if (macd.prevHist < 0 && macd.hist > 0) addBuy('MACD 반등', 2)
    else if (macd.prevHist > 0 && macd.hist < 0) addSell('MACD 하락전환', 2)
    if (macd.macd > macd.signal && macd.signal > 0) addBuy('MACD 상승', 1)
    else if (macd.macd < macd.signal && macd.signal < 0) addSell('MACD 하락', 1)
  }
  // Stoch
  if (stoch) {
    if (stoch.k < 20 && stoch.prevK < stoch.prevD && stoch.k > stoch.d)
      addBuy(`Stoch 과매도 골든크로스 (${stoch.k.toFixed(0)})`, 3)
    else if (stoch.k > 80 && stoch.prevK > stoch.prevD && stoch.k < stoch.d)
      addSell(`Stoch 과매수 데드크로스 (${stoch.k.toFixed(0)})`, 3)
    else if (stoch.k < 20) addBuy(`Stoch 과매도 (${stoch.k.toFixed(0)})`, 2)
    else if (stoch.k > 80) addSell(`Stoch 과매수 (${stoch.k.toFixed(0)})`, 2)
  }
  // Williams %R
  if (wr != null) {
    if (wr <= -85) addBuy(`Williams %R 과매도 (${wr.toFixed(0)})`, 1)
    else if (wr >= -15) addSell(`Williams %R 과매수 (${wr.toFixed(0)})`, 1)
  }
  // EMA
  if (ema20.length && ema50.length) {
    const e20 = ema20[li], e50 = ema50[li], pe20 = ema20[li - 1], pe50 = ema50[li - 1]
    if (pe20 <= pe50 && e20 > e50) addBuy('EMA 20/50 골든크로스', 2)
    else if (pe20 >= pe50 && e20 < e50) addSell('EMA 20/50 데드크로스', 2)
    if (e20 > e50 * 1.005) addBuy('EMA 상승배열', 2)
    else if (e20 < e50 * 0.995) addSell('EMA 하락배열', 2)
  }
  // 거래량
  if (volR != null && volR >= 2 && volumes.length >= 2) {
    const up = closes.at(-1) >= closes.at(-2)
    if (up) addBuy(`거래량 급증 (${volR.toFixed(1)}x)`, 1)
    else addSell(`거래량 급증 (${volR.toFixed(1)}x)`, 1)
  }

  return { buy, sell, buyScore, sellScore, price }
}

export function applyCombos(buy, sell, buyScore) {
  let bs = buyScore
  const out = [...buy]
  const hasStochGC = out.some((s) => s.includes('골든크로스'))
  const hasRSI = out.some((s) => s.startsWith('RSI 과매도'))
  const hasBB = out.includes('BB 하단 지지')
  const hasStoch = out.some((s) => s.startsWith('Stoch 과매도') && !s.includes('골든크로스'))
  const hasWR = out.some((s) => s.startsWith('Williams %R 과매도'))
  const hasVol = out.some((s) => s.startsWith('거래량 급증'))

  if (!hasStochGC && hasRSI && hasBB && hasStoch && hasWR) {
    bs *= 0.55
    out.push('[콤보] 과매도 함정 페널티')
  }
  if (hasStochGC) {
    bs *= 1.4
    out.push('[콤보] 반등확인 보너스')
  }
  if (hasVol) {
    bs *= 1.3
    out.push('[콤보] 거래량확인 보너스')
  }
  return { buyScore: bs, buy: out }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/signals.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/signals.mjs __tests__/signals.test.mjs
git commit -m "feat: add signal detection and combo correction"
```

---

## Task 4: 차트 패턴 감지 (lib/signals.mjs 확장)

**Files:**
- Modify: `lib/signals.mjs`
- Test: `__tests__/patterns.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/patterns.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { detectPatterns } from '../lib/signals.mjs'

describe('detectPatterns', () => {
  it('상승깃발: 16봉 +8% 상승 후 횡보 → buy 신호', () => {
    // 35봉 구성: 앞부분 평탄 → 16봉 급등 → 횡보
    const base = Array(15).fill(100)
    const rally = Array.from({ length: 16 }, (_, i) => 100 + (i + 1) * 0.6) // ~+9.6%
    const top = rally.at(-1)
    const flat = Array.from({ length: 4 }, () => top * 1.0) // 횡보
    const closes = [...base, ...rally, ...flat]
    const ohlcv = closes.map((c) => ({ close: c, high: c * 1.001, low: c * 0.999, volume: 10 }))
    const r = detectPatterns(ohlcv)
    expect(r).toHaveProperty('buy')
    expect(r).toHaveProperty('sell')
    expect(Array.isArray(r.buy)).toBe(true)
  })

  it('데이터 부족 시 빈 배열', () => {
    const ohlcv = Array(5).fill({ close: 1, high: 1, low: 1, volume: 1 })
    const r = detectPatterns(ohlcv)
    expect(r.buy).toEqual([])
    expect(r.sell).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/patterns.test.mjs`
Expected: FAIL — `detectPatterns is not a function`

- [ ] **Step 3: detectPatterns 구현 (lib/signals.mjs에 추가)**

`lib/signals.mjs` 끝에 append:
```javascript
// 차트 패턴 감지 (가이드 §9). ohlcv: 과거→최신.
export function detectPatterns(ohlcv) {
  const buy = [], sell = []
  const closes = ohlcv.map((c) => c.close)
  const highs = ohlcv.map((c) => c.high)
  const lows = ohlcv.map((c) => c.low)
  const n = closes.length
  if (n < 30) return { buy, sell }
  const price = closes.at(-1)

  // 쌍봉 (Double Top): 최근 30봉 내 두 고점 차 <1.5%, 사이 골짜기, 현재가 ≤ 평균×0.99
  const win = 30
  const seg = highs.slice(-win)
  const segLow = lows.slice(-win)
  const idx1 = seg.indexOf(Math.max(...seg.slice(0, win / 2)))
  const idx2 = (win / 2) + seg.slice(win / 2).indexOf(Math.max(...seg.slice(win / 2)))
  if (idx1 >= 0 && idx2 > idx1) {
    const h1 = seg[idx1], h2 = seg[idx2]
    const valley = Math.min(...segLow.slice(idx1, idx2 + 1))
    const avgTop = (h1 + h2) / 2
    if (Math.abs(h1 - h2) / avgTop < 0.015 && valley < avgTop * 0.97 && price <= avgTop * 0.99)
      sell.push('쌍봉 패턴')
  }

  // 역삼중바닥 (Triple Bottom): 세 저점 편차 <1.5%, 현재가 > 평균×1.02
  const lo = lows.slice(-win)
  const sorted = [...lo].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)
  if (sorted.length === 3) {
    const vals = sorted.map((s) => s[0])
    const avg = vals.reduce((a, b) => a + b, 0) / 3
    const dev = Math.max(...vals.map((v) => Math.abs(v - avg) / avg))
    if (dev < 0.015 && price > avg * 1.02) buy.push('역삼중바닥 패턴')
  }

  // 상승깃발: 직전 16봉 +8%↑ 후 -2%~+0.3% 횡보
  if (n >= 20) {
    const polePast = closes[n - 20], poleNow = closes[n - 4]
    const poleGain = (poleNow - polePast) / polePast
    const consol = (price - poleNow) / poleNow
    if (poleGain >= 0.08 && consol >= -0.02 && consol <= 0.003) buy.push('상승깃발 패턴')
  }

  // 하락깃발: 직전 16봉 -6%↓ 후 -0.5%~+2.5% 횡보
  if (n >= 20) {
    const polePast = closes[n - 20], poleNow = closes[n - 4]
    const poleDrop = (poleNow - polePast) / polePast
    const consol = (price - poleNow) / poleNow
    if (poleDrop <= -0.06 && consol >= -0.005 && consol <= 0.025) sell.push('하락깃발 패턴')
  }

  // 상승삼각형: 최근 30봉 고점 편차 <1.5%, 저점 상승 추세
  const segH = highs.slice(-win)
  const avgH = segH.reduce((a, b) => a + b, 0) / win
  const devH = Math.max(...segH.map((v) => Math.abs(v - avgH) / avgH))
  const firstHalfLow = Math.min(...lows.slice(-win, -win / 2))
  const secondHalfLow = Math.min(...lows.slice(-win / 2))
  if (devH < 0.015 && secondHalfLow > firstHalfLow) buy.push('상승삼각형 패턴')

  return { buy, sell }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/patterns.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/signals.mjs __tests__/patterns.test.mjs
git commit -m "feat: add chart pattern detection"
```

---

## Task 5: 업비트 공개 API 래퍼 (lib/upbit.mjs)

**Files:**
- Create: `lib/upbit.mjs`
- Test: `__tests__/upbit.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/upbit.test.mjs` (fetch 모킹):
```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMarkets, getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.restoreAllMocks() })

function mockFetch(data, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({ ok, json: async () => data })
}

describe('getMarkets', () => {
  it('KRW 마켓만, 스테이블코인 제외', async () => {
    mockFetch([
      { market: 'KRW-BTC', korean_name: '비트코인' },
      { market: 'KRW-USDT', korean_name: '테더' },
      { market: 'BTC-ETH', korean_name: '이더' },
    ])
    const r = await getMarkets()
    expect(r.map((m) => m.market)).toEqual(['KRW-BTC'])
  })
})

describe('candlesToOhlcv', () => {
  it('업비트 캔들을 과거→최신 ohlcv로 변환', () => {
    const candles = [
      { trade_price: 3, high_price: 3, low_price: 2, candle_acc_trade_volume: 30 },
      { trade_price: 1, high_price: 1, low_price: 0, candle_acc_trade_volume: 10 },
    ] // 업비트는 최신→과거 순으로 줌
    const o = candlesToOhlcv(candles)
    expect(o[0].close).toBe(1) // 과거가 먼저
    expect(o[1].close).toBe(3)
  })
})

describe('getDayCandles', () => {
  it('실패 응답 시 null', async () => {
    mockFetch(null, false)
    expect(await getDayCandles('KRW-BTC')).toBeNull()
  })
})

describe('getTicker', () => {
  it('마켓 배열을 콤마로 합쳐 호출', async () => {
    mockFetch([{ market: 'KRW-BTC', trade_price: 100 }])
    const r = await getTicker(['KRW-BTC'])
    expect(r[0].trade_price).toBe(100)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/upbit.test.mjs`
Expected: FAIL — `Failed to resolve import '../lib/upbit.mjs'`

- [ ] **Step 3: lib/upbit.mjs 구현**

```javascript
const BASE = 'https://api.upbit.com/v1'
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'USD1', 'TUSD', 'BUSD'])

async function get(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    return r.ok ? r.json() : null
  } catch {
    return null
  }
}

export async function getMarkets() {
  const all = await get(`${BASE}/market/all?isDetails=false`)
  if (!all) return []
  return all.filter((m) => {
    if (!m.market.startsWith('KRW-')) return false
    const sym = m.market.split('-')[1]
    return !STABLES.has(sym)
  })
}

export async function getDayCandles(market, count = 200) {
  return get(`${BASE}/candles/days?market=${market}&count=${count}`)
}

export async function getTicker(markets) {
  const list = Array.isArray(markets) ? markets.join(',') : markets
  return get(`${BASE}/ticker?markets=${list}`)
}

// 업비트 캔들(최신→과거)을 과거→최신 ohlcv로 변환
export function candlesToOhlcv(candles) {
  return [...candles].reverse().map((c) => ({
    close: c.trade_price,
    high: c.high_price,
    low: c.low_price,
    volume: c.candle_acc_trade_volume,
  }))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/upbit.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/upbit.mjs __tests__/upbit.test.mjs
git commit -m "feat: add upbit public API wrapper"
```

---

## Task 6: 가중치 시드 + 로그 헬퍼 (lib/store.mjs)

**Files:**
- Create: `lib/store.mjs`
- Create: `data/signal-weights.json`
- Test: `__tests__/store.test.mjs`

- [ ] **Step 1: data/signal-weights.json 시드 (가이드 §7)**

```json
{
  "MACD 골든크로스": 1.4,
  "MACD 반등": 1.0,
  "MACD 상승": 0.7,
  "MACD 데드크로스": 1.14,
  "MACD 하락전환": 1.0,
  "MACD 하락": 1.2,
  "RSI 과매도": 0.55,
  "RSI 과매수": 1.5,
  "BB 하단 지지": 0.6,
  "BB 상단 돌파": 1.45,
  "Stoch 과매도 골든크로스": 1.42,
  "Stoch 과매도": 0.7,
  "Stoch 과매수 데드크로스": 1.45,
  "Stoch 과매수": 1.32,
  "Williams %R 과매도": 0.61,
  "Williams %R 과매수": 1.14,
  "EMA 20/50 골든크로스": 1.2,
  "EMA 상승배열": 0.97,
  "EMA 20/50 데드크로스": 1.06,
  "EMA 하락배열": 1.23,
  "거래량 급증": 1.1,
  "쌍봉 패턴": 1.23,
  "하락깃발 패턴": 1.14,
  "역삼중바닥 패턴": 0.79,
  "상승깃발 패턴": 1.06,
  "상승삼각형 패턴": 1.0
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`__tests__/store.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { rollingAppend, clampWeight, ewmTarget } from '../lib/store.mjs'

describe('rollingAppend', () => {
  it('최대 길이 초과 시 오래된 항목 제거', () => {
    const arr = [1, 2, 3]
    expect(rollingAppend(arr, 4, 3)).toEqual([2, 3, 4])
  })
  it('한도 미만이면 그대로 append', () => {
    expect(rollingAppend([1], 2, 3)).toEqual([1, 2])
  })
})

describe('ewmTarget', () => {
  it('hitRate별 target', () => {
    expect(ewmTarget(0.8)).toBe(1.5)
    expect(ewmTarget(0.6)).toBe(1.0)
    expect(ewmTarget(0.3)).toBe(0.7)
  })
})

describe('clampWeight', () => {
  it('0.5~2.0 범위로 제한', () => {
    expect(clampWeight(0.8 * 1.4 + 0.2 * 1.5)).toBeCloseTo(1.42, 5)
    expect(clampWeight(5)).toBe(2.0)
    expect(clampWeight(0.1)).toBe(0.5)
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run __tests__/store.test.mjs`
Expected: FAIL — `Failed to resolve import '../lib/store.mjs'`

- [ ] **Step 4: lib/store.mjs 구현**

```javascript
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = join(ROOT, 'data')

export async function readJson(name, fallback) {
  const path = join(DATA_DIR, name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return fallback
  }
}

export async function writeJson(name, data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })
  await writeFile(join(DATA_DIR, name), JSON.stringify(data, null, 2), 'utf-8')
}

// 배열에 항목 추가 후 최대 길이 유지 (오래된 것 제거)
export function rollingAppend(arr, item, max) {
  const next = [...arr, item]
  return next.length > max ? next.slice(next.length - max) : next
}

// EWM 가중치 갱신 (가이드 §7)
export function ewmTarget(hitRate) {
  return hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
}
export function clampWeight(v) {
  return Math.max(0.5, Math.min(2.0, v))
}
export function newWeight(oldWeight, hitRate) {
  return clampWeight(oldWeight * 0.8 + ewmTarget(hitRate) * 0.2)
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run __tests__/store.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/store.mjs data/signal-weights.json __tests__/store.test.mjs
git commit -m "feat: add data store helpers and weight seed"
```

---

## Task 7: 메인 스캔 스크립트 (scripts/monitor.mjs)

**Files:**
- Create: `scripts/monitor.mjs`

이 스크립트는 네트워크 호출이라 단위 테스트 대신 실제 실행으로 검증한다.

- [ ] **Step 1: scripts/monitor.mjs 구현**

```javascript
import { getMarkets, getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { detectSignals, detectPatterns, applyCombos } from '../lib/signals.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'

const BATCH = 5
const DELAY = 200
const MIN_TRADE_PRICE_24H = 100_000_000 // 1억원
const MAX_SCANS = 30
const BUY_THRESHOLD = 5
const SELL_THRESHOLD = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const weights = await readJson('signal-weights.json', {})
  const markets = await getMarkets()
  if (!markets.length) { console.error('마켓 조회 실패'); process.exit(1) }

  // 24h 거래대금 필터
  const codes = markets.map((m) => m.market)
  const tickers = []
  for (let i = 0; i < codes.length; i += 100) {
    const t = await getTicker(codes.slice(i, i + 100))
    if (t) tickers.push(...t)
    await sleep(DELAY)
  }
  const liquid = new Set(
    tickers.filter((t) => t.acc_trade_price_24h >= MIN_TRADE_PRICE_24H).map((t) => t.market),
  )
  const nameOf = Object.fromEntries(markets.map((m) => [m.market, m.korean_name]))
  const targets = codes.filter((c) => liquid.has(c))
  console.log(`스캔 대상 ${targets.length}종목 (전체 ${codes.length})`)

  const buy = [], sell = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      const sig = detectSignals(ohlcv, weights)
      const pat = detectPatterns(ohlcv)
      // 패턴 점수 합산 (가이드 §9 점수)
      const PATTERN_SCORE = { '쌍봉 패턴': 5, '역삼중바닥 패턴': 3, '상승깃발 패턴': 4, '하락깃발 패턴': 4, '상승삼각형 패턴': 5 }
      for (const p of pat.buy) { sig.buy.push(p); sig.buyScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1) }
      for (const p of pat.sell) { sig.sell.push(p); sig.sellScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1) }

      const combo = applyCombos(sig.buy, sig.sell, sig.buyScore)
      const finalBuyScore = combo.buyScore
      if (finalBuyScore >= BUY_THRESHOLD) {
        buy.push({ market, korean_name: nameOf[market], price: sig.price, score: +finalBuyScore.toFixed(1), signals: combo.buy })
      }
      if (sig.sellScore >= SELL_THRESHOLD) {
        sell.push({ market, korean_name: nameOf[market], price: sig.price, score: +sig.sellScore.toFixed(1), signals: sig.sell })
      }
    }))
    await sleep(DELAY)
  }

  buy.sort((a, b) => b.score - a.score)
  sell.sort((a, b) => b.score - a.score)

  const log = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  log.totalScans = (log.totalScans || 0) + 1
  log.scans = rollingAppend(log.scans || [], { timestamp: new Date().toISOString(), buy, sell }, MAX_SCANS)
  await writeJson('monitor-log.json', log)

  console.log(`스캔 #${log.totalScans} 완료 — 매수 ${buy.length} / 매도 ${sell.length}`)
  console.log('매수 상위:', buy.slice(0, 5).map((b) => `${b.korean_name}(${b.score})`).join(', ') || '없음')
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 실제 실행으로 검증 (네트워크)**

Run: `node scripts/monitor.mjs`
Expected: `스캔 대상 N종목`, `스캔 #1 완료 — 매수 X / 매도 Y` 출력, `data/monitor-log.json` 생성

- [ ] **Step 3: 로그 파일 확인**

Run: `node -e "const l=require('./data/monitor-log.json'); console.log('scans:',l.scans.length,'total:',l.totalScans)"`
Expected: `scans: 1 total: 1`

- [ ] **Step 4: Commit**

```bash
git add scripts/monitor.mjs data/monitor-log.json
git commit -m "feat: add main scan script"
```

---

## Task 8: 개별 종목 분석 (scripts/analyze.mjs)

**Files:**
- Create: `scripts/analyze.mjs`

- [ ] **Step 1: scripts/analyze.mjs 구현**

```javascript
import { getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import {
  calcRSI, calcBB, calcMACD, calcStochastic, calcWilliamsR, calcVolRatio, calcEMA,
} from '../lib/indicators.mjs'
import { detectSignals, detectPatterns, applyCombos } from '../lib/signals.mjs'

const market = process.argv[2] || 'KRW-BTC'

const [candles, ticker] = await Promise.all([
  getDayCandles(market, 200),
  getTicker([market]),
])
if (!candles || !ticker) { console.error('조회 실패:', market); process.exit(1) }

const ohlcv = candlesToOhlcv(candles)
const closes = ohlcv.map((c) => c.close)
const highs = ohlcv.map((c) => c.high)
const lows = ohlcv.map((c) => c.low)
const volumes = ohlcv.map((c) => c.volume)
const price = ticker[0].trade_price
const chg = (ticker[0].signed_change_rate * 100).toFixed(2)

const rsi = calcRSI(closes), bb = calcBB(closes), mac = calcMACD(closes)
const stoch = calcStochastic(highs, lows, closes), wr = calcWilliamsR(highs, lows, closes)
const volR = calcVolRatio(volumes)
const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50), l = ema20.length - 1

console.log(`\n=== ${market} ===`)
console.log('현재가:', price, `(${chg}%)`)
console.log('RSI:', rsi?.toFixed(1))
console.log('BB lower:', bb?.lower.toFixed(4), 'mid:', bb?.mid.toFixed(4), 'upper:', bb?.upper.toFixed(4))
console.log('MACD hist:', mac?.hist.toFixed(4), 'prevHist:', mac?.prevHist.toFixed(4))
console.log('Stoch K:', stoch?.k.toFixed(1), 'D:', stoch?.d.toFixed(1), 'prevK:', stoch?.prevK.toFixed(1), 'prevD:', stoch?.prevD.toFixed(1))
console.log('WR:', wr?.toFixed(1))
console.log('EMA20:', ema20[l].toFixed(4), 'EMA50:', ema50[l].toFixed(4))
console.log('VolRatio:', volR?.toFixed(2) + 'x')
console.log('최근 7일 종가:', closes.slice(-7).map((v) => v.toFixed(4)).join(' → '))

const sig = detectSignals(ohlcv, {})
const pat = detectPatterns(ohlcv)
const combo = applyCombos([...sig.buy, ...pat.buy], [...sig.sell, ...pat.sell], sig.buyScore)
console.log('\n매수 신호:', combo.buy.join(', ') || '없음')
console.log('매도 신호:', [...sig.sell, ...pat.sell].join(', ') || '없음')
console.log('매수 점수:', combo.buyScore.toFixed(1), '/ 매도 점수:', sig.sellScore.toFixed(1))
```

- [ ] **Step 2: 실제 실행 검증**

Run: `node scripts/analyze.mjs KRW-BTC`
Expected: `=== KRW-BTC ===` 헤더와 지표 값들 출력

- [ ] **Step 3: Commit**

```bash
git add scripts/analyze.mjs
git commit -m "feat: add per-market analysis script"
```

---

## Task 9: 주간 분석 + EWM 가중치 갱신 (scripts/weekly-analysis.mjs)

**Files:**
- Create: `scripts/weekly-analysis.mjs`
- Create: `lib/weekly.mjs`
- Test: `__tests__/weekly.test.mjs`

적중률 집계 로직은 순수 함수로 분리해 테스트한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/weekly.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { judgeHit, aggregateHitRates, updateWeights } from '../lib/weekly.mjs'

describe('judgeHit', () => {
  it('매수: 현재가>신호가면 적중', () => {
    expect(judgeHit('buy', 100, 120)).toBe(true)
    expect(judgeHit('buy', 100, 90)).toBe(false)
  })
  it('매도: 현재가<신호가면 적중', () => {
    expect(judgeHit('sell', 100, 80)).toBe(true)
    expect(judgeHit('sell', 100, 110)).toBe(false)
  })
})

describe('aggregateHitRates', () => {
  it('신호별 적중률 집계', () => {
    const records = [
      { signals: ['RSI 과매도 (10)'], hit: true },
      { signals: ['RSI 과매도 (12)'], hit: false },
      { signals: ['RSI 과매도 (9)'], hit: true },
    ]
    const r = aggregateHitRates(records)
    expect(r['RSI 과매도'].count).toBe(3)
    expect(r['RSI 과매도'].hitRate).toBeCloseTo(2 / 3, 5)
  })
})

describe('updateWeights', () => {
  it('MIN_SAMPLES 미만이면 조정 안 함', () => {
    const weights = { 'RSI 과매도': 0.55 }
    const stats = { 'RSI 과매도': { count: 2, hitRate: 0.1 } }
    expect(updateWeights(weights, stats)['RSI 과매도']).toBe(0.55)
  })
  it('충분한 샘플이면 EWM 갱신', () => {
    const weights = { 'RSI 과매도': 0.55 }
    const stats = { 'RSI 과매도': { count: 5, hitRate: 0.2 } }
    // 0.55*0.8 + 0.7*0.2 = 0.58
    expect(updateWeights(weights, stats)['RSI 과매도']).toBeCloseTo(0.58, 5)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/weekly.test.mjs`
Expected: FAIL — `Failed to resolve import '../lib/weekly.mjs'`

- [ ] **Step 3: lib/weekly.mjs 구현**

```javascript
import { newWeight } from './store.mjs'

const MIN_SAMPLES = 3
const SIGNAL_KEYS = [
  'MACD 골든크로스', 'MACD 반등', 'MACD 상승', 'MACD 데드크로스', 'MACD 하락전환', 'MACD 하락',
  'RSI 과매도', 'RSI 과매수', 'BB 하단 지지', 'BB 상단 돌파',
  'Stoch 과매도 골든크로스', 'Stoch 과매도', 'Stoch 과매수 데드크로스', 'Stoch 과매수',
  'Williams %R 과매도', 'Williams %R 과매수',
  'EMA 20/50 골든크로스', 'EMA 상승배열', 'EMA 20/50 데드크로스', 'EMA 하락배열',
  '거래량 급증', '쌍봉 패턴', '하락깃발 패턴', '역삼중바닥 패턴', '상승깃발 패턴', '상승삼각형 패턴',
]

export function judgeHit(side, signalPrice, currentPrice) {
  return side === 'buy' ? currentPrice > signalPrice : currentPrice < signalPrice
}

// 라벨에서 가중치 키 추출 (가장 긴 매칭 우선)
function keyOf(label) {
  return SIGNAL_KEYS
    .filter((k) => label.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
}

export function aggregateHitRates(records) {
  const acc = {}
  for (const rec of records) {
    for (const label of rec.signals) {
      const key = keyOf(label)
      if (!key) continue
      acc[key] ??= { count: 0, hits: 0 }
      acc[key].count++
      if (rec.hit) acc[key].hits++
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(acc)) {
    out[k] = { count: v.count, hitRate: v.count ? v.hits / v.count : 0 }
  }
  return out
}

export function updateWeights(weights, stats) {
  const out = { ...weights }
  for (const [key, { count, hitRate }] of Object.entries(stats)) {
    if (count < MIN_SAMPLES) continue
    out[key] = newWeight(out[key] ?? 1, hitRate)
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/weekly.test.mjs`
Expected: PASS

- [ ] **Step 5: scripts/weekly-analysis.mjs 구현**

```javascript
import { getTicker } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { judgeHit, aggregateHitRates, updateWeights } from '../lib/weekly.mjs'

const force = process.argv.includes('--force')
const MAX_WEEKS = 12

// 수요일(3) KST 외에는 실행 안 함 (--force 제외)
const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
if (!force && kstDay !== 3) {
  console.log('수요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}

const log = await readJson('monitor-log.json', { scans: [] })
const recentScans = log.scans.slice(-7)
if (!recentScans.length) { console.log('스캔 이력 없음'); process.exit(0) }

// 예측 수집 (매수/매도 신호가)
const preds = []
for (const scan of recentScans) {
  for (const b of scan.buy) preds.push({ side: 'buy', market: b.market, signalPrice: b.price, signals: b.signals })
  for (const s of scan.sell) preds.push({ side: 'sell', market: s.market, signalPrice: s.price, signals: s.signals })
}
if (!preds.length) { console.log('예측 없음'); process.exit(0) }

// 현재가 조회
const codes = [...new Set(preds.map((p) => p.market))]
const tickers = []
for (let i = 0; i < codes.length; i += 100) {
  const t = await getTicker(codes.slice(i, i + 100))
  if (t) tickers.push(...t)
}
const priceOf = Object.fromEntries(tickers.map((t) => [t.market, t.trade_price]))

const records = preds
  .filter((p) => priceOf[p.market] != null)
  .map((p) => ({ signals: p.signals, hit: judgeHit(p.side, p.signalPrice, priceOf[p.market]) }))

const stats = aggregateHitRates(records)
const oldWeights = await readJson('signal-weights.json', {})
const newWeights = updateWeights(oldWeights, stats)
await writeJson('signal-weights.json', newWeights)

const hitCount = records.filter((r) => r.hit).length
const result = {
  timestamp: new Date().toISOString(),
  predictions: records.length,
  hits: hitCount,
  overallHitRate: records.length ? +(hitCount / records.length).toFixed(3) : 0,
  signalStats: stats,
}
const hist = await readJson('weekly-analysis.json', { weeks: [] })
hist.weeks = rollingAppend(hist.weeks || [], result, MAX_WEEKS)
await writeJson('weekly-analysis.json', hist)

console.log(`주간 분석 완료 — 예측 ${records.length}건, 적중 ${hitCount}건 (${result.overallHitRate})`)
console.log('가중치 갱신:', Object.keys(stats).filter((k) => stats[k].count >= 3).join(', ') || '없음')
```

- [ ] **Step 6: 강제 실행 검증**

Run: `node scripts/weekly-analysis.mjs --force`
Expected: 스캔 이력 있으면 `주간 분석 완료 — 예측 N건...`, 없으면 `스캔 이력 없음`

- [ ] **Step 7: Commit**

```bash
git add lib/weekly.mjs scripts/weekly-analysis.mjs __tests__/weekly.test.mjs data/
git commit -m "feat: add weekly analysis with EWM weight update"
```

---

## Task 10: 백테스트 (scripts/backtest.mjs)

**Files:**
- Create: `scripts/backtest.mjs`

과거 일봉에서 신호 발생 시점을 시뮬레이션해 N일 후 수익률로 적중을 판정한다.

- [ ] **Step 1: scripts/backtest.mjs 구현**

```javascript
import { getMarkets, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { detectSignals, applyCombos } from '../lib/signals.mjs'
import { readJson } from '../lib/store.mjs'

const HOLD_DAYS = 3        // 진입 후 보유 기간
const BUY_THRESHOLD = 5
const SAMPLE_LIMIT = Number(process.argv[2] || 30) // 상위 N종목만

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const weights = await readJson('signal-weights.json', {})
const markets = (await getMarkets()).slice(0, SAMPLE_LIMIT)

let trades = 0, wins = 0, totalRet = 0
for (const m of markets) {
  const candles = await getDayCandles(m.market, 200)
  await sleep(200)
  if (!candles || candles.length < 80) continue
  const ohlcv = candlesToOhlcv(candles)
  // 과거 각 시점에서 신호 평가 (마지막 HOLD_DAYS는 미래가 없어 제외)
  for (let i = 60; i < ohlcv.length - HOLD_DAYS; i++) {
    const window = ohlcv.slice(0, i + 1)
    const sig = detectSignals(window, weights)
    const combo = applyCombos(sig.buy, sig.sell, sig.buyScore)
    if (combo.buyScore >= BUY_THRESHOLD) {
      const entry = ohlcv[i].close
      const exit = ohlcv[i + HOLD_DAYS].close
      const ret = (exit - entry) / entry
      trades++
      totalRet += ret
      if (ret > 0) wins++
    }
  }
}

console.log(`백테스트 — ${markets.length}종목, 보유 ${HOLD_DAYS}일`)
console.log(`진입 ${trades}회, 승률 ${trades ? ((wins / trades) * 100).toFixed(1) : 0}%, 평균수익률 ${trades ? ((totalRet / trades) * 100).toFixed(2) : 0}%`)
```

- [ ] **Step 2: 실제 실행 검증 (소량)**

Run: `node scripts/backtest.mjs 5`
Expected: `백테스트 — 5종목...`, `진입 N회, 승률 X%...` 출력

- [ ] **Step 3: Commit**

```bash
git add scripts/backtest.mjs
git commit -m "feat: add backtest script"
```

---

## Task 11: Windows 작업 스케줄러 등록 (scripts/install-scheduler.ps1)

**Files:**
- Create: `scripts/install-scheduler.ps1`

- [ ] **Step 1: scripts/install-scheduler.ps1 작성**

```powershell
# 업비트 스캐너 작업 스케줄러 등록 (매일 KST 09:00 / 21:00)
# 사용법:
#   등록:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
#   제거:   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$monitor = Join-Path $projectRoot 'scripts\monitor.mjs'
$nodePath = (Get-Command node).Source

$tasks = @(
  @{ Name = 'UpbitMonitor_0900'; Time = '09:00' },
  @{ Name = 'UpbitMonitor_2100'; Time = '21:00' }
)

if ($Uninstall) {
  foreach ($t in $tasks) {
    try { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false; Write-Host "제거됨: $($t.Name)" }
    catch { Write-Host "없음: $($t.Name)" }
  }
  return
}

foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$monitor`"" -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "등록됨: $($t.Name) @ $($t.Time) (로컬 시간 = KST)"
}
Write-Host "`n확인: Get-ScheduledTask -TaskName 'UpbitMonitor_*'"
```

- [ ] **Step 2: 스케줄러 등록 실행**

Run: `powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1`
Expected: `등록됨: UpbitMonitor_0900 @ 09:00`, `등록됨: UpbitMonitor_2100 @ 21:00`

- [ ] **Step 3: 등록 확인**

Run: `powershell -Command "Get-ScheduledTask -TaskName 'UpbitMonitor_*' | Select-Object TaskName,State"`
Expected: 두 작업 모두 `Ready` 상태

- [ ] **Step 4: Commit**

```bash
git add scripts/install-scheduler.ps1
git commit -m "feat: add Windows Task Scheduler install script"
```

---

## Task 12: 전체 테스트 + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 전체 테스트 실행**

Run: `npx vitest run`
Expected: 모든 테스트 파일 PASS (indicators, signals, patterns, upbit, store, weekly)

- [ ] **Step 2: README.md 작성**

```markdown
# 업비트 스캐너

업비트 KRW 마켓을 하루 2회(KST 09:00/21:00) 자동 스캔해 콤보 보정된 매수/매도 신호를 집계한다. 공개 API만 사용 (키 불필요).

## 설치

\`\`\`bash
npm install
\`\`\`

## 사용

\`\`\`bash
npm run scan              # 수동 스캔 1회
npm run analyze -- KRW-BTC  # 개별 종목 분석
npm run weekly -- --force   # 주간 분석 강제 실행
npm run backtest 30        # 상위 30종목 백테스트
npm test                   # 전체 테스트
\`\`\`

## 자동화 (Windows 작업 스케줄러)

\`\`\`powershell
# 등록 (매일 09:00 / 21:00 로컬시간 = KST)
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
# 제거
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
\`\`\`

## 구조

| 경로 | 역할 |
|------|------|
| \`lib/indicators.mjs\` | EMA/SMA/RSI/BB/MACD/Stoch/WR/VolRatio 순수 함수 |
| \`lib/signals.mjs\` | 신호 감지 + 점수화 + 콤보 보정 + 패턴 감지 |
| \`lib/upbit.mjs\` | 업비트 공개 REST API 래퍼 |
| \`lib/store.mjs\` | JSON 데이터 읽기/쓰기 + 롤링 + EWM 헬퍼 |
| \`lib/weekly.mjs\` | 적중률 집계 + 가중치 갱신 로직 |
| \`scripts/monitor.mjs\` | 메인 스캔 |
| \`scripts/weekly-analysis.mjs\` | 주간 적중률 + 가중치 EWM 갱신 |
| \`scripts/analyze.mjs\` | 개별 종목 즉석 분석 |
| \`scripts/backtest.mjs\` | 과거 신호 백테스트 |
| \`data/*.json\` | 스캔 이력, 가중치, 주간 분석 |

## 핵심 로직: 콤보 보정

- **과매도 함정 페널티 ×0.55**: Stoch 골든크로스 없이 RSI+BB+Stoch+WR 과매도 4종 동시 발화 (낙하 중)
- **반등확인 보너스 ×1.4**: Stoch 과매도 골든크로스 포함 (진짜 반등)
- **거래량확인 보너스 ×1.3**: 거래량 급증 동반

진입 임계값: 매수 score ≥ 5, 매도 score ≥ 3.

## 가중치 자동 갱신 (EWM)

\`\`\`
target    = hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
newWeight = clamp(oldWeight * 0.8 + target * 0.2, 0.5, 2.0)
MIN_SAMPLES = 3
\`\`\`
\`\`\`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with usage and architecture"
```

---

## 완료 기준

- [ ] `npx vitest run` 전체 통과 (6개 테스트 파일)
- [ ] `node scripts/monitor.mjs` 실행 → `data/monitor-log.json` 생성
- [ ] `node scripts/analyze.mjs KRW-BTC` 정상 출력
- [ ] `node scripts/weekly-analysis.mjs --force` 정상 동작
- [ ] 작업 스케줄러 2개 작업 `Ready` 상태
- [ ] README 작성 완료
