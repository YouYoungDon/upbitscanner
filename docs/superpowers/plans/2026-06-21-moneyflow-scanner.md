# 자금유입 스캐너 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 분봉 머니플로우·가속도·돌파로 "자금이 막 들어오는" 코인을 3시간 주기로 포착하는 제3의 스캐너를 추가한다.

**Architecture:** 순수 함수 모듈(`lib/moneyflow.mjs` 점수 로직, `lib/flow-alert.mjs` 중복억제)을 TDD로 만들고, `scripts/flow-scan.mjs`가 업비트 분봉을 조립한다. 대시보드 `💸 자금유입` 탭으로 노출. 기존 공용 모듈(upbit·scan-universe·indicators·store·notify·server) 재활용.

**Tech Stack:** Node.js 24 ESM, Vitest, 제로 의존성. 업비트 공개 API.

---

## 배경 지식 (구현자가 알아야 할 것)

- **모든 bash 명령은 `cd /c/Users/toodo/workspace/upbit-dashboard &&` 프리픽스 필요** (작업 디렉토리 리셋됨). 테스트: `npx vitest run <path>`, 전체: `npm test`.
- 브랜치 `moneyflow-scanner`(master 기반). 베이스라인 112 테스트 통과.
- `lib/upbit.mjs`: `getMinuteCandles(market, unit, count)` (unit=분 단위: 1/5/15…, count≤200), `getTicker(markets[])`, `candlesToOhlcv(candles)`. 원시 분봉은 **최신→과거**, `candlesToOhlcv`가 **과거→최신**으로 reverse. 원시 분봉 필드: `candle_acc_trade_price`(KRW 거래대금), `trade_price`(종가), `high_price`, `low_price`, `opening_price`, `candle_acc_trade_volume`.
- `candlesToOhlcv` 출력 원소: `{ time, open, close, high, low, volume }` (현재 `tradeValue` 없음 — Task 1에서 추가).
- `lib/indicators.mjs`: `calcEMA(d, p)` → **EMA 시리즈 배열**(길이=d, d[0] 시드), `calcRSI(c, p=14)` → 마지막 RSI 또는 `c.length<p+1`이면 `null`.
- `lib/scan-universe.mjs`: `getScanUniverse({ minTradePrice })` → `{ targets, nameOf, total, tradePrice }`. `BATCH`(5), `DELAY`(200), `sleep`.
- `lib/store.mjs`: `readJson(name, fallback)`, `writeJson(name, data)`, `rollingAppend(arr, item, max)`.
- `lib/notify.mjs`: `sendTelegram(text)` (env 없으면 no-op).
- `getTicker` 원소 필드: `trade_price`, `high_price`(당일 고가), `signed_change_rate`(24h 변화율), `acc_trade_price_24h`.

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|----------|
| `lib/upbit.mjs` | `candlesToOhlcv`에 `tradeValue` 추가 | 수정 |
| `lib/moneyflow.mjs` | CONFIG + 머니플로우·가격변화·게이트·돌파·추세·점수·레벨 | 신규 |
| `lib/flow-alert.mjs` | 중복 억제 판정 | 신규 |
| `scripts/flow-scan.mjs` | 3시간 스캔 오케스트레이션 | 신규 |
| `server/api.mjs` | `buildFlow` | 수정 |
| `server/server.mjs` | `/api/flow` | 수정 |
| `public/index.html`, `public/app.js` | `💸 자금유입` 탭 | 수정 |
| `scripts/install-scheduler.ps1`, `README.md` | UpbitFlow 태스크·문서 | 수정 |

---

## Task 1: candlesToOhlcv에 tradeValue 추가

**Files:** Modify `lib/upbit.mjs:47-56`. Test: `__tests__/upbit.tradevalue.test.mjs` (신규).

- [ ] **Step 1: 실패 테스트**

`__tests__/upbit.tradevalue.test.mjs`:
```js
import { describe, it, expect } from 'vitest'
import { candlesToOhlcv } from '../lib/upbit.mjs'

describe('candlesToOhlcv tradeValue', () => {
  it('원시 분봉 candle_acc_trade_price를 tradeValue로 매핑(과거→최신)', () => {
    const raw = [
      { candle_date_time_utc: '2026-06-21T00:05:00', opening_price: 10, trade_price: 11, high_price: 12, low_price: 9, candle_acc_trade_volume: 100, candle_acc_trade_price: 2000 },
      { candle_date_time_utc: '2026-06-21T00:00:00', opening_price: 9, trade_price: 10, high_price: 10, low_price: 8, candle_acc_trade_volume: 50, candle_acc_trade_price: 1000 },
    ]
    const o = candlesToOhlcv(raw)
    expect(o.map((c) => c.tradeValue)).toEqual([1000, 2000]) // reverse: 과거→최신
    expect(o.at(-1).close).toBe(11)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/upbit.tradevalue.test.mjs`
Expected: FAIL — `tradeValue` undefined.

- [ ] **Step 3: 구현**

