# 스캐너 점수 로직 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래량 크기·유동성·지속성을 스캔 점수에 제대로 반영해 1회성 점화/저유동성 종목의 오탐을 줄인다.

**Architecture:** 순수 함수 계층(`lib/signals.mjs`의 거래량 등급화, `lib/scan-universe.mjs`의 유동성 배수, 신규 `lib/persistence.mjs`의 지속성 점수)을 먼저 TDD로 만들고, `scripts/monitor.mjs`가 이들을 조립한다. 표시 분리는 `server/api.mjs`+`public/app.js`가 `lowLiquidity` 플래그로 처리한다.

**Tech Stack:** Node.js 24 ESM, Vitest, 제로 의존성. 업비트 공개 API.

---

## 배경 지식 (구현자가 알아야 할 것)

- OHLCV 스키마: `candlesToOhlcv` → `{ time, open, high, low, close, volume }`, 과거→최신 정렬. 암호화폐 가격은 항상 양수.
- `calcVolRatio(volumes)`: 마지막 거래량 ÷ 직전 20봉 평균. 데이터 부족 시 `null`.
- 점수 라벨 접두어는 `lib/signals.mjs`의 `SIGNAL_KEYS`가 단일 출처. 거래량 라벨은 `거래량 급증`으로 시작해야 `keyOf`/주간 EWM 학습이 매칭됨.
- 스캔 entry 구조: `{ timestamp, buy:[{market,korean_name,price,score,signals,...}], sell:[...], regime }`. `monitor-log.json`은 `{ started, totalScans, scans:[entry...] }`(오름차순, 최근 30 롤링). `data/scan-archive.jsonl`는 append-only 전체 이력.
- 테스트 실행: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run <path>`. 전체: `npm test`.
- 모든 bash 명령은 `cd /c/Users/toodo/workspace/upbit-dashboard &&` 프리픽스 필요(작업 디렉토리 리셋됨).

## 파일 구조

| 파일 | 책임 | 변경 |
|------|------|------|
| `lib/signals.mjs` | 거래량 등급 점수 + 콤보 배수 비례 + `volRatio` 반환 | 수정 |
| `lib/scan-universe.mjs` | `LOW_LIQUIDITY_24H`=5억, `liquidityMultiplier` 헬퍼 | 수정 |
| `lib/persistence.mjs` | 직전 이력→지속성 점수(순수 함수) | 신규 |
| `scripts/monitor.mjs` | log 선읽기·유동성 차등·지속성 합산 조립 | 수정 |
| `server/api.mjs` | buy를 메인/저유동성으로 분리 | 수정 |
| `public/app.js` | 추천 탭 메인/저유동성 섹션 분리 렌더 | 수정 |
| `__tests__/signals.test.mjs` | 거래량 등급·콤보 배수 테스트 | 수정 |
| `__tests__/scan-universe.test.mjs` | `liquidityMultiplier` 경계 | 수정 |
| `__tests__/persistence.test.mjs` | 지속성 점수 | 신규 |
| `__tests__/api.test.mjs` | 메인/저유동성 분리 | 수정 |

---

## Task 1: 거래량 등급화 (detectSignals)

**Files:**
- Modify: `lib/signals.mjs:98-102` (거래량 블록), 반환 객체에 `volRatio` 추가
- Test: `__tests__/signals.test.mjs`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/signals.test.mjs`의 `describe('detectSignals', ...)` 안에 추가:

```js
it('거래량 배율 등급: 10~20x 상승 → +3점 + volRatio 반환', () => {
  // 59봉 횡보(거래량 10) + 마지막 봉 +3% 상승 & 거래량 150(=15x)
  const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
  const spike = { open: 100, close: 103, high: 104, low: 100, volume: 150 }
  const r = detectSignals([...base, spike], {})
  const volLabel = r.buy.find((s) => s.startsWith('거래량 급증'))
  expect(volLabel).toBeTruthy()
  expect(r.volRatio).toBeGreaterThan(10)
})

it('거래량 급증해도 상승 +2% 미만이면 매수 거래량 신호 미부여', () => {
  const base = Array.from({ length: 59 }, () => ({ open: 100, close: 100, high: 101, low: 99, volume: 10 }))
  const weak = { open: 100, close: 100.5, high: 101, low: 99, volume: 150 } // +0.5%
  const r = detectSignals([...base, weak], {})
  expect(r.buy.some((s) => s.startsWith('거래량 급증'))).toBe(false)
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/signals.test.mjs`
Expected: FAIL — `r.volRatio` undefined, +2% 컷 미구현.

