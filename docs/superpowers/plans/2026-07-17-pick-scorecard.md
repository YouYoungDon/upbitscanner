# 픽 성과 스코어카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스캔 아카이브의 매수 픽 신규진입을 에피소드로 추출해 +1/+3/+7일 확정종가 수익률·MFE를 자동 채점하고 대시보드 탭으로 보여준다.

**Architecture:** 순수 로직(`lib/scorecard.mjs`) + 배치 러너(`scripts/scorecard.mjs`, 하루 1회 스케줄) + 정적 JSON(`data/scorecard.json`) + 읽기 전용 API(`/api/scorecard`) + 프론트 탭. 스펙: `docs/superpowers/specs/2026-07-17-pick-scorecard-design.md`.

**Tech Stack:** Node.js ESM(.mjs), vitest, vanilla JS SPA(daisyUI), Windows 작업 스케줄러.

## Global Constraints

- 에피소드 = 직전 스캔 매수 리스트에 없던 마켓의 신규 등장. id는 `` `${market}@${entryTs}` ``.
- retN = D+N 확정 종가 ÷ entryPrice − 1 (N ∈ {1,3,7}). mfeN = D+1..D+N 확정봉 고가 최대값 ÷ entryPrice − 1 (**D0 고가 제외**).
- 일봉 경계는 UTC 00:00 (= KST 09:00). 날짜 연산은 `Math.floor(unixSec / 86400)`.
- status: 셋 다 null → `pending`, 일부 채점 → `partial`, ret7까지 → `done`, 진입일로부터 10 UTC일 경과 후에도 미채점 지평선 남으면 → `no-data`.
- 확정봉은 반드시 `confirmedOhlcv()`를 거친다. 캔들 fetch는 마켓당 1회.
- cutover 경계: `Date.parse('2026-07-12T15:00:00Z')` (KST 2026-07-13 00:00). entryTs가 이보다 앞이면 `pre`, 이후면 `post`.
- `data/scorecard.json`은 gitignore (런타임 데이터). 저장은 `store.writeJson`(원자적).
- 라이브 8787 서버는 구현 중 건드리지 않는다 (최종 검증 단계에서만 재시작).
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 모든 새 파일은 UTF-8(BOM 없음). Write/Edit 도구로만 작성 (PowerShell 파일 쓰기 금지).

---

### Task 1: lib/scorecard.mjs — extractEpisodes

**Files:**
- Create: `lib/scorecard.mjs`
- Test: `__tests__/scorecard.test.mjs`

**Interfaces:**
- Consumes: 없음 (순수 함수).
- Produces: `extractEpisodes(scans) → episode[]`. episode 형태(이후 모든 태스크가 의존):
  `{ id, market, korean_name, entryTs, entryPrice, score, signals, lowLiquidity, ret1, ret3, ret7, mfe1, mfe3, mfe7, status, scoredAt }`

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/scorecard.test.mjs` 생성:

```js
import { describe, it, expect } from 'vitest'
import { extractEpisodes } from '../lib/scorecard.mjs'

const scan = (ts, markets) => ({
  timestamp: ts,
  buy: markets.map((m) => ({ market: m, korean_name: m.slice(4), price: 100, score: 10, signals: ['RSI 과매도 (25)'] })),
  sell: [],
})