`lib/upbit.mjs`의 `candlesToOhlcv` map 객체에 한 줄 추가:
```js
export function candlesToOhlcv(candles) {
  return [...candles].reverse().map((c) => ({
    time: c.candle_date_time_utc ? Math.floor(new Date(c.candle_date_time_utc + 'Z').getTime() / 1000) : undefined,
    open: c.opening_price,
    close: c.trade_price,
    high: c.high_price,
    low: c.low_price,
    volume: c.candle_acc_trade_volume,
    tradeValue: c.candle_acc_trade_price,
  }))
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npm test`
Expected: 전체 PASS (신규 + 기존 112 — 추가 필드라 무영향).

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/upbit.mjs __tests__/upbit.tradevalue.test.mjs && git commit -m "feat: candlesToOhlcv에 tradeValue(거래대금) 필드 추가"
```

---

## Task 2: moneyflow CONFIG + 머니플로우/가속도

**Files:** Create `lib/moneyflow.mjs`. Test: `__tests__/moneyflow.test.mjs` (신규).

- [ ] **Step 1: 실패 테스트**

`__tests__/moneyflow.test.mjs`:
```js
import { describe, it, expect } from 'vitest'
import { tradingValues, moneyRatio, moneyAcceleration } from '../lib/moneyflow.mjs'

const ohlcv = (vals) => vals.map((v) => ({ tradeValue: v }))

describe('moneyRatio', () => {
  it('현재 거래대금 / 직전 window 평균', () => {
    const values = [...Array(20).fill(100), 500] // 직전20 평균 100, 현재 500
    expect(moneyRatio(values, 20)).toBe(5)
  })
  it('데이터 부족 → null', () => {
    expect(moneyRatio([100, 200], 20)).toBe(null)
  })
  it('직전 평균 0 → null', () => {
    expect(moneyRatio([...Array(20).fill(0), 500], 20)).toBe(null)
  })
})

describe('moneyAcceleration', () => {
  it('직전 봉 비율 대비 현재 봉 비율(가속)', () => {
    // 직전20 평균 100. 끝-1봉=200(비율2), 끝봉=400 but 그 직전20 평균은 (19×100+200)/20=105 → 비율≈3.81
    const values = [...Array(20).fill(100), 200, 400]
    const a = moneyAcceleration(values, 20)
    expect(a).toBeGreaterThan(1) // 가속
  })
  it('데이터 부족 → null', () => {
    expect(moneyAcceleration([...Array(20).fill(100)], 20)).toBe(null)
  })
})