- [ ] **Step 3: 구현**

`lib/signals.mjs`에 등급 헬퍼 추가(파일 상단 `keyOf` 근처):

```js
// 거래량 배율 → 점수 등급 (2/5/10/20x 계단)
export function volumeGrade(volR) {
  if (volR == null || volR < 2) return 0
  if (volR < 5) return 1
  if (volR < 10) return 2
  if (volR < 20) return 3
  return 4
}
```

`detectSignals`의 거래량 블록(현재 98-102행)을 교체:

```js
  if (volR != null && volR >= 2 && volumes.length >= 2) {
    const grade = volumeGrade(volR)
    const up = closes.at(-1) >= closes.at(-2) * 1.02   // 매수: +2% 이상 상승 동반
    const down = closes.at(-1) < closes.at(-2)
    if (up) addBuy(`거래량 급증 (${volR.toFixed(1)}x)`, grade)
    else if (down) addSell(`거래량 급증 (${volR.toFixed(1)}x)`, grade)
  }
```

`detectSignals` 반환문(현재 112행)에 `volRatio` 추가:

```js
  return { buy, sell, buyScore, sellScore, price, volRatio: volR }
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/signals.test.mjs`
Expected: PASS (신규 2개 포함). 기존 `detectSignals` 테스트도 통과(volRatio 추가는 비파괴).

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/signals.mjs __tests__/signals.test.mjs && git commit -m "feat: 거래량 등급화(2/5/10/20x) + +2% 상승 컷 + volRatio 반환"
```

---

## Task 2: 콤보 거래량 배수 비례 (applyCombos)

**Files:**
- Modify: `lib/signals.mjs:115-138` (`applyCombos`)
- Test: `__tests__/signals.test.mjs`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/signals.test.mjs`의 `describe('applyCombos', ...)`에 추가:

```js
it('거래량 배수가 구간 따라 비례: 20x+ → ×1.6', () => {
  const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (25.0x)']
  const { buyScore } = applyCombos(buy, [], 10, 25)
  expect(buyScore).toBeCloseTo(10 * 1.4 * 1.6, 5)
})

it('거래량 배수 기본(2~10x) → ×1.3 유지', () => {
  const buy = ['Stoch 과매도 골든크로스 (5)', '거래량 급증 (3.0x)']
  const { buyScore } = applyCombos(buy, [], 10, 3)
  expect(buyScore).toBeCloseTo(10 * 1.4 * 1.3, 5)
})
```

기존 `'거래량 급증 동반 → 추가 ×1.3'` 테스트(30-34행)는 `applyCombos(buy, [], 10)` 호출에 4번째 인자가 없다. `volRatio` 미전달 시 기본 ×1.3을 유지하도록 구현하므로 그대로 통과해야 한다(수정 불필요).

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/signals.test.mjs`
Expected: FAIL — 4번째 인자 무시되어 ×1.6 안 됨.

- [ ] **Step 3: 구현**

`lib/signals.mjs`에 헬퍼 추가:

```js
// 거래량 배율 → 콤보 보너스 배수
export function volComboMult(volR) {
  if (volR == null) return 1.3
  if (volR >= 20) return 1.6
  if (volR >= 10) return 1.45
  return 1.3
}
```

`applyCombos` 시그니처와 거래량 콤보 부분 수정:

```js
export function applyCombos(buy, sell, buyScore, volRatio = null) {
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
    bs *= volComboMult(volRatio)
    out.push('[콤보] 거래량확인 보너스')
  }
  return { buyScore: bs, buy: out }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/signals.test.mjs`
Expected: PASS (기존 ×1.3 테스트 포함 전부).

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/signals.mjs __tests__/signals.test.mjs && git commit -m "feat: 콤보 거래량 보너스를 배율 구간 비례(1.3/1.45/1.6)로"
```

---

## Task 3: 유동성 차등 배수 헬퍼

**Files:**
- Modify: `lib/scan-universe.mjs:7` (`LOW_LIQUIDITY_24H`), 헬퍼 추가
- Test: `__tests__/scan-universe.test.mjs`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/scan-universe.test.mjs`에 추가(없으면 import 추가):

```js
import { liquidityMultiplier, LOW_LIQUIDITY_24H } from '../lib/scan-universe.mjs'