describe('extractEpisodes', () => {
  it('첫 스캔은 전원 신규 에피소드', () => {
    const eps = extractEpisodes([scan('t1', ['KRW-A', 'KRW-B'])])
    expect(eps.map((e) => e.id)).toEqual(['KRW-A@t1', 'KRW-B@t1'])
    expect(eps[0]).toMatchObject({
      market: 'KRW-A', entryTs: 't1', entryPrice: 100, score: 10,
      lowLiquidity: false, ret1: null, ret3: null, ret7: null,
      mfe1: null, mfe3: null, mfe7: null, status: 'pending', scoredAt: null,
    })
  })
  it('연속 등장은 중복 에피소드를 만들지 않는다', () => {
    const eps = extractEpisodes([scan('t1', ['KRW-A']), scan('t2', ['KRW-A'])])
    expect(eps.length).toBe(1)
  })
  it('이탈 후 재진입은 새 에피소드', () => {
    const eps = extractEpisodes([scan('t1', ['KRW-A']), scan('t2', []), scan('t3', ['KRW-A'])])
    expect(eps.map((e) => e.id)).toEqual(['KRW-A@t1', 'KRW-A@t3'])
  })
  it('lowLiquidity 플래그 보존', () => {
    const s = scan('t1', ['KRW-A'])
    s.buy[0].lowLiquidity = true
    expect(extractEpisodes([s])[0].lowLiquidity).toBe(true)
  })
  it('buy 없는 스캔·빈 배열 허용', () => {
    expect(extractEpisodes([{ timestamp: 't1' }, scan('t2', ['KRW-A'])]).length).toBe(1)
    expect(extractEpisodes([])).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/scorecard.test.mjs`
Expected: FAIL — `Cannot find module '../lib/scorecard.mjs'`

- [ ] **Step 3: 최소 구현**

`lib/scorecard.mjs` 생성:

```js
// 픽 성과 스코어카드 — 순수 로직.
// 에피소드: 직전 스캔 매수 리스트에 없던 마켓이 새로 등장한 순간의 스냅샷.

export function extractEpisodes(scans) {
  const episodes = []
  let prev = new Set()
  for (const scan of scans) {
    const cur = new Set()
    for (const item of scan.buy ?? []) {
      cur.add(item.market)
      if (prev.has(item.market)) continue
      episodes.push({
        id: `${item.market}@${scan.timestamp}`,
        market: item.market,
        korean_name: item.korean_name,
        entryTs: scan.timestamp,
        entryPrice: item.price,
        score: item.score,
        signals: item.signals ?? [],
        lowLiquidity: !!item.lowLiquidity,
        ret1: null, ret3: null, ret7: null,
        mfe1: null, mfe3: null, mfe7: null,
        status: 'pending',
        scoredAt: null,
      })
    }
    prev = cur
  }
  return episodes
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/scorecard.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/scorecard.mjs __tests__/scorecard.test.mjs
git commit -m "feat: 스코어카드 에피소드 추출 (신규진입 감지)"
```

---

### Task 2: lib/scorecard.mjs — scoreEpisode·neededCandleCount·mergeEpisodes

**Files:**
- Modify: `lib/scorecard.mjs` (Task 1에서 생성)
- Test: `__tests__/scorecard.test.mjs` (추가)

**Interfaces:**
- Consumes: Task 1의 episode 형태. confirmed 캔들 배열 요소는 `{ time(unix sec, UTC 00:00 경계), open, close, high, low, volume }` (upbit.mjs `candlesToOhlcv` 출력과 동일).
- Produces:
  - `scoreEpisode(ep, confirmed, nowMs) → episode` (새 객체 반환, 입력 불변)
  - `neededCandleCount(oldestEntryMs, nowMs) → number` (clamp [10, 200])
  - `mergeEpisodes(existing, fresh) → episode[]` (id 기준: existing 값 우선 보존, fresh에만 있으면 추가)

- [ ] **Step 1: 실패하는 테스트 추가**

`__tests__/scorecard.test.mjs`에 append:

```js
import { scoreEpisode, neededCandleCount, mergeEpisodes } from '../lib/scorecard.mjs'

const DAY = 86400
// entryTs: 2026-07-01T03:00:00Z → D0 = 2026-07-01 (UTC일)
const ENTRY_MS = Date.parse('2026-07-01T03:00:00Z')
const D0_SEC = Math.floor(ENTRY_MS / 1000 / DAY) * DAY
const ep0 = () => ({
  id: 'KRW-A@e', market: 'KRW-A', korean_name: 'A',
  entryTs: '2026-07-01T03:00:00.000Z', entryPrice: 100, score: 10, signals: [],
  lowLiquidity: false, ret1: null, ret3: null, ret7: null,
  mfe1: null, mfe3: null, mfe7: null, status: 'pending', scoredAt: null,
})
// D0..D+n 확정봉 생성기
const candles = (n, close = (i) => 100 + i, high = (i) => 110 + i) =>
  Array.from({ length: n + 1 }, (_, i) => ({ time: D0_SEC + i * DAY, open: 100, close: close(i), high: high(i), low: 90, volume: 1 }))

describe('scoreEpisode', () => {
  it('D+1만 확정 → ret1/mfe1 채점, partial', () => {
    const r = scoreEpisode(ep0(), candles(1), Date.parse('2026-07-03T00:00:00Z'))
    expect(r.ret1).toBeCloseTo(101 / 100 - 1)
    expect(r.mfe1).toBeCloseTo(111 / 100 - 1)
    expect(r.ret3).toBeNull()
    expect(r.status).toBe('partial')
    expect(r.scoredAt).not.toBeNull()
  })
  it('D+7까지 확정 → 전부 채점, done. mfe는 D0 고가 제외', () => {
    // D0 고가만 999로 크게 — mfe에 반영되면 안 됨
    const cs = candles(7, (i) => 100 + i, (i) => (i === 0 ? 999 : 110 + i))
    const r = scoreEpisode(ep0(), cs, Date.parse('2026-07-10T00:00:00Z'))
    expect(r.ret7).toBeCloseTo(107 / 100 - 1)
    expect(r.mfe7).toBeCloseTo(117 / 100 - 1) // 999 아님
    expect(r.status).toBe('done')
  })
  it('이미 채점된 지평선은 다시 계산하지 않는다', () => {
    const pre = { ...ep0(), ret1: 0.5, mfe1: 0.6, status: 'partial' }
    const r = scoreEpisode(pre, candles(7), Date.parse('2026-07-10T00:00:00Z'))
    expect(r.ret1).toBe(0.5) // 보존
    expect(r.ret7).not.toBeNull()
  })
  it('진입 후 10 UTC일 경과 + 캔들 없음 → no-data', () => {
    const r = scoreEpisode(ep0(), [], Date.parse('2026-07-12T01:00:00Z'))
    expect(r.status).toBe('no-data')
  })
  it('10일 이내 + 캔들 없음 → pending 유지', () => {
    const r = scoreEpisode(ep0(), [], Date.parse('2026-07-05T00:00:00Z'))
    expect(r.status).toBe('pending')
  })
  it('entryPrice 0 이하 → no-data', () => {
    const r = scoreEpisode({ ...ep0(), entryPrice: 0 }, candles(7), Date.parse('2026-07-10T00:00:00Z'))
    expect(r.status).toBe('no-data')
  })
})

describe('neededCandleCount', () => {
  it('오늘−D0+3, clamp [10,200]', () => {
    const now = Date.parse('2026-07-20T00:00:00Z') // D0 + 19일
    expect(neededCandleCount(ENTRY_MS, now)).toBe(22)
    expect(neededCandleCount(now, now)).toBe(10) // 최소
    expect(neededCandleCount(Date.parse('2020-01-01T00:00:00Z'), now)).toBe(200) // cap
  })
})

describe('mergeEpisodes', () => {
  it('기존 채점값 보존 + 신규 추가', () => {
    const existing = [{ ...ep0(), ret1: 0.1, status: 'partial' }]
    const fresh = [ep0(), { ...ep0(), id: 'KRW-B@e', market: 'KRW-B' }]
    const merged = mergeEpisodes(existing, fresh)
    expect(merged.length).toBe(2)
    expect(merged.find((e) => e.id === 'KRW-A@e').ret1).toBe(0.1)
    expect(merged.find((e) => e.id === 'KRW-B@e').status).toBe('pending')
  })
  it('fresh에 없는 기존 에피소드도 유지 (방어적)', () => {
    const existing = [{ ...ep0(), id: 'KRW-OLD@x', market: 'KRW-OLD' }]
    const merged = mergeEpisodes(existing, [ep0()])
    expect(merged.length).toBe(2)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/scorecard.test.mjs`
Expected: FAIL — `scoreEpisode is not a function` (또는 export 없음)

- [ ] **Step 3: 구현**

`lib/scorecard.mjs`에 append:

```js
const DAY = 86400
const HORIZONS = [1, 3, 7]
const NO_DATA_AFTER_DAYS = 10 // D+7 + 여유 3일

// 확정봉으로 에피소드를 채점. 입력은 불변, 새 객체 반환.
// confirmed: candlesToOhlcv → confirmedOhlcv 이후의 chronological 배열.
export function scoreEpisode(ep, confirmed, nowMs) {
  const out = { ...ep }
  const d0 = Math.floor(Date.parse(ep.entryTs) / 1000 / DAY)
  const nowDay = Math.floor(nowMs / 1000 / DAY)
  const byDay = new Map((confirmed ?? []).map((c) => [Math.floor(c.time / DAY), c]))
  const invalid = !(ep.entryPrice > 0)
  let touched = false
  if (!invalid) {
    for (const n of HORIZONS) {
      if (out[`ret${n}`] != null) continue
      const target = byDay.get(d0 + n)
      if (!target) continue
      out[`ret${n}`] = target.close / ep.entryPrice - 1
      let hi = -Infinity
      for (let i = d0 + 1; i <= d0 + n; i++) {
        const c = byDay.get(i)
        if (c) hi = Math.max(hi, c.high)
      }
      out[`mfe${n}`] = hi > 0 ? hi / ep.entryPrice - 1 : null
      touched = true
    }
  }
  const scoredCount = HORIZONS.filter((n) => out[`ret${n}`] != null).length
  const expired = nowDay > d0 + NO_DATA_AFTER_DAYS
  if (invalid || (expired && scoredCount < HORIZONS.length)) out.status = 'no-data'
  else if (scoredCount === HORIZONS.length) out.status = 'done'
  else if (scoredCount > 0) out.status = 'partial'
  else out.status = 'pending'
  if (touched || out.status !== ep.status) out.scoredAt = new Date(nowMs).toISOString()
  return out
}

// 채점에 필요한 일봉 개수: 오늘 − D0 + 여유 3봉. clamp [10, 200] (업비트 cap).
export function neededCandleCount(oldestEntryMs, nowMs) {
  const days = Math.floor(nowMs / 1000 / DAY) - Math.floor(oldestEntryMs / 1000 / DAY)
  return Math.max(10, Math.min(200, days + 3))
}

// id 기준 병합: existing의 채점값 보존, fresh 신규분 추가, fresh에 없는 기존분도 유지.
export function mergeEpisodes(existing, fresh) {
  const byId = new Map((existing ?? []).map((e) => [e.id, e]))
  const merged = (fresh ?? []).map((f) => byId.get(f.id) ?? f)
  const freshIds = new Set((fresh ?? []).map((f) => f.id))
  for (const e of existing ?? []) if (!freshIds.has(e.id)) merged.push(e)
  return merged
}
```

주의: `expired && scoredCount < 3`일 때 이미 partial이던 것도 `no-data`가 된다 — 상장폐지로 후반 지평선을 영영 못 채우는 케이스를 닫는 의도된 동작 (스펙의 no-data 규칙).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/scorecard.test.mjs`
Expected: PASS (14 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/scorecard.mjs __tests__/scorecard.test.mjs
git commit -m "feat: 스코어카드 채점·병합 로직 (확정봉 ret/MFE, no-data)"
```

---

### Task 3: scripts/scorecard.mjs — 배치 러너

**Files:**
- Create: `scripts/scorecard.mjs`
- Modify: `.gitignore` (한 줄 추가)
- Modify: `package.json` (scripts에 `"scorecard": "node scripts/scorecard.mjs"` 추가)

**Interfaces:**
- Consumes: Task 1·2의 `extractEpisodes`, `scoreEpisode`, `neededCandleCount`, `mergeEpisodes`. `lib/store.mjs`의 `DATA_DIR`, `readJson`, `writeJson`. `lib/upbit.mjs`의 `getDayCandles(market, count)`, `candlesToOhlcv(candles)`. `lib/ohlcv.mjs`의 `confirmedOhlcv`.
- Produces: `data/scorecard.json` = `{ updatedAt: ISO문자열, episodes: episode[] }` (Task 4가 읽는 형태).

- [ ] **Step 1: 러너 작성**

`scripts/scorecard.mjs` 생성:

```js
// 픽 성과 스코어카드 배치 러너.
// scan-archive.jsonl → 에피소드 추출 → 기존 채점 병합 → 미채점만 마켓별 1-fetch 증분 채점 → scorecard.json.
// 하루 1회(KST 09:10, 일봉 확정 직후) 작업 스케줄러로 실행. 수동 실행: npm run scorecard
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, readJson, writeJson } from '../lib/store.mjs'
import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { extractEpisodes, scoreEpisode, neededCandleCount, mergeEpisodes } from '../lib/scorecard.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let raw
  try {
    raw = await readFile(join(DATA_DIR, 'scan-archive.jsonl'), 'utf8')
  } catch {
    console.error('scan-archive.jsonl 없음 — 채점할 스캔이 없습니다.')
    process.exitCode = 1
    return
  }
  const scans = raw.trim().split('\n').map((line) => {
    try { return JSON.parse(line) } catch { console.warn('아카이브 줄 파싱 실패 — 건너뜀'); return null }
  }).filter(Boolean)

  const fresh = extractEpisodes(scans)
  const prev = await readJson('scorecard.json', { episodes: [] })
  const prevCount = (prev.episodes ?? []).length
  let episodes = mergeEpisodes(prev.episodes ?? [], fresh)

  const now = Date.now()
  const pending = episodes.filter((e) => e.status === 'pending' || e.status === 'partial')
  const byMarket = new Map()
  for (const e of pending) {
    if (!byMarket.has(e.market)) byMarket.set(e.market, [])
    byMarket.get(e.market).push(e)
  }

  let scored = 0
  let failedMarkets = 0
  const updated = new Map()
  for (const [market, eps] of byMarket) {
    const oldest = Math.min(...eps.map((e) => Date.parse(e.entryTs)))
    const candles = await getDayCandles(market, neededCandleCount(oldest, now))
    if (!candles) { failedMarkets++; continue } // 다음 실행 때 재시도
    const confirmed = confirmedOhlcv(candlesToOhlcv(candles))
    for (const e of eps) {
      const s = scoreEpisode(e, confirmed, now)
      if (s.status !== e.status || s.scoredAt !== e.scoredAt) scored++
      updated.set(s.id, s)
    }
    await sleep(120) // 업비트 rate limit 여유
  }
  episodes = episodes.map((e) => updated.get(e.id) ?? e)

  await writeJson('scorecard.json', { updatedAt: new Date(now).toISOString(), episodes })
  const remain = episodes.filter((e) => e.status === 'pending' || e.status === 'partial').length
  console.log(`스코어카드: 에피소드 ${episodes.length} (신규 ${episodes.length - prevCount}) / 이번 채점 ${scored} / 남은 미채점 ${remain} / 실패 마켓 ${failedMarkets}`)
}

main()
```

- [ ] **Step 2: 문법·기존 스위트 확인**

Run: `node --check scripts/scorecard.mjs && npx vitest run __tests__/scorecard.test.mjs`
Expected: 문법 OK, 테스트 PASS. (실제 네트워크 실행은 Task 6 백필에서 — 여기서 실행하지 않는다.)

- [ ] **Step 3: gitignore·package.json 수정**

`.gitignore`의 `data/signal-weights.json` 줄 아래에 추가:

```
data/scorecard.json
```

`package.json` scripts의 `"flow"` 줄 아래에 추가:

```json
"scorecard": "node scripts/scorecard.mjs",
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/scorecard.mjs .gitignore package.json
git commit -m "feat: 스코어카드 배치 러너 (증분 채점, 마켓당 1-fetch)"
```

---

### Task 4: buildScorecard + GET /api/scorecard

**Files:**
- Modify: `server/api.mjs` (함수 추가)
- Modify: `server/server.mjs` (라우트 + import 추가)
- Test: `__tests__/api.test.mjs` (추가)

**Interfaces:**
- Consumes: Task 3의 scorecard.json 형태 `{ updatedAt, episodes }`.
- Produces: `buildScorecard(sc)` → `{ empty:true }` 또는 `{ updatedAt, total, pendingCount, noDataCount, horizons:{h1,h3,h7}, regimes:{pre,post}, episodes(최신순) }`. 각 h는 `{ n, winRate, avgRet, avgMfe }`.

- [ ] **Step 1: 실패하는 테스트 추가**

`__tests__/api.test.mjs` 끝에 append:

```js
import { buildScorecard } from '../server/api.mjs'

describe('buildScorecard', () => {
  const ep = (over) => ({
    id: 'x', market: 'KRW-X', korean_name: 'X', entryTs: '2026-07-14T00:00:00.000Z',
    entryPrice: 100, score: 10, signals: [], lowLiquidity: false,
    ret1: null, ret3: null, ret7: null, mfe1: null, mfe3: null, mfe7: null,
    status: 'pending', scoredAt: null, ...over,
  })
  it('빈 입력 → empty', () => {
    expect(buildScorecard({ episodes: [] }).empty).toBe(true)
    expect(buildScorecard(null).empty).toBe(true)
  })
  it('지평선별 승률·평균 (null 지평선 제외)', () => {
    const sc = { updatedAt: 'u', episodes: [
      ep({ id: 'a', ret1: 0.1, mfe1: 0.2, status: 'partial' }),
      ep({ id: 'b', ret1: -0.05, mfe1: 0.01, status: 'partial' }),
      ep({ id: 'c', status: 'pending' }), // 미채점 — h1 집계 제외
    ] }
    const r = buildScorecard(sc)
    expect(r.total).toBe(3)
    expect(r.pendingCount).toBe(3) // partial 2 + pending 1
    expect(r.horizons.h1.n).toBe(2)
    expect(r.horizons.h1.winRate).toBeCloseTo(0.5)
    expect(r.horizons.h1.avgRet).toBeCloseTo((0.1 - 0.05) / 2)
    expect(r.horizons.h1.avgMfe).toBeCloseTo((0.2 + 0.01) / 2)
    expect(r.horizons.h3.n).toBe(0)
    expect(r.horizons.h3.winRate).toBeNull()
  })
  it('확정봉 체제 전/후 분리 (cutover = 2026-07-12T15:00:00Z)', () => {
    const sc = { episodes: [
      ep({ id: 'pre1', entryTs: '2026-07-10T00:00:00.000Z', ret1: 0.1 }),
      ep({ id: 'post1', entryTs: '2026-07-13T00:00:00.000Z', ret1: -0.1 }),
    ] }
    const r = buildScorecard(sc)
    expect(r.regimes.pre.h1.n).toBe(1)
    expect(r.regimes.pre.h1.winRate).toBe(1)
    expect(r.regimes.post.h1.n).toBe(1)
    expect(r.regimes.post.h1.winRate).toBe(0)
  })
  it('에피소드 최신순 정렬 + no-data 카운트', () => {
    const sc = { episodes: [
      ep({ id: 'old', entryTs: '2026-07-01T00:00:00.000Z', status: 'no-data' }),
      ep({ id: 'new', entryTs: '2026-07-15T00:00:00.000Z' }),
    ] }
    const r = buildScorecard(sc)
    expect(r.episodes[0].id).toBe('new')
    expect(r.noDataCount).toBe(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: FAIL — `buildScorecard is not a function`

- [ ] **Step 3: 구현**

`server/api.mjs` 끝에 append:

```js
// 픽 성과 스코어카드 집계. sc = { updatedAt, episodes } (data/scorecard.json).
const SCORECARD_CUTOVER = Date.parse('2026-07-12T15:00:00Z') // 확정봉 체제 KST 2026-07-13 00:00

export function buildScorecard(sc) {
  const eps = sc?.episodes ?? []
  if (!eps.length) return { empty: true }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const agg = (list) => {
    const out = {}
    for (const n of [1, 3, 7]) {
      const scored = list.filter((e) => e[`ret${n}`] != null)
      out[`h${n}`] = {
        n: scored.length,
        winRate: scored.length ? scored.filter((e) => e[`ret${n}`] > 0).length / scored.length : null,
        avgRet: avg(scored.map((e) => e[`ret${n}`])),
        avgMfe: avg(scored.map((e) => e[`mfe${n}`]).filter((v) => v != null)),
      }
    }
    return out
  }
  return {
    updatedAt: sc.updatedAt ?? null,
    total: eps.length,
    pendingCount: eps.filter((e) => e.status === 'pending' || e.status === 'partial').length,
    noDataCount: eps.filter((e) => e.status === 'no-data').length,
    horizons: agg(eps),
    regimes: {
      pre: agg(eps.filter((e) => Date.parse(e.entryTs) < SCORECARD_CUTOVER)),
      post: agg(eps.filter((e) => Date.parse(e.entryTs) >= SCORECARD_CUTOVER)),
    },
    episodes: [...eps].sort((a, b) => String(b.entryTs).localeCompare(String(a.entryTs))),
  }
}
```

`server/server.mjs` 수정 — import 줄의 `buildRecommendations` 뒤에 `, buildScorecard` 추가:

```js
import { buildResults, buildInsights, buildVerify, buildHistory, buildScans, findScanByTimestamp, buildMomentum, buildFlow, buildRecommendations, buildScorecard } from './api.mjs'
```

`/api/momentum` 라우트 블록 아래에 추가:

```js
    if (p === '/api/scorecard') {
      return sendJson(res, 200, buildScorecard(await readJson('scorecard.json', { episodes: [] })))
    }
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: PASS (기존 + 신규 4 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/api.mjs server/server.mjs __tests__/api.test.mjs
git commit -m "feat: /api/scorecard — 지평선·체제별 집계"
```

---

### Task 5: 프론트엔드 — 스코어카드 탭

**Files:**
- Modify: `public/routes.js` (canonical에 `'scorecard'` 추가)
- Modify: `public/index.html` (nav 항목 추가)
- Modify: `public/app.js` (routes에 `scorecard()` 추가)
- Test: `__tests__/routes.test.mjs` (추가)

**Interfaces:**
- Consumes: Task 4의 `/api/scorecard` 응답. app.js 기존 헬퍼 `api()`, `setActiveTab()`, `esc()`, `fmt()`, `$()`(존재 시) — `view` 전역은 `document.getElementById('view')`로 이미 잡혀 있음.
- Produces: 해시 `#/scorecard` 라우트.

- [ ] **Step 1: routes 실패 테스트 추가**

`__tests__/routes.test.mjs`에 append:

```js
it('scorecard는 정식 라우트', () => {
  expect(resolveRoute('scorecard')).toBe('scorecard')
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/routes.test.mjs`
Expected: FAIL — `expected 'home' to be 'scorecard'`

- [ ] **Step 3: routes.js·index.html 수정**

`public/routes.js`의 canonical 줄 수정:

```js
  const canonical = ['home', 'analyze', 'review', 'scorecard']
```

`public/index.html`의 `기록·검증` nav 항목 아래에 추가:

```html
        <li><a href="#/scorecard" data-tab="scorecard"><span class="nav-ico">🎯</span> 스코어카드</a></li>
```

- [ ] **Step 4: routes 테스트 통과 확인**

Run: `npx vitest run __tests__/routes.test.mjs`
Expected: PASS

- [ ] **Step 5: app.js에 scorecard 라우트 구현**

`public/app.js`의 `routes` 객체 안, `async review() { ... }` 블록 뒤(콤마 유지)에 추가:

```js
  async scorecard() {
    setActiveTab('scorecard')
    view.innerHTML = '<span class="loading loading-spinner"></span>'
    let d
    try {
      d = await api('/api/scorecard')
    } catch {
      view.innerHTML = '<div class="alert alert-error">데이터 조회 실패 — 서버 연결을 확인하세요.</div>'
      return
    }
    const head = '<h2 class="text-2xl font-bold mb-4">🎯 픽 스코어카드</h2>'
    if (d.empty) {
      view.innerHTML = `${head}<div class="alert">아직 채점 전 — <code>npm run scorecard</code> 실행 후 표시됩니다.</div>`
      return
    }
    const pctCell = (v) => v == null ? '<span class="opacity-40">—</span>'
      : `<span class="${v >= 0 ? 'text-success' : 'text-error'}">${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%</span>`
    const kpiTile = (label, val, sub) => `<div class="kpi-tile"><div class="kpi-label">${label}</div><div class="kpi-val">${val}</div><div class="text-xs opacity-60">${sub}</div></div>`
    const hTile = (name, h) => kpiTile(name,
      h.winRate == null ? '—' : `${Math.round(h.winRate * 100)}%`,
      h.n ? `평균 ${pctCell(h.avgRet)} · MFE ${pctCell(h.avgMfe)} · n=${h.n}` : '표본 없음')
    const rg = (r) => r.h1.winRate == null ? '—' : `${Math.round(r.h1.winRate * 100)}% (n=${r.h1.n})`
    const statusBadge = (s) => ({
      done: '<span class="badge badge-sm badge-success badge-outline">완료</span>',
      partial: '<span class="badge badge-sm badge-info badge-outline">진행</span>',
      pending: '<span class="badge badge-sm badge-ghost">대기</span>',
      'no-data': '<span class="badge badge-sm badge-warning badge-outline">데이터없음</span>',
    }[s] ?? esc(s))
    const rows = (list) => list.map((e) => `<tr>
      <td><b>${esc(e.korean_name)}</b> <span class="text-xs opacity-60">${esc(e.market)}</span>${e.lowLiquidity ? ' <span class="badge badge-xs badge-warning">저유동</span>' : ''}</td>
      <td class="text-xs">${esc(String(e.entryTs).slice(0, 10))}</td>
      <td>${fmt(e.entryPrice)}</td>
      <td>${e.score ?? '-'}</td>
      <td>${pctCell(e.ret1)}</td><td>${pctCell(e.ret3)}</td><td>${pctCell(e.ret7)}</td>
      <td>${pctCell(e.mfe7)}</td>
      <td>${statusBadge(e.status)}</td>
    </tr>`).join('')
    view.innerHTML = `${head}
      <div class="kpi-row mb-4">
        ${hTile('+1일 승률', d.horizons.h1)}
        ${hTile('+3일 승률', d.horizons.h3)}
        ${hTile('+7일 승률', d.horizons.h7)}
        ${kpiTile('에피소드', d.total, `대기 ${d.pendingCount} · 데이터없음 ${d.noDataCount}`)}
      </div>
      <div class="alert mb-4 text-sm">확정봉 체제(7/13~) +1일 승률: 이전 <b>${rg(d.regimes.pre)}</b> → 이후 <b>${rg(d.regimes.post)}</b></div>
      <label class="label cursor-pointer justify-start gap-2 mb-2 text-sm"><input type="checkbox" id="scNoLowLiq" class="checkbox checkbox-sm"> 저유동성 제외</label>
      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead><tr><th>코인</th><th>진입일</th><th>진입가</th><th>점수</th><th>+1일</th><th>+3일</th><th>+7일</th><th>MFE(7일)</th><th>상태</th></tr></thead>
          <tbody id="scRows">${rows(d.episodes)}</tbody>
        </table>
      </div>
      <div class="text-xs opacity-50 mt-2">채점: ${esc(String(d.updatedAt ?? '-').replace('T', ' ').slice(0, 16))} UTC · 진입 시점 신규등장 기준 · 확정 종가/고가만 사용</div>`
    document.getElementById('scNoLowLiq').addEventListener('change', (ev) => {
      const list = ev.target.checked ? d.episodes.filter((e) => !e.lowLiquidity) : d.episodes
      document.getElementById('scRows').innerHTML = rows(list)
    })
  },
```

주의: `kpi-row`(컨테이너)·`kpi-tile`·`kpi-label`·`kpi-val` 클래스는 styles.css에 이미 존재 (홈 탭이 사용 중) — 새 CSS 불필요.

- [ ] **Step 6: 전체 스위트 확인**

Run: `npx vitest run`
Expected: 전체 PASS

- [ ] **Step 7: 커밋**

```bash
git add public/routes.js public/index.html public/app.js __tests__/routes.test.mjs
git commit -m "feat: 스코어카드 탭 — KPI·체제비교·에피소드 테이블"
```

---

### Task 6: 백필 실행·스케줄 등록·최종 검증

**Files:**
- Modify: `docs/CHANGELOG-2026-07.md` (섹션 추가)
- 실행: `scripts/scorecard.mjs` (첫 소급 채점), Windows 작업 등록, 서버 재시작

**Interfaces:**
- Consumes: Task 1~5 전부.
- Produces: `data/scorecard.json` (실데이터), `UpbitScorecard` 작업.

- [ ] **Step 1: 백필 실행 (첫 소급 채점)**

Run: `npm run scorecard`
Expected: `스코어카드: 에피소드 N (신규 N) / 이번 채점 M / 남은 미채점 K / 실패 마켓 0` 형태 출력. N은 200± 규모(6/11 이후 신규진입 수), 실패 마켓 0~소수.

- [ ] **Step 2: 산출물 확인**

Run: `node -e "const s=require('./data/scorecard.json'); console.log(s.episodes.length, s.episodes.filter(e=>e.status==='done').length, s.episodes.filter(e=>e.status==='pending').length)"`
Expected: 전체 수 / done 다수(오래된 에피소드) / pending 소수(최근 7일 내 진입분)

- [ ] **Step 3: Windows 작업 등록 (PowerShell)**

기존 UpbitMonitor와 동일 패턴 (cmd /c + 로그 리다이렉트 + StartWhenAvailable):

```powershell
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c ""C:\Program Files\nodejs\node.exe" "C:\Users\toodo\workspace\upbit-dashboard\scripts\scorecard.mjs" 1>> "C:\Users\toodo\workspace\upbit-dashboard\data\task-logs\UpbitScorecard.log" 2>&1"' -WorkingDirectory 'C:\Users\toodo\workspace\upbit-dashboard'
$trigger = New-ScheduledTaskTrigger -Daily -At '09:10'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'UpbitScorecard' -Action $action -Trigger $trigger -Settings $settings -Force
```

확인: `Get-ScheduledTask -TaskName 'UpbitScorecard' | Get-ScheduledTaskInfo`
Expected: NextRunTime = 다음 09:10

- [ ] **Step 4: 서버 재시작 + API 검증**

8787 서버 재시작 (기존 프로세스 종료 후 `npm run dashboard` 백그라운드):

```bash
curl -s "http://127.0.0.1:8787/api/scorecard" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const d=JSON.parse(s);console.log('total',d.total,'h1',JSON.stringify(d.horizons.h1),'pre',JSON.stringify(d.regimes.pre.h1),'post',JSON.stringify(d.regimes.post.h1))})"
```

Expected: total > 0, h1.winRate 0~1 사이 숫자, pre/post 각각 n > 0

- [ ] **Step 5: CHANGELOG 추가**

`docs/CHANGELOG-2026-07.md` 끝에 섹션 추가:

```markdown
## 7. 픽 성과 스코어카드 (2026-07-17)

- 스캔 아카이브의 매수 픽 **신규진입 에피소드**를 +1/+3/+7일 확정종가 수익률·MFE로 자동 채점.
- `lib/scorecard.mjs`(순수 로직) + `scripts/scorecard.mjs`(하루 1회 배치, UpbitScorecard 작업 KST 09:10) + `GET /api/scorecard` + 대시보드 "스코어카드" 탭.
- 확정봉 체제(7/13) 전/후 +1일 승률 분리 집계 — 새 체제 효과를 상시 검증.
- `data/scorecard.json`은 gitignore. 손상 시 아카이브에서 전체 재생성 가능.
- 스펙: `docs/superpowers/specs/2026-07-17-pick-scorecard-design.md`
```

- [ ] **Step 6: 최종 커밋**

```bash
git add docs/CHANGELOG-2026-07.md
git commit -m "docs: CHANGELOG — 픽 성과 스코어카드"
```