describe('tradingValues', () => {
  it('ohlcv에서 tradeValue 추출', () => {
    expect(tradingValues(ohlcv([1, 2, 3]))).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`lib/moneyflow.mjs`:
```js
import { calcEMA, calcRSI } from './indicators.mjs'

export const CONFIG = {
  minTradePrice24h: 10_000_000_000, // 유니버스 24h 하한 (100억)
  moneyWindow: 20,                  // 머니비율 직전 평균 봉 수
  min5mValue: 500_000_000,          // 5m 현재 거래대금 게이트 (5억)
  value5mBonus: 1_000_000_000,      // 5m 거래대금 보너스 임계 (10억)
  accelStrong: 1.5,                 // 머니가속도 보너스 임계
  exclude5mPct: 8,                  // 5m 변화 > +8% 하드배제
  exclude15mPct: 15,                // 15m 변화 > +15% 하드배제
  early1mMin: 0.5, early1mMax: 2.5, // 조기존 1m 범위(%)
  early30mMax: 10,                  // 조기존 30m 상한(%)
  breakoutLookback: 20,             // 돌파 직전 N개 5분봉
  near24hPct: 2,                    // 24h 고가 근접(%)
  consolRangePct: 3,                // consolidation 레인지 타이트(%)
  rsiMin: 50, rsiMax: 75,
  btcDropPct: -1,                   // BTC 5m < -1% → 감점
  btcPenalty: 0.8,
  suppressMs: 6 * 60 * 60 * 1000,   // 중복 억제창(6시간)
  reAlertRatio: 1.3,                // 점수 30%↑ 재알림
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length

export function tradingValues(ohlcv) {
  return (ohlcv || []).map((c) => c.tradeValue ?? 0)
}

export function moneyRatio(values, window = CONFIG.moneyWindow) {
  if (!values || values.length < window + 1) return null
  const avg = mean(values.slice(-1 - window, -1))
  if (!avg) return null
  return values.at(-1) / avg
}

function ratioAt(values, i, window) {
  if (i - window < 0) return null
  const avg = mean(values.slice(i - window, i))
  if (!avg) return null
  return values[i] / avg
}

export function moneyAcceleration(values, window = CONFIG.moneyWindow) {
  if (!values || values.length < window + 2) return null
  const last = values.length - 1
  const cur = ratioAt(values, last, window)
  const prev = ratioAt(values, last - 1, window)
  if (cur == null || prev == null || !prev) return null
  return cur / prev
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/moneyflow.mjs __tests__/moneyflow.test.mjs && git commit -m "feat: moneyflow CONFIG + 머니비율·머니가속도"
```

---

## Task 3: 가격변화 + 모멘텀 게이트

**Files:** Modify `lib/moneyflow.mjs`. Test: `__tests__/moneyflow.test.mjs`.

- [ ] **Step 1: 실패 테스트** (append to `__tests__/moneyflow.test.mjs`)

```js
import { pctChange, isPumped, isEarlyZone } from '../lib/moneyflow.mjs'

describe('pctChange', () => {
  it('nBack 전 종가 대비 변화율(%)', () => {
    expect(pctChange([100, 110], 1)).toBeCloseTo(10, 5)
    expect(pctChange([100, 103, 90], 2)).toBeCloseTo(-10, 5)
  })
  it('데이터 부족 → null', () => {
    expect(pctChange([100], 1)).toBe(null)
  })
})

describe('isPumped', () => {
  it('5m>+8% 또는 15m>+15%면 true(이미 급등 배제)', () => {
    expect(isPumped(9, 0)).toBe(true)
    expect(isPumped(0, 16)).toBe(true)
    expect(isPumped(3, 5)).toBe(false)
  })
  it('null은 무시', () => {
    expect(isPumped(null, null)).toBe(false)
  })
})

describe('isEarlyZone', () => {
  it('1m 0.5~2.5% & 30m<10%', () => {
    expect(isEarlyZone(1.0, 5)).toBe(true)
    expect(isEarlyZone(3.0, 5)).toBe(false) // 1m 초과
    expect(isEarlyZone(1.0, 12)).toBe(false) // 30m 초과
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: FAIL — 함수 없음.

- [ ] **Step 3: 구현** (append to `lib/moneyflow.mjs`)

```js
export function pctChange(closes, nBack) {
  if (!closes || closes.length < nBack + 1) return null
  const base = closes.at(-1 - nBack)
  if (!base) return null
  return (closes.at(-1) / base - 1) * 100
}

export function isPumped(ch5m, ch15m) {
  return (ch5m != null && ch5m > CONFIG.exclude5mPct) || (ch15m != null && ch15m > CONFIG.exclude15mPct)
}

export function isEarlyZone(ch1m, ch30m) {
  return ch1m != null && ch30m != null &&
    ch1m >= CONFIG.early1mMin && ch1m <= CONFIG.early1mMax && ch30m < CONFIG.early30mMax
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/moneyflow.mjs __tests__/moneyflow.test.mjs && git commit -m "feat: 가격변화 + 모멘텀 게이트(급등배제·조기존)"
```

---

## Task 4: 돌파 + 추세 확인

**Files:** Modify `lib/moneyflow.mjs`. Test: `__tests__/moneyflow.test.mjs`.

- [ ] **Step 1: 실패 테스트** (append)

```js
import { breakout20, near24hHigh, isConsolidationBreakout, emaAligned, rsiOk } from '../lib/moneyflow.mjs'

const bar = (high, low, close) => ({ high, low, close })

describe('breakout20', () => {
  it('현재가가 직전 20봉 최고가 초과', () => {
    const o = [...Array(20).fill(bar(10, 9, 10)), bar(12, 10, 11)]
    expect(breakout20(o, 20)).toBe(true)
  })
  it('초과 못하면 false', () => {
    const o = [...Array(20).fill(bar(10, 9, 10)), bar(10, 9, 9.5)]
    expect(breakout20(o, 20)).toBe(false)
  })
})

describe('near24hHigh', () => {
  it('24h 고가의 2% 이내', () => {
    expect(near24hHigh(99, 100, 2)).toBe(true)
    expect(near24hHigh(97, 100, 2)).toBe(false)
  })
})

describe('isConsolidationBreakout', () => {
  it('타이트 레인지(<3%) 후 돌파', () => {
    const o = [...Array(20).fill(bar(100, 99, 99.5)), bar(105, 100, 104)]
    expect(isConsolidationBreakout(o, 20, 3)).toBe(true)
  })
  it('레인지 넓으면 false', () => {
    const o = [...Array(20).fill(0).map((_, i) => bar(100 + i, 90, 95)), bar(130, 120, 125)]
    expect(isConsolidationBreakout(o, 20, 3)).toBe(false)
  })
})

describe('emaAligned', () => {
  it('상승추세 EMA5>EMA20>EMA60', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i)
    expect(emaAligned(closes)).toBe(true)
  })
  it('데이터<60 → false', () => {
    expect(emaAligned([1, 2, 3])).toBe(false)
  })
})

describe('rsiOk', () => {
  it('RSI 50~75 범위', () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i * 0.3)
    expect(rsiOk(up)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현** (append to `lib/moneyflow.mjs`)

```js
export function breakout20(ohlcv, lookback = CONFIG.breakoutLookback) {
  if (!ohlcv || ohlcv.length < lookback + 1) return false
  const prevHighs = ohlcv.slice(-1 - lookback, -1).map((c) => c.high)
  return ohlcv.at(-1).close > Math.max(...prevHighs)
}

export function near24hHigh(price, high24h, pct = CONFIG.near24hPct) {
  if (!price || !high24h) return false
  return price >= high24h * (1 - pct / 100)
}

export function isConsolidationBreakout(ohlcv, lookback = CONFIG.breakoutLookback, rangePct = CONFIG.consolRangePct) {
  if (!breakout20(ohlcv, lookback)) return false
  const seg = ohlcv.slice(-1 - lookback, -1)
  const hi = Math.max(...seg.map((c) => c.high)), lo = Math.min(...seg.map((c) => c.low))
  if (!lo) return false
  return (hi - lo) / lo < rangePct / 100
}

export function emaAligned(closes) {
  if (!closes || closes.length < 60) return false
  const e5 = calcEMA(closes, 5).at(-1)
  const e20 = calcEMA(closes, 20).at(-1)
  const e60 = calcEMA(closes, 60).at(-1)
  return e5 > e20 && e20 > e60
}

export function rsiOk(closes) {
  const r = calcRSI(closes)
  return r != null && r >= CONFIG.rsiMin && r <= CONFIG.rsiMax
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/moneyflow.mjs __tests__/moneyflow.test.mjs && git commit -m "feat: 돌파(20봉·24h고가·consolidation) + 추세확인(EMA정배열·RSI)"
```

---

## Task 5: 종합점수 + 알림 레벨

**Files:** Modify `lib/moneyflow.mjs`. Test: `__tests__/moneyflow.test.mjs`.

- [ ] **Step 1: 실패 테스트** (append)

```js
import { scoreFlow, alertLevel } from '../lib/moneyflow.mjs'

describe('scoreFlow', () => {
  it('전 항목 충족 → 100', () => {
    const { score } = scoreFlow({ ratio: 6, accel: 2, value5m: 2_000_000_000, breakout: true, near24h: true, emaOK: true, rsiOK: true, early: true, btcFavorable: true, btcBad: false })
    expect(score).toBe(100)
  })
  it('머니비율 등급(5/3/2x)', () => {
    expect(scoreFlow({ ratio: 5 }).parts.money).toBe(30)
    expect(scoreFlow({ ratio: 3 }).parts.money).toBe(20)
    expect(scoreFlow({ ratio: 2 }).parts.money).toBe(10)
    expect(scoreFlow({ ratio: 1.5 }).parts.money).toBeUndefined()
  })
  it('btcBad → ×0.8', () => {
    const full = scoreFlow({ ratio: 6, accel: 2, value5m: 2_000_000_000, breakout: true, near24h: true, emaOK: true, rsiOK: true, early: true, btcFavorable: false, btcBad: true })
    expect(full.score).toBe(76) // (100-5btc)=95 ×0.8=76
  })
  it('0~100 클램프, 빈 입력 → 0', () => {
    expect(scoreFlow({}).score).toBe(0)
  })
})

describe('alertLevel', () => {
  it('strong: ratio≥3 + 돌파 + BTC우호', () => {
    expect(alertLevel({ ratio: 3, breakout: true, btcFavorable: true })).toBe('strong')
  })
  it('attention: ratio≥2 + 돌파', () => {
    expect(alertLevel({ ratio: 2, breakout: true, btcFavorable: false })).toBe('attention')
  })
  it('watch: ratio≥2', () => {
    expect(alertLevel({ ratio: 2, breakout: false, btcFavorable: false })).toBe('watch')
  })
  it('ratio<2 → null', () => {
    expect(alertLevel({ ratio: 1.5, breakout: true, btcFavorable: true })).toBe(null)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: FAIL.

- [ ] **Step 3: 구현** (append to `lib/moneyflow.mjs`)

```js
export function scoreFlow({ ratio, accel, value5m, breakout, near24h, emaOK, rsiOK, early, btcFavorable, btcBad } = {}) {
  const parts = {}
  if (ratio != null) {
    if (ratio >= 5) parts.money = 30
    else if (ratio >= 3) parts.money = 20
    else if (ratio >= 2) parts.money = 10
  }
  if (accel != null && accel >= CONFIG.accelStrong) parts.accel = 5
  if (value5m != null && value5m > CONFIG.value5mBonus) parts.value = 15
  if (breakout) parts.breakout = 15
  if (near24h) parts.near24h = 10
  if (emaOK) parts.ema = 10
  if (rsiOK) parts.rsi = 5
  if (early) parts.early = 5
  if (btcFavorable) parts.btc = 5
  let s = Object.values(parts).reduce((a, b) => a + b, 0)
  if (btcBad) s *= CONFIG.btcPenalty
  return { score: Math.max(0, Math.min(100, Math.round(s))), parts }
}

export function alertLevel({ ratio, breakout, btcFavorable } = {}) {
  if (ratio == null || ratio < 2) return null
  if (ratio >= 3 && breakout && btcFavorable) return 'strong'
  if (ratio >= 2 && breakout) return 'attention'
  return 'watch'
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/moneyflow.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/moneyflow.mjs __tests__/moneyflow.test.mjs && git commit -m "feat: 종합점수(0~100)·BTC×0.8 + 알림레벨 3단"
```

---

## Task 6: 중복 알림 억제 모듈

**Files:** Create `lib/flow-alert.mjs`. Test: `__tests__/flow-alert.test.mjs` (신규).

- [ ] **Step 1: 실패 테스트**

`__tests__/flow-alert.test.mjs`:
```js
import { describe, it, expect } from 'vitest'
import { shouldAlert, updateAlertState } from '../lib/flow-alert.mjs'

const cfg = { suppressMs: 6 * 60 * 60 * 1000, reAlertRatio: 1.3 }
const now = 1_000_000_000_000

describe('shouldAlert', () => {
  it('신규 종목 → true', () => {
    expect(shouldAlert({ market: 'KRW-A', score: 50, now }, {}, cfg)).toBe(true)
  })
  it('억제창 내 + 점수 미상승 → false', () => {
    const state = { 'KRW-A': { lastScore: 50, lastAlertTs: now - 1000 } }
    expect(shouldAlert({ market: 'KRW-A', score: 55, now }, state, cfg)).toBe(false)
  })
  it('억제창 내 + 점수 30%↑ → true', () => {
    const state = { 'KRW-A': { lastScore: 50, lastAlertTs: now - 1000 } }
    expect(shouldAlert({ market: 'KRW-A', score: 65, now }, state, cfg)).toBe(true)
  })
  it('억제창 경과 → true', () => {
    const state = { 'KRW-A': { lastScore: 50, lastAlertTs: now - cfg.suppressMs - 1 } }
    expect(shouldAlert({ market: 'KRW-A', score: 40, now }, state, cfg)).toBe(true)
  })
})

describe('updateAlertState', () => {
  it('종목 상태 갱신(불변)', () => {
    const s0 = {}
    const s1 = updateAlertState(s0, 'KRW-A', 60, now)
    expect(s1['KRW-A']).toEqual({ lastScore: 60, lastAlertTs: now })
    expect(s0).toEqual({}) // 원본 불변
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/flow-alert.test.mjs`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`lib/flow-alert.mjs`:
```js
// 자금유입 알림 중복 억제. state: { [market]: { lastScore, lastAlertTs } }.
export function shouldAlert({ market, score, now }, state = {}, cfg) {
  const prev = state[market]
  if (!prev) return true
  if (now - prev.lastAlertTs >= cfg.suppressMs) return true
  if (score >= prev.lastScore * cfg.reAlertRatio) return true
  return false
}

export function updateAlertState(state = {}, market, score, now) {
  return { ...state, [market]: { lastScore: score, lastAlertTs: now } }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/flow-alert.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/flow-alert.mjs __tests__/flow-alert.test.mjs && git commit -m "feat: 자금유입 중복 알림 억제 모듈"
```

---

## Task 7: flow-scan 오케스트레이션

**Files:** Create `scripts/flow-scan.mjs`. Add npm script.

- [ ] **Step 1: 스크립트 작성**

`scripts/flow-scan.mjs`:
```js
import { getMinuteCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { getScanUniverse, BATCH, DELAY, sleep } from '../lib/scan-universe.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import { shouldAlert, updateAlertState } from '../lib/flow-alert.mjs'
import {
  CONFIG, tradingValues, moneyRatio, moneyAcceleration, pctChange,
  isPumped, isEarlyZone, breakout20, near24hHigh, isConsolidationBreakout,
  emaAligned, rsiOk, scoreFlow, alertLevel,
} from '../lib/moneyflow.mjs'

const MAX_SCANS = 30
const FIVE_MIN_COUNT = 80
const LEVEL_EMOJI = { strong: '🔴', attention: '🟠', watch: '🟡' }

async function main() {
  const { targets, nameOf, tradePrice } = await getScanUniverse({ minTradePrice: CONFIG.minTradePrice24h })
  if (!targets.length) { console.error('자금유입 스캔 대상 없음'); process.exit(1) }
  console.log(`자금유입 스캔 대상 ${targets.length}종목 (24h≥${CONFIG.minTradePrice24h / 1e8}억)`)

  // BTC 5m 컨텍스트
  const btcC = await getMinuteCandles('KRW-BTC', 5, 3)
  const btcCloses = btcC ? candlesToOhlcv(btcC).map((c) => c.close) : []
  const btc5mRet = pctChange(btcCloses, 1)
  const btcFavorable = btc5mRet != null && btc5mRet > 0
  const btcBad = btc5mRet != null && btc5mRet < CONFIG.btcDropPct
  console.log(`BTC 5m: ${btc5mRet == null ? 'n/a' : btc5mRet.toFixed(2) + '%'} (${btcBad ? '약세감점' : btcFavorable ? '우호' : '중립'})`)

  // 24h 컨텍스트 티커
  const tickers = []
  for (let i = 0; i < targets.length; i += 100) { const t = await getTicker(targets.slice(i, i + 100)); if (t) tickers.push(...t); await sleep(DELAY) }
  const high24hOf = Object.fromEntries(tickers.map((t) => [t.market, t.high_price]))
  const ch24hOf = Object.fromEntries(tickers.map((t) => [t.market, (t.signed_change_rate ?? 0) * 100]))

  const picks = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const c5 = await getMinuteCandles(market, 5, FIVE_MIN_COUNT)
      if (!c5 || c5.length < CONFIG.moneyWindow + 2) return
      const o5 = candlesToOhlcv(c5)
      const closes5 = o5.map((c) => c.close)
      const values = tradingValues(o5)
      const value5m = values.at(-1)
      if (value5m < CONFIG.min5mValue) return // 절대 거래대금 게이트

      const ch5m = pctChange(closes5, 1)
      const ch15m = pctChange(closes5, 3)
      const ch30m = pctChange(closes5, 6)
      if (isPumped(ch5m, ch15m)) return // 이미 급등 배제

      const c1 = await getMinuteCandles(market, 1, 3)
      const closes1 = c1 ? candlesToOhlcv(c1).map((c) => c.close) : []
      const ch1m = pctChange(closes1, 1)

      const ratio = moneyRatio(values)
      const accel = moneyAcceleration(values)
      const price = closes5.at(-1)
      const breakout = breakout20(o5)
      const consol = isConsolidationBreakout(o5)
      const near24h = near24hHigh(price, high24hOf[market])
      const emaOK = emaAligned(closes5)
      const rsiOK = rsiOk(closes5)
      const early = isEarlyZone(ch1m, ch30m)
      const { score, parts } = scoreFlow({ ratio, accel, value5m, breakout, near24h, emaOK, rsiOK, early, btcFavorable, btcBad })
      const level = alertLevel({ ratio, breakout, btcFavorable })
      if (!level) return

      picks.push({
        market, korean_name: nameOf[market], price, score, level, parts,
        ratio: ratio == null ? null : +ratio.toFixed(2),
        accel: accel == null ? null : +accel.toFixed(2),
        value5m, ch1m, ch5m, ch15m, ch30m, ch24h: ch24hOf[market] ?? null,
        breakout, consol, near24h, emaOK,
        rsi: rsiOK,
      })
    }))
    await sleep(DELAY)
  }

  // 랭킹: 종합점수 → 머니비율 → 돌파
  picks.sort((a, b) => b.score - a.score || (b.ratio ?? 0) - (a.ratio ?? 0) || (b.breakout ? 1 : 0) - (a.breakout ? 1 : 0))

  const entry = { timestamp: new Date().toISOString(), btc: { ret: btc5mRet, favorable: btcFavorable, bad: btcBad }, picks }
  const log = await readJson('flow-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  log.totalScans = (log.totalScans || 0) + 1
  log.scans = rollingAppend(log.scans || [], entry, MAX_SCANS)
  await writeJson('flow-log.json', log)

  const counts = { strong: 0, attention: 0, watch: 0 }
  for (const p of picks) counts[p.level]++
  console.log(`자금유입 스캔 #${log.totalScans} — 🔴${counts.strong} 🟠${counts.attention} 🟡${counts.watch}`)
  console.log('상위:', picks.slice(0, 5).map((p) => `${p.korean_name}(${p.score})`).join(', ') || '없음')

  await notifyFlow(picks)
}

// strong/attention만, 중복 억제 적용
async function notifyFlow(picks) {
  const now = Date.now()
  let state = await readJson('flow-alert-state.json', {})
  const fire = picks.filter((p) => (p.level === 'strong' || p.level === 'attention') && shouldAlert({ market: p.market, score: p.score, now }, state, CONFIG))
  for (const p of fire) state = updateAlertState(state, p.market, p.score, now)
  await writeJson('flow-alert-state.json', state)
  if (!fire.length) return
  const lines = fire.map((p) => `${LEVEL_EMOJI[p.level]} ${p.korean_name}(${p.market.replace('KRW-', '')}) ${p.score}점 · 머니 ${p.ratio}x${p.accel ? ` ·가속 ${p.accel}x` : ''}${p.breakout ? ' ·돌파' : ''}`)
  const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  await sendTelegram(`💸 자금유입 ${when}\n\n${lines.join('\n')}`)
}

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 자금유입 스캔 실패: ${e.message}`); process.exit(1) })
```

- [ ] **Step 2: package.json에 스크립트 추가**

`package.json`의 `scripts`에 추가(기존 줄들 사이, 쉼표 유지):
```json
    "flow": "node scripts/flow-scan.mjs",
```

- [ ] **Step 3: 라이브 실행 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node scripts/flow-scan.mjs 2>&1 | tail -6`
Expected: `자금유입 스캔 #N — 🔴.. 🟠.. 🟡..` 출력, 에러/스택트레이스 없음. `data/flow-log.json` 생성됨.

- [ ] **Step 4: 회귀 + 커밋**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npm test`
Expected: 전체 PASS.

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add scripts/flow-scan.mjs package.json && git commit -m "feat: flow-scan 오케스트레이션(3시간 자금유입 스캔)"
```

---

## Task 8: API buildFlow + 라우트

**Files:** Modify `server/api.mjs`, `server/server.mjs`. Test: `__tests__/api.test.mjs`.

- [ ] **Step 1: 실패 테스트** (append to `__tests__/api.test.mjs`)

```js
import { buildFlow } from '../server/api.mjs'

describe('buildFlow', () => {
  it('빈 로그 → empty', () => {
    expect(buildFlow({ scans: [] }).empty).toBe(true)
  })
  it('최신 스캔의 picks·btc·레벨 KPI', () => {
    const log = { totalScans: 2, scans: [{ timestamp: 't', btc: { ret: 0.5, favorable: true }, picks: [
      { market: 'KRW-A', level: 'strong', score: 80 },
      { market: 'KRW-B', level: 'watch', score: 30 },
    ] }] }
    const r = buildFlow(log)
    expect(r.empty).toBe(false)
    expect(r.kpi).toEqual({ strong: 1, attention: 0, watch: 1, totalScans: 2 })
    expect(r.picks.length).toBe(2)
    expect(r.btc.favorable).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/api.test.mjs`
Expected: FAIL — buildFlow 없음.

- [ ] **Step 3: 구현 (api.mjs)** — `server/api.mjs` 끝에 추가:

```js
// 자금유입 스캔 최신 결과
export function buildFlow(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { strong: 0, attention: 0, watch: 0, totalScans: log?.totalScans || 0 }, picks: [], btc: null }
  const kpi = { strong: 0, attention: 0, watch: 0, totalScans: log.totalScans || 0 }
  for (const p of scan.picks || []) if (kpi[p.level] != null) kpi[p.level]++
  return { empty: false, timestamp: scan.timestamp, btc: scan.btc || null, kpi, picks: scan.picks || [] }
}
```

- [ ] **Step 4: 라우트 (server.mjs)** — import에 `buildFlow` 추가하고 라우트 등록.

`server/server.mjs`의 api.mjs import 줄에 `buildFlow` 추가:
```js
import { buildResults, buildInsights, buildVerify, buildHistory, buildScans, findScanByTimestamp, buildMomentum, buildFlow } from './api.mjs'
```
`/api/momentum` 라우트 블록 바로 아래에 추가:
```js
    if (p === '/api/flow') {
      return sendJson(res, 200, buildFlow(await readJson('flow-log.json', { scans: [] })))
    }
```

- [ ] **Step 5: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/api.test.mjs`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add server/api.mjs server/server.mjs __tests__/api.test.mjs && git commit -m "feat: /api/flow + buildFlow(자금유입 KPI·picks)"
```

---

## Task 9: 대시보드 💸 자금유입 탭

**Files:** Modify `public/index.html`, `public/app.js`.

- [ ] **Step 1: 사이드바 탭** — `public/index.html`의 `🚀 모멘텀` 줄 아래에 추가:
```html
        <li><a href="#/flow" data-tab="flow">💸 자금유입</a></li>
```

- [ ] **Step 2: 라우트** — `public/app.js`의 `const routes = {` 객체에 `momentum()` 라우트 바로 뒤에 `flow()` 추가:
```js
  async flow() {
    setActiveTab('flow')
    view.innerHTML = '<h2 class="text-2xl font-bold mb-4">💸 자금유입</h2><span class="loading loading-spinner"></span>'
    const f = await api('/api/flow')
    const emoji = { strong: '🔴', attention: '🟠', watch: '🟡' }
    const won = (v) => v == null ? '-' : (v >= 1e8 ? (v / 1e8).toFixed(1) + '억' : Math.round(v / 1e4) + '만')
    const pct = (v) => v == null ? '-' : `<span class="${v >= 0 ? 'text-success' : 'text-error'}">${v >= 0 ? '+' : ''}${v.toFixed(1)}%</span>`
    const rows = (f.picks || []).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td>${emoji[x.level] || ''} <span class="font-medium">${esc(x.korean_name)}</span> <span class="opacity-50 text-xs">${esc(x.market.replace('KRW-', ''))}</span></td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td>${won(x.value5m)}</td>
        <td>${x.ratio == null ? '-' : x.ratio + 'x'}</td>
        <td>${x.accel == null ? '-' : x.accel + 'x'}</td>
        <td>${pct(x.ch1m)}</td><td>${pct(x.ch5m)}</td><td>${pct(x.ch30m)}</td><td>${pct(x.ch24h)}</td>
        <td>${x.breakout ? '🚀돌파' : x.consol ? '📦수렴' : '-'}</td>
        <td>${x.emaOK ? '✅' : '-'}</td>
        <td>${x.rsi ? '✅' : '-'}</td>
      </tr>`).join('')
    const btc = f.btc ? `BTC 5m ${f.btc.ret == null ? 'n/a' : (f.btc.ret >= 0 ? '+' : '') + f.btc.ret.toFixed(2) + '%'} ${f.btc.bad ? '🔻약세감점' : f.btc.favorable ? '🟢우호' : '⚪중립'}` : ''
    view.innerHTML = `<h2 class="text-2xl font-bold mb-4">💸 자금유입</h2>
      <p class="opacity-60 text-sm mb-2">마지막 스캔: ${f.timestamp ? new Date(f.timestamp).toLocaleString('ko-KR') : '없음'} · 🔴${f.kpi?.strong ?? 0} 🟠${f.kpi?.attention ?? 0} 🟡${f.kpi?.watch ?? 0} · ${btc}</p>
      <div class="card bg-base-200 shadow"><div class="card-body p-3"><div class="overflow-x-auto"><table class="table table-zebra table-xs">
        <thead><tr><th>종목</th><th>점수</th><th>5m대금</th><th>머니비율</th><th>가속</th><th>1m</th><th>5m</th><th>30m</th><th>24h</th><th>돌파</th><th>EMA</th><th>RSI</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="12" class="opacity-60">스캔 기록 없음 (flow-scan 실행 필요)</td></tr>'}</tbody></table></div></div></div>`
  },
```

- [ ] **Step 3: 구문 확인 + 대시보드 육안 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node -c public/app.js`
Expected: SYNTAX OK.

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node server/server.mjs` → 브라우저 `http://127.0.0.1:8787` → `💸 자금유입` 탭에 표 표시 확인 후 종료.

- [ ] **Step 4: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add public/index.html public/app.js && git commit -m "feat: 대시보드 💸 자금유입 탭"
```

---

## Task 10: 스케줄러 3시간 태스크 + README

**Files:** Modify `scripts/install-scheduler.ps1`, `README.md`.

- [ ] **Step 1: 스케줄러** — `scripts/install-scheduler.ps1`은 `$tasks` 배열의 각 항목을 `New-ScheduledTaskTrigger -Daily -At $t.Time`으로 등록한다. 3시간 주기는 8개 일일 트리거(00:05/03:05/…/21:05, monitor 09:00·momentum 09:02와 충돌 피하려 :05 오프셋)로 표현.

`$momentum` 변수 정의 줄 아래에 추가:
```powershell
$flow = Join-Path $projectRoot 'scripts\flow-scan.mjs'
```
`$tasks = @(` 배열의 마지막 항목(`UpbitTrend_2117` 줄) **뒤에 쉼표를 붙이고** 8개 항목 추가:
```powershell
  @{ Name = 'UpbitTrend_2117';    Time = '21:17'; Script = $trend },
  @{ Name = 'UpbitFlow_0005'; Time = '00:05'; Script = $flow },
  @{ Name = 'UpbitFlow_0305'; Time = '03:05'; Script = $flow },
  @{ Name = 'UpbitFlow_0605'; Time = '06:05'; Script = $flow },
  @{ Name = 'UpbitFlow_0905'; Time = '09:05'; Script = $flow },
  @{ Name = 'UpbitFlow_1205'; Time = '12:05'; Script = $flow },
  @{ Name = 'UpbitFlow_1505'; Time = '15:05'; Script = $flow },
  @{ Name = 'UpbitFlow_1805'; Time = '18:05'; Script = $flow },
  @{ Name = 'UpbitFlow_2105'; Time = '21:05'; Script = $flow }
)
```
(기존 마지막 줄 `@{ Name = 'UpbitTrend_2117' ... }` 끝의 닫는 `)`를 제거하고 위처럼 이어붙일 것.)

Uninstall은 `@($tasks.Name + 'UpbitWeekly_Sun')`을 순회하므로 자동 포함 — 별도 수정 불필요.

헤더 주석(1행)도 갱신: `... · 자금유입 3시간(xx:05) · 주간 일 22:00, KST)`.

- [ ] **Step 2: README** — `README.md`의 두 스캐너 표/사용법에 flow 스캐너 행 추가:
  - 표: `| `flow-scan.mjs` | 자금유입 조기포착 (머니플로우·가속도·돌파) | `flow-log.json` | 3시간 |`
  - 사용법: `npm run flow                # 자금유입 스캔 1회`
  - 대시보드 탭 목록에 `💸 자금유입` 추가.

- [ ] **Step 3: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add scripts/install-scheduler.ps1 README.md && git commit -m "feat: 자금유입 스캐너 3시간 스케줄러 + README"
```

---

## 최종 검토 (전체 태스크 후)

- [ ] `npm test` 전체 통과 (기존 112 + 신규)
- [ ] `node scripts/flow-scan.mjs` 라이브 1회 정상 + flow-log.json 생성
- [ ] 대시보드 💸 자금유입 탭 표시 확인
- [ ] superpowers:finishing-a-development-branch 로 브랜치 마무리