describe('liquidityMultiplier', () => {
  it('구간별 배수', () => {
    expect(liquidityMultiplier(60_0000_0000)).toBe(1.0)   // 60억
    expect(liquidityMultiplier(30_0000_0000)).toBe(0.9)   // 30억
    expect(liquidityMultiplier(10_0000_0000)).toBe(0.8)   // 10억
    expect(liquidityMultiplier(3_0000_0000)).toBe(0.6)    // 3억
  })
  it('경계: 50억=1.0, 20억=0.9, 5억=0.8', () => {
    expect(liquidityMultiplier(50_0000_0000)).toBe(1.0)
    expect(liquidityMultiplier(20_0000_0000)).toBe(0.9)
    expect(liquidityMultiplier(5_0000_0000)).toBe(0.8)
  })
  it('저유동성 기준선 5억', () => {
    expect(LOW_LIQUIDITY_24H).toBe(500_000_000)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/scan-universe.test.mjs`
Expected: FAIL — `liquidityMultiplier` 미정의, `LOW_LIQUIDITY_24H`는 3억.

- [ ] **Step 3: 구현**

`lib/scan-universe.mjs` 수정:

```js
export const LOW_LIQUIDITY_24H = 500_000_000   // 5억원 미만 = 저유동성(메인 분리)

// 24h 거래대금 → 점수 배수 (구간별 차등)
export function liquidityMultiplier(tradePrice24h) {
  const v = tradePrice24h ?? 0
  if (v >= 5_000_000_000) return 1.0   // 50억+
  if (v >= 2_000_000_000) return 0.9   // 20~50억
  if (v >= 500_000_000) return 0.8     // 5~20억
  return 0.6                           // 1~5억
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/scan-universe.test.mjs`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/scan-universe.mjs __tests__/scan-universe.test.mjs && git commit -m "feat: 유동성 차등 배수 헬퍼 + 저유동성 기준 5억으로 상향"
```

---

## Task 4: 지속성 모듈 (lib/persistence.mjs)

**Files:**
- Create: `lib/persistence.mjs`
- Test: `__tests__/persistence.test.mjs`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/persistence.test.mjs` 생성:

```js
import { describe, it, expect } from 'vitest'
import { appearanceStreak, scorePersistence } from '../lib/persistence.mjs'

const scan = (markets, volMarkets = []) => ({
  buy: markets.map((m) => ({ market: m, signals: volMarkets.includes(m) ? ['거래량 급증 (3.0x)'] : [] })),
})

describe('appearanceStreak', () => {
  it('최신부터 연속 등장 횟수', () => {
    const prior = [scan(['KRW-A']), scan(['KRW-A']), scan(['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior)).toBe(3)
  })
  it('중간에 빠지면 끊김(최신쪽만 카운트)', () => {
    const prior = [scan(['KRW-A']), scan([]), scan(['KRW-A'])]
    expect(appearanceStreak('KRW-A', prior)).toBe(1)
  })
  it('빈 이력 → 0', () => {
    expect(appearanceStreak('KRW-A', [])).toBe(0)
  })
})

describe('scorePersistence', () => {
  it('3회 연속 → +2', () => {
    const prior = [scan(['KRW-A']), scan(['KRW-A']), scan(['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: false }, prior)
    expect(r.bonus).toBe(2)
    expect(r.signals).toContain('🔥지속 매수권 (3회+)')
  })
  it('2회 연속 → +1 (3회 라벨과 중복 없음)', () => {
    const prior = [scan([]), scan(['KRW-A']), scan(['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: false }, prior)
    expect(r.bonus).toBe(1)
    expect(r.signals).toContain('지속 매수권 (2회)')
    expect(r.signals).not.toContain('🔥지속 매수권 (3회+)')
  })
  it('이번+직전 거래량 급증 → 거래량 지속 +1', () => {
    const prior = [scan(['KRW-A'], ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: true }, prior)
    expect(r.signals).toContain('거래량 지속')
    expect(r.bonus).toBe(1) // streak 1회(보너스 없음) + 거래량 지속 1
  })
  it('직전 급증·이번 소멸 → 경고만, bonus 0', () => {
    const prior = [scan(['KRW-A'], ['KRW-A'])]
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: false }, prior)
    expect(r.signals).toContain('⚠️거래량 소멸 (1회성)')
    expect(r.bonus).toBe(0)
  })
  it('빈 이력 → bonus 0, 라벨 없음', () => {
    const r = scorePersistence({ market: 'KRW-A', hasVolumeSurge: true }, [])
    expect(r).toEqual({ bonus: 0, signals: [] })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/persistence.test.mjs`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`lib/persistence.mjs` 생성:

```js
// 직전 스캔 이력 → 지속성 점수. priorScans: 오름차순(과거→최신) entry 배열.
// 각 entry는 { buy: [{ market, signals }] }.

export function appearanceStreak(market, priorScans = []) {
  let streak = 0
  for (let i = priorScans.length - 1; i >= 0; i--) {
    if ((priorScans[i].buy || []).some((b) => b.market === market)) streak++
    else break
  }
  return streak
}

function priorHadVolumeSurge(market, priorScans) {
  const last = priorScans[priorScans.length - 1]
  if (!last) return false
  const item = (last.buy || []).find((b) => b.market === market)
  return item ? (item.signals || []).some((s) => s.startsWith('거래량 급증')) : false
}

export function scorePersistence({ market, hasVolumeSurge }, priorScans = []) {
  const signals = []
  let bonus = 0
  const streak = appearanceStreak(market, priorScans)
  if (streak >= 3) { bonus += 2; signals.push('🔥지속 매수권 (3회+)') }
  else if (streak >= 2) { bonus += 1; signals.push('지속 매수권 (2회)') }

  const priorVol = priorHadVolumeSurge(market, priorScans)
  if (hasVolumeSurge && priorVol) { bonus += 1; signals.push('거래량 지속') }
  else if (!hasVolumeSurge && priorVol) { signals.push('⚠️거래량 소멸 (1회성)') }

  return { bonus, signals }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/persistence.test.mjs`
Expected: PASS (8개).

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add lib/persistence.mjs __tests__/persistence.test.mjs && git commit -m "feat: 지속성 모듈(반복등장 보너스 + 거래량 지속/소멸 판정)"
```

---

## Task 5: monitor.mjs 조립 (유동성 차등 + 지속성)

**Files:**
- Modify: `scripts/monitor.mjs` (import, log 선읽기, 점수 합성)

- [ ] **Step 1: import + log 선읽기**

`scripts/monitor.mjs` 상단 import 수정:

```js
import { getScanUniverse, BATCH, DELAY, sleep, LOW_LIQUIDITY_24H, liquidityMultiplier } from '../lib/scan-universe.mjs'
import { scorePersistence } from '../lib/persistence.mjs'
```

`main()`에서 스캔 루프 **앞**에 monitor-log를 미리 읽어 priorScans 확보(현재 94행의 `readJson('monitor-log.json'...)`을 루프 앞으로 이동):

```js
  const log = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  const priorScans = log.scans || []
```

(루프 뒤에서는 더 이상 `readJson`을 호출하지 않고 이 `log`를 재사용.)

- [ ] **Step 2: 점수 합성 — 유동성 차등 + 지속성**

`scripts/monitor.mjs` per-market 블록에서 기존 레짐 게이트 이후(현재 68-72행) 부분을 교체:

```js
      // 레짐 게이트: BTC 약세장에선 반등 매수 신뢰도 하향
      if (regime.trend === 'bear') { finalBuyScore *= 0.85; buySignals = [...buySignals, '[레짐] BTC 약세 감점'] }
      // 유동성 차등 감점 (구간별 배수)
      const tp = tradePrice[market] ?? 0
      const liqMult = liquidityMultiplier(tp)
      if (liqMult < 1) { finalBuyScore *= liqMult; buySignals = [...buySignals, `⚠️유동성 ×${liqMult}`] }
      const lowLiq = tp < LOW_LIQUIDITY_24H
      // 지속성 보너스 (이력 기반, 마지막 가산)
      const hasVolumeSurge = buySignals.some((s) => s.startsWith('거래량 급증'))
      const pers = scorePersistence({ market, hasVolumeSurge }, priorScans)
      finalBuyScore += pers.bonus
      if (pers.signals.length) buySignals = [...buySignals, ...pers.signals]
```

매수 항목 push 부분(현재 74-80행)에서 `applyCombos` 호출에 volRatio 전달이 필요하므로, 48행 `applyCombos(sig.buy, sig.sell, sig.buyScore)` 를 수정:

```js
      const combo = applyCombos(sig.buy, sig.sell, sig.buyScore, sig.volRatio)
```

`lowLiq` 플래그 저장은 기존 로직 유지(`if (lowLiq) item.lowLiquidity = true`). 단 기존 72행의 `finalBuyScore *= 0.9` 저유동성 감점 줄은 **삭제**(유동성 차등으로 대체됨).

- [ ] **Step 3: 회귀 + 라이브 실행**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npm test`
Expected: 전체 PASS (기존 + 신규).

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node scripts/monitor.mjs 2>&1 | tail -5`
Expected: `스캔 #N 완료` 정상 출력, 에러 없음. 매수 상위에 유동성/지속성 라벨이 섞여 나옴.

- [ ] **Step 4: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add scripts/monitor.mjs && git commit -m "feat: monitor에 유동성 차등 배수 + 지속성 보너스 통합"
```

---

## Task 6: 표시 분리 (메인 / 저유동성)

**Files:**
- Modify: `server/api.mjs:47-60` (`buildResults`)
- Modify: `public/app.js` (추천 탭 렌더)
- Modify: `scripts/monitor.mjs` (`notifyTelegram` 저유동성 요약)
- Test: `__tests__/api.test.mjs`

- [ ] **Step 1: 실패 테스트 작성 (api 분리)**

`__tests__/api.test.mjs`에 추가:

```js
import { buildResults } from '../server/api.mjs'

describe('buildResults 저유동성 분리', () => {
  it('buy를 메인/저유동성으로 가른다', () => {
    const log = { totalScans: 1, scans: [{
      timestamp: 't', regime: null,
      buy: [
        { market: 'KRW-A', korean_name: 'A', price: 1, score: 10, signals: [] },
        { market: 'KRW-B', korean_name: 'B', price: 1, score: 8, signals: [], lowLiquidity: true },
      ],
      sell: [],
    }] }
    const r = buildResults(log)
    expect(r.buy.map((b) => b.market)).toEqual(['KRW-A'])
    expect(r.buyLowLiq.map((b) => b.market)).toEqual(['KRW-B'])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/api.test.mjs`
Expected: FAIL — `r.buyLowLiq` undefined.

- [ ] **Step 3: 구현 (api)**

`server/api.mjs`의 `buildResults` 반환부 수정(현재 50-59행). `scan.buy`를 분리:

```js
  const buyAll = scan.buy || []
  const buyMain = buyAll.filter((b) => !b.lowLiquidity)
  const buyLowLiq = buyAll.filter((b) => b.lowLiquidity)
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { buyCount: buyAll.length, sellCount: scan.sell.length, totalScans: log.totalScans || 0 },
    buy: buyMain,
    buyLowLiq,
    sell: scan.sell,
    comboDist: comboDistribution(buyAll),
    candleSummary: candleSummary(scan),
    regime: scan.regime || null,
  }
```

빈 스캔 반환(현재 49행)에도 `buyLowLiq: []` 추가:

```js
  if (!scan) return { empty: true, kpi: { buyCount: 0, sellCount: 0, totalScans: log?.totalScans || 0 }, buy: [], buyLowLiq: [], sell: [], comboDist: { rebound: 0, trap: 0, volume: 0, mtf: 0 }, candleSummary: { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] } }
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/api.test.mjs`
Expected: PASS.

- [ ] **Step 5: app.js 추천 탭 렌더 분리**

`public/app.js`의 추천 탭 `render` 함수(현재 139-148행)는 `res[side]`를 인라인으로 테이블 행에 매핑한다. 행 생성을 작은 헬퍼로 추출해 재사용하고, side==='buy'일 때 저유동성 섹션을 덧붙인다. 139-148행 전체를 교체:

```js
    const rowHtml = (x) => `<tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
      <td><span class="font-medium">${esc(x.korean_name)}</span> <span class="opacity-50 text-xs">${esc(x.market.replace('KRW-', ''))}</span></td>
      <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
      <td>${fmt(x.price)}</td><td>${signalTags(x.signals)}</td>
    </tr>`
    const matches = (x, q) => !q || x.korean_name.includes(q) || x.market.includes(q.toUpperCase())
    const render = (q = '') => {
      const list = (res[side] || []).filter((x) => matches(x, q))
      let rows = list.map(rowHtml).join('') || '<tr><td colspan="4" class="opacity-60">없음</td></tr>'
      if (side === 'buy') {
        const low = (res.buyLowLiq || []).filter((x) => matches(x, q))
        if (low.length) {
          rows += `<tr><td colspan="4" class="text-xs opacity-60 pt-3">⚠️ 저유동성 후보 (5억 미만 · 슬리피지 주의) ${low.length}개</td></tr>`
          rows += low.map(rowHtml).join('')
        }
      }
      $('#recBody').innerHTML = `<div class="overflow-x-auto"><table class="table table-zebra table-sm">
        <thead><tr><th>종목</th><th>점수</th><th>현재가</th><th>신호</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    }
```

(매도 side는 `res.sell`만 그대로 — 저유동성 분리는 매수에만 적용.)

- [ ] **Step 6: Telegram 저유동성 요약**

`scripts/monitor.mjs`의 `notifyTelegram(buyList)` 수정 — 메인만 상위 5, 저유동성은 카운트 한 줄:

```js
async function notifyTelegram(buyList) {
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID || buyList.length === 0) return
  const main = buyList.filter((b) => !b.lowLiquidity)
  const lowN = buyList.length - main.length
  const lines = main.slice(0, 5).map((b) => {
    const mtf = b.signals.includes('[MTF] 4시간봉 Stoch GC 확인') ? ' 📡MTF' : ''
    const stgc = b.signals.some((s) => s.includes('골든크로스')) ? ' 🟢GC' : ''
    const sl = b.vbottomSL != null ? ` 🎯SL:${b.vbottomSL}` : b.pumpSL != null ? ` 🚀SL:${b.pumpSL}` : ''
    return `• ${b.korean_name}(${b.market.replace('KRW-', '')}) score ${b.score.toFixed(1)}${stgc}${mtf}${sl}`
  })
  const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const lowLine = lowN > 0 ? `\n\n⚠️ 저유동성 후보 ${lowN}개(별도)` : ''
  const msg = `🚨 업비트 스캔 ${when}\n메인 매수 ${main.length}개${lowLine}\n\n${lines.join('\n')}`
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
    })
  } catch { /* 네트워크 오류 시 무시 */ }
}
```

- [ ] **Step 7: 대시보드 수동 확인 + 커밋**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npm test`
Expected: 전체 PASS.

대시보드 띄워 추천 탭에 저유동성 섹션이 분리되어 보이는지 확인:
Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node server/server.mjs` → 브라우저 `http://127.0.0.1:8787` 추천 탭. 확인 후 종료.

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add server/api.mjs public/app.js scripts/monitor.mjs __tests__/api.test.mjs && git commit -m "feat: 추천/Telegram 메인·저유동성 분리 표시"
```

---

## Task 7: 검증 (소급 점검) + README

**Files:**
- Modify: `README.md` (콤보/유동성/지속성 표 갱신)

- [ ] **Step 1: 누적 archive 소급 점검 (일회성)**

새 점수 로직이 의도대로 차등하는지 최근 스캔 데이터로 눈으로 확인:

Run:
```bash
cd /c/Users/toodo/workspace/upbit-dashboard && node -e "
const { readArchive } = await import('./lib/archive.mjs');
const { scorePersistence } = await import('./lib/persistence.mjs');
const s = readArchive();
const prior = s.slice(0, -1), last = s.at(-1);
for (const b of (last.buy||[])) {
  const vol = (b.signals||[]).some(x=>x.startsWith('거래량 급증'));
  const p = scorePersistence({market:b.market, hasVolumeSurge:vol}, prior);
  if (p.signals.length) console.log(b.korean_name, '→', p.bonus, p.signals.join(','));
}
"
```
Expected: 반복 등장/거래량 소멸 종목에 지속성 라벨이 정상 부여됨(에러 없이). 결과를 사용자에게 보고.

- [ ] **Step 2: README 갱신**

`README.md`의 콤보 보정 표·저유동성 설명을 새 로직으로 갱신:
- 거래량확인 보너스: `×1.3` → `×1.3~1.6 (배율 비례)`
- 거래량 급증: `+1` → `+1~+4 (2/5/10/20x 등급) · +2% 상승 동반`
- 저유동성: `3억 미만 ×0.9` → `구간별 ×0.6~1.0 · 5억 미만 메인 분리`
- 지속성 한 줄 추가: `직전 스캔 이력 기반 반복등장 +1/+2, 거래량 지속 +1, 1회성 점화 경고`

- [ ] **Step 3: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add README.md && git commit -m "docs: 점수 로직 재설계 반영(거래량 등급·유동성 차등·지속성)"
```

---

## 최종 검토 (전체 태스크 후)

- [ ] `npm test` 전체 통과
- [ ] `node scripts/monitor.mjs` 라이브 1회 정상 + 새 라벨 노출 확인
- [ ] 대시보드 추천 탭 메인/저유동성 분리 확인
- [ ] superpowers:finishing-a-development-branch 로 브랜치 마무리
