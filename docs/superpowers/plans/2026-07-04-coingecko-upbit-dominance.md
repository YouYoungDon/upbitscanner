# 코인게코 업비트 단독 펌프 감지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코인게코 글로벌 24h 거래대금 대비 업비트 비중으로 단독 펌프를 감지해 세 스캐너(monitor/momentum/flow)에 경고 라벨+감점을 적용하고, FDV·ATH 등 확장 필드를 캐시·아카이브에 축적한다.

**Architecture:** `lib/coingecko.mjs`(HTTP 클라이언트) + `lib/cg-data.mjs`(심볼 매핑·시세 캐시 오케스트레이션, 파일락) + `scan-universe.mjs`의 순수 판정 함수. 어떤 코인게코 실패에도 중립(감점 없음)으로 폴백 — 스캔 불사침.

**Tech Stack:** Node.js ESM(의존성 0), vitest, 기존 store.mjs의 `readJson`/`writeJson`/`withLock` 재사용.

**Spec:** `docs/superpowers/specs/2026-07-04-coingecko-upbit-dominance-design.md`

## Global Constraints

- Demo 키 파일 `data/coingecko-key.json`(`{"apiKey": "..."}`)은 **이미 생성·gitignore 처리됨** (커밋 e567c5a). 키 값을 코드·커밋·로그·이 문서에 절대 쓰지 말 것.
- base URL `https://api.coingecko.com/api/v3`, 인증 헤더 `x-cg-demo-api-key` (실측 검증됨 2026-07-04).
- 모든 데이터 파일 쓰기는 store.mjs `writeJson`(원자적) 사용, 읽기-수정-쓰기는 `withLock`으로 직렬화.
- 코인게코 실패(키 없음·429·타임아웃·매핑 실패·stale 캐시)는 전부 중립: `{ byMarket: {}, coverage: 0 }` 반환, `process.exit` 금지, 기존 스캔 출력 무변.
- 캐시 TTL 150분(`CACHE_TTL_MS`), 매핑 TTL 7일(`MAP_TTL_MS`). stale 캐시는 감점에 사용하지 않는다(중립).
- 테스트: `npx vitest run` (전체), 개별은 `npx vitest run __tests__/<file>`. 기존 전체 테스트 통과 유지.
- 수동 라이브 검증은 정시 슬롯(xx:00·02·05·17) 피해서 실행 (라이브 데이터 경합 방지 — 2026-06-29 교훈).
- 코드 주석·스타일은 기존 파일(한국어 간결 주석, 세미콜론 없음) 따를 것.

---

### Task 1: 코인게코 HTTP 클라이언트 `lib/coingecko.mjs`

**Files:**
- Create: `lib/coingecko.mjs`
- Test: `__tests__/coingecko.test.mjs`

**Interfaces:**
- Produces: `loadApiKey(readJsonFn, env?) → Promise<string|null>`
- Produces: `fetchCgMarkets(ids: string[], apiKey, opts?: {fetchImpl, retries, sleepMs}) → Promise<object[]|null>` — `/coins/markets` 행 배열(코인게코 원본 스키마), 실패 시 null
- Produces: `fetchCgCoinsList(apiKey, opts?) → Promise<{id,symbol,name}[]|null>`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// __tests__/coingecko.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { loadApiKey, fetchCgMarkets, fetchCgCoinsList } from '../lib/coingecko.mjs'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const err = (status) => ({ ok: false, status, json: async () => ({}) })

describe('loadApiKey', () => {
  it('환경변수 우선', async () => {
    const key = await loadApiKey(async () => ({ apiKey: 'file-key' }), { COINGECKO_API_KEY: 'env-key' })
    expect(key).toBe('env-key')
  })
  it('환경변수 없으면 파일', async () => {
    expect(await loadApiKey(async () => ({ apiKey: 'file-key' }), {})).toBe('file-key')
  })
  it('둘 다 없으면 null', async () => {
    expect(await loadApiKey(async () => null, {})).toBe(null)
  })
})

describe('fetchCgMarkets', () => {
  it('키 없거나 ids 비면 null', async () => {
    expect(await fetchCgMarkets(['bitcoin'], null)).toBe(null)
    expect(await fetchCgMarkets([], 'k')).toBe(null)
  })
  it('250개씩 분할 호출·합침', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `c${i}`)
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok([{ id: 'a' }])).mockResolvedValueOnce(ok([{ id: 'b' }]))
    const rows = await fetchCgMarkets(ids, 'k', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }])
    // 요청 URL 검증: krw + 7d/30d 수익률 + demo 헤더
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('vs_currency=krw')
    expect(url).toContain('price_change_percentage=7d%2C30d')
    expect(init.headers['x-cg-demo-api-key']).toBe('k')
  })
  it('429는 재시도 후 성공', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(err(429)).mockResolvedValueOnce(ok([{ id: 'a' }]))
    const rows = await fetchCgMarkets(['a'], 'k', { fetchImpl, sleepMs: 1 })
    expect(rows).toEqual([{ id: 'a' }])
  })
  it('4xx(429 제외)는 즉시 null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(err(400))
    expect(await fetchCgMarkets(['a'], 'k', { fetchImpl, sleepMs: 1 })).toBe(null)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('재시도 소진 시 null, 부분 성공은 확보분 반환', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `c${i}`)
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok([{ id: 'a' }])).mockResolvedValue(err(500))
    const rows = await fetchCgMarkets(ids, 'k', { fetchImpl, retries: 1, sleepMs: 1 })
    expect(rows).toEqual([{ id: 'a' }]) // 1페이지 확보분
  })
})

describe('fetchCgCoinsList', () => {
  it('키 없으면 null', async () => { expect(await fetchCgCoinsList(null)).toBe(null) })
  it('정상 조회', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }]))
    expect(await fetchCgCoinsList('k', { fetchImpl })).toEqual([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/coingecko.test.mjs`
Expected: FAIL — `Cannot find module '../lib/coingecko.mjs'`

- [ ] **Step 3: 최소 구현**

```js
// lib/coingecko.mjs
const BASE = 'https://api.coingecko.com/api/v3'

// Demo 키: 환경변수 → data/coingecko-key.json → null (null이면 상위에서 전 기능 무해 skip)
export async function loadApiKey(readJsonFn, env = process.env) {
  if (env.COINGECKO_API_KEY) return env.COINGECKO_API_KEY
  const f = await readJsonFn('coingecko-key.json', null)
  return f?.apiKey || null
}

// upbit.mjs get()과 동일 정책: 429/5xx/네트워크는 지수 백오프 재시도, 그 외 4xx는 즉시 포기
async function cgGet(path, apiKey, { retries = 2, fetchImpl = fetch, sleepMs = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetchImpl(`${BASE}${path}`, { headers: { Accept: 'application/json', 'x-cg-demo-api-key': apiKey } })
      if (r.ok) return r.json()
      if (attempt >= retries || (r.status < 500 && r.status !== 429)) return null
    } catch {
      if (attempt >= retries) return null
    }
    await new Promise((res) => setTimeout(res, sleepMs * (attempt + 1)))
  }
}

// ids를 250개씩 분할해 /coins/markets 조회 (KRW 기준 — 환율 변환 불필요, 7d/30d 수익률 포함).
// 전체 실패 → null, 부분 실패 → 확보분 반환.
export async function fetchCgMarkets(ids, apiKey, opts = {}) {
  if (!apiKey || !ids?.length) return null
  const out = []
  for (let i = 0; i < ids.length; i += 250) {
    const q = new URLSearchParams({
      vs_currency: 'krw', ids: ids.slice(i, i + 250).join(','), per_page: '250', price_change_percentage: '7d,30d',
    })
    const page = await cgGet(`/coins/markets?${q}`, apiKey, opts)
    if (!page) return out.length ? out : null
    out.push(...page)
  }
  return out
}

// 전체 코인 id/symbol 목록 (심볼 매핑 재구축용, 주 1회)
export async function fetchCgCoinsList(apiKey, opts = {}) {
  if (!apiKey) return null
  return cgGet('/coins/list', apiKey, opts)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/coingecko.test.mjs`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add lib/coingecko.mjs __tests__/coingecko.test.mjs
git commit -m "feat(cg): coingecko demo-api client (retry, krw bulk markets)"
```

---

### Task 2: 심볼 매핑 순수 함수 (`lib/cg-data.mjs` 1/3)

**Files:**
- Create: `lib/cg-data.mjs`
- Test: `__tests__/cg-data.test.mjs`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: `candidatesBySymbol(upbitMarkets: string[], coinsList: {id,symbol}[]) → { [symLower]: string[] }` — 업비트 심볼별 코인게코 id 후보
- Produces: `resolveCollisions(upbitMarkets, candidates, marketRows) → { [market]: string|null }` — rank 최저(순위 최고) 승, rank null은 후순위, 동률은 mcap 큰 쪽
- Produces: `isFresh(obj, ttlMs, now?) → boolean` — `fetchedAt`/`builtAt` 기준
- Produces: `CACHE_TTL_MS = 9_000_000` (150분), `MAP_TTL_MS = 604_800_000` (7일)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// __tests__/cg-data.test.mjs
import { describe, it, expect } from 'vitest'
import { candidatesBySymbol, resolveCollisions, isFresh, CACHE_TTL_MS, MAP_TTL_MS } from '../lib/cg-data.mjs'

describe('candidatesBySymbol', () => {
  it('업비트 심볼과 코인게코 심볼 대소문자 무시 매칭', () => {
    const list = [
      { id: 'space-id', symbol: 'id' }, { id: 'other-id-coin', symbol: 'ID' },
      { id: 'bitcoin', symbol: 'btc' }, { id: 'unrelated', symbol: 'zzz' },
    ]
    expect(candidatesBySymbol(['KRW-ID', 'KRW-BTC', 'KRW-NEW'], list)).toEqual({
      id: ['space-id', 'other-id-coin'], btc: ['bitcoin'], new: [],
    })
  })
})

describe('resolveCollisions', () => {
  const rows = [
    { id: 'space-id', market_cap_rank: 969, market_cap: 23e9 },
    { id: 'other-id-coin', market_cap_rank: 4000, market_cap: 1e8 },
    { id: 'bitcoin', market_cap_rank: 1, market_cap: 1.9e15 },
  ]
  it('충돌 시 rank 최저(순위 최고) 승', () => {
    const map = resolveCollisions(['KRW-ID', 'KRW-BTC'], { id: ['space-id', 'other-id-coin'], btc: ['bitcoin'] }, rows)
    expect(map).toEqual({ 'KRW-ID': 'space-id', 'KRW-BTC': 'bitcoin' })
  })
  it('rank null은 후순위, 동률은 mcap 큰 쪽', () => {
    const r = [
      { id: 'a', market_cap_rank: null, market_cap: 9e9 },
      { id: 'b', market_cap_rank: 500, market_cap: 1e9 },
      { id: 'c', market_cap_rank: 500, market_cap: 2e9 },
    ]
    expect(resolveCollisions(['KRW-X'], { x: ['a', 'b', 'c'] }, r)).toEqual({ 'KRW-X': 'c' })
  })
  it('후보 없거나 rows에 없으면 null 기록 (재시도 억제)', () => {
    expect(resolveCollisions(['KRW-NEW'], { new: [] }, rows)).toEqual({ 'KRW-NEW': null })
    expect(resolveCollisions(['KRW-Y'], { y: ['ghost'] }, rows)).toEqual({ 'KRW-Y': null })
  })
})

describe('isFresh', () => {
  const now = Date.parse('2026-07-04T12:00:00Z')
  it('TTL 이내 fresh', () => {
    expect(isFresh({ fetchedAt: '2026-07-04T10:00:00Z' }, CACHE_TTL_MS, now)).toBe(true)
    expect(isFresh({ builtAt: '2026-07-01T12:00:00Z' }, MAP_TTL_MS, now)).toBe(true)
  })
  it('TTL 초과·필드 없음·깨진 날짜는 stale', () => {
    expect(isFresh({ fetchedAt: '2026-07-04T09:29:00Z' }, CACHE_TTL_MS, now)).toBe(false)
    expect(isFresh(null, CACHE_TTL_MS, now)).toBe(false)
    expect(isFresh({}, CACHE_TTL_MS, now)).toBe(false)
    expect(isFresh({ fetchedAt: 'garbage' }, CACHE_TTL_MS, now)).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/cg-data.test.mjs`
Expected: FAIL — `Cannot find module '../lib/cg-data.mjs'`

- [ ] **Step 3: 최소 구현**

```js
// lib/cg-data.mjs — 코인게코 심볼 매핑·시세 캐시 (파일: data/coingecko-map.json, data/coingecko-cache.json)
export const CACHE_TTL_MS = 150 * 60 * 1000     // 150분: 3시간 사이클 첫 스캐너만 갱신
export const MAP_TTL_MS = 7 * 24 * 3600 * 1000  // 매핑은 주 1회 재구축

// 업비트 심볼(소문자)별 코인게코 id 후보. 매칭 없으면 빈 배열(→ null 매핑으로 재시도 억제).
export function candidatesBySymbol(upbitMarkets, coinsList) {
  const bySym = {}
  for (const m of upbitMarkets) bySym[m.split('-')[1].toLowerCase()] = []
  for (const c of coinsList) {
    const s = (c.symbol || '').toLowerCase()
    if (s in bySym) bySym[s].push(c.id)
  }
  return bySym
}

// 동일 심볼 충돌: market_cap_rank 최저(순위 최고) 승, rank null 후순위, 동률은 mcap 큰 쪽.
export function resolveCollisions(upbitMarkets, candidates, marketRows) {
  const rowOf = Object.fromEntries((marketRows || []).map((r) => [r.id, r]))
  const out = {}
  for (const m of upbitMarkets) {
    const ids = (candidates[m.split('-')[1].toLowerCase()] || []).filter((id) => rowOf[id])
    ids.sort((a, b) => {
      const ra = rowOf[a].market_cap_rank ?? Infinity, rb = rowOf[b].market_cap_rank ?? Infinity
      return ra - rb || (rowOf[b].market_cap ?? 0) - (rowOf[a].market_cap ?? 0)
    })
    out[m] = ids[0] ?? null
  }
  return out
}

// fetchedAt/builtAt 기준 TTL 판정. 필드 없음·파싱 불가 → stale.
export function isFresh(obj, ttlMs, now = Date.now()) {
  const t = Date.parse(obj?.fetchedAt ?? obj?.builtAt ?? '')
  return Number.isFinite(t) && now - t < ttlMs
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/cg-data.test.mjs`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/cg-data.mjs __tests__/cg-data.test.mjs
git commit -m "feat(cg): symbol mapping pure functions (collision by rank, ttl)"
```

---

### Task 3: 캐시 엔트리 변환 (`lib/cg-data.mjs` 2/3)

**Files:**
- Modify: `lib/cg-data.mjs` (함수 추가)
- Test: `__tests__/cg-data.test.mjs` (describe 추가)

**Interfaces:**
- Produces: `toCacheEntry(row) → { globalVolKrw, mcapKrw, rank, fdvKrw, circRatio, athChangePct, ret7dPct, ret30dPct }` — 코인게코 `/coins/markets` 원본 행을 캐시 엔트리로

- [ ] **Step 1: 실패하는 테스트 추가** (`__tests__/cg-data.test.mjs`에 append)

```js
import { toCacheEntry } from '../lib/cg-data.mjs' // 상단 import에 추가

describe('toCacheEntry', () => {
  it('원본 행 → 캐시 엔트리 (circRatio = mcap/fdv)', () => {
    expect(toCacheEntry({
      total_volume: 64795357454, market_cap: 23052631548, market_cap_rank: 969,
      fully_diluted_valuation: 106914346271, ath_change_percentage: -97.807,
      price_change_percentage_7d_in_currency: -1.2, price_change_percentage_30d_in_currency: 8.4,
    })).toEqual({
      globalVolKrw: 64795357454, mcapKrw: 23052631548, rank: 969, fdvKrw: 106914346271,
      circRatio: 0.216, athChangePct: -97.807, ret7dPct: -1.2, ret30dPct: 8.4,
    })
  })
  it('FDV 없음/0 → circRatio null, 결측 필드는 null', () => {
    const e = toCacheEntry({ total_volume: 1e9 })
    expect(e).toEqual({
      globalVolKrw: 1e9, mcapKrw: null, rank: null, fdvKrw: null,
      circRatio: null, athChangePct: null, ret7dPct: null, ret30dPct: null,
    })
    expect(toCacheEntry({ market_cap: 1e9, fully_diluted_valuation: 0 }).circRatio).toBe(null)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/cg-data.test.mjs`
Expected: FAIL — `toCacheEntry is not a function`

- [ ] **Step 3: 구현** (`lib/cg-data.mjs`에 추가)

```js
// /coins/markets 원본 행 → 캐시 엔트리. circRatio = 유통량 비율(mcap/FDV, 언락 오버행 프록시).
export function toCacheEntry(row) {
  const mcap = row.market_cap ?? null
  const fdv = row.fully_diluted_valuation ?? null
  return {
    globalVolKrw: row.total_volume ?? null,
    mcapKrw: mcap,
    rank: row.market_cap_rank ?? null,
    fdvKrw: fdv,
    circRatio: mcap != null && fdv > 0 ? +(mcap / fdv).toFixed(3) : null,
    athChangePct: row.ath_change_percentage ?? null,
    ret7dPct: row.price_change_percentage_7d_in_currency ?? null,
    ret30dPct: row.price_change_percentage_30d_in_currency ?? null,
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run __tests__/cg-data.test.mjs` → PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/cg-data.mjs __tests__/cg-data.test.mjs
git commit -m "feat(cg): cache entry mapper with free fields (fdv/ath/7d/30d)"
```

---

### Task 4: 오케스트레이터 `ensureCgData` (`lib/cg-data.mjs` 3/3)

**Files:**
- Modify: `lib/cg-data.mjs`
- Test: `__tests__/cg-data.test.mjs` (describe 추가)

**Interfaces:**
- Consumes: Task 1 `loadApiKey`/`fetchCgMarkets`/`fetchCgCoinsList`, store.mjs `readJson`/`writeJson`/`withLock`
- Produces: `ensureCgData(markets: string[], { allowFetch=true, now=Date.now(), deps={} }) → Promise<{ byMarket: {[market]: cacheEntry}, coverage: number }>` — **어떤 실패에도 `{ byMarket: {}, coverage: 0 }`**. `deps`로 모든 IO 주입 가능(테스트용): `{ readJson, writeJson, withLock, loadApiKey, fetchCgMarkets, fetchCgCoinsList, env }`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
import { ensureCgData } from '../lib/cg-data.mjs' // 상단 import에 추가

// 인메모리 파일 시스템 + 주입 deps 헬퍼
function makeDeps(files, { key = 'k', coinsList, marketRows } = {}) {
  const calls = { marketsFetches: 0, listFetches: 0 }
  return {
    deps: {
      readJson: async (name, fb) => files[name] ?? fb,
      writeJson: async (name, data) => { files[name] = data },
      withLock: async (_name, fn) => fn(),
      loadApiKey: async () => key,
      fetchCgCoinsList: async () => { calls.listFetches++; return coinsList ?? null },
      fetchCgMarkets: async () => { calls.marketsFetches++; return marketRows ?? null },
      env: {},
    },
    calls, files,
  }
}
const NOW = Date.parse('2026-07-04T12:00:00Z')
const ROW = { id: 'space-id', total_volume: 6e10, market_cap: 2.3e10, market_cap_rank: 969 }

describe('ensureCgData', () => {
  it('맵·캐시 신선하면 fetch 없이 캐시 반환, coverage 계산', async () => {
    const { deps, calls } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id', 'KRW-NEW': null } },
      'coingecko-cache.json': { fetchedAt: '2026-07-04T11:00:00Z', byMarket: { 'KRW-ID': { globalVolKrw: 6e10 } } },
    })
    const r = await ensureCgData(['KRW-ID', 'KRW-NEW'], { now: NOW, deps })
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
    expect(r.coverage).toBe(0.5)
    expect(calls.marketsFetches + calls.listFetches).toBe(0)
  })
  it('캐시 stale + allowFetch → 재조회·파일 갱신', async () => {
    const { deps, files } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
      'coingecko-cache.json': { fetchedAt: '2026-07-04T08:00:00Z', byMarket: {} },
    }, { marketRows: [ROW] })
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
    expect(files['coingecko-cache.json'].fetchedAt).toBe(new Date(NOW).toISOString())
  })
  it('캐시 stale + allowFetch=false → 중립', async () => {
    const { deps } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
      'coingecko-cache.json': { fetchedAt: '2026-07-04T08:00:00Z', byMarket: { 'KRW-ID': { globalVolKrw: 6e10 } } },
    })
    const r = await ensureCgData(['KRW-ID'], { allowFetch: false, now: NOW, deps })
    expect(r).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('맵 없음 → coins/list + markets로 재구축 후 캐시까지 채움', async () => {
    const { deps, files } = makeDeps({}, {
      coinsList: [{ id: 'space-id', symbol: 'id' }, { id: 'other-id-coin', symbol: 'id' }],
      marketRows: [ROW, { id: 'other-id-coin', total_volume: 1, market_cap: 1, market_cap_rank: 4000 }],
    })
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(files['coingecko-map.json'].byMarket['KRW-ID']).toBe('space-id')
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
  })
  it('키 없음 → 중립', async () => {
    const { deps } = makeDeps({}, { key: null })
    expect(await ensureCgData(['KRW-ID'], { now: NOW, deps })).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('fetch 전부 실패 → 중립 (throw 없음)', async () => {
    const { deps } = makeDeps({}) // coinsList/marketRows = null
    expect(await ensureCgData(['KRW-ID'], { now: NOW, deps })).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('맵 fresh지만 새 심볼 등장 → allowFetch면 재구축', async () => {
    const { deps, files } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-04T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
    }, {
      coinsList: [{ id: 'space-id', symbol: 'id' }, { id: 'newcoin', symbol: 'new' }],
      marketRows: [ROW, { id: 'newcoin', total_volume: 5, market_cap: 5, market_cap_rank: 100 }],
    })
    await ensureCgData(['KRW-ID', 'KRW-NEW'], { now: NOW, deps })
    expect(files['coingecko-map.json'].byMarket['KRW-NEW']).toBe('newcoin')
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run __tests__/cg-data.test.mjs` → FAIL (`ensureCgData is not a function`)

- [ ] **Step 3: 구현** (`lib/cg-data.mjs`에 추가 — 파일 상단에 import 추가)

```js
import { readJson, writeJson, withLock } from './store.mjs'
import { loadApiKey, fetchCgMarkets, fetchCgCoinsList } from './coingecko.mjs'

// 매핑 재구축: coins/list → 심볼 후보 → 후보 전체 markets 조회 → 충돌 해소. 실패 시 기존 맵 유지.
async function rebuildMap(markets, oldMap, d, now) {
  const list = await d.fetchCgCoinsList(d.apiKey)
  if (!list) return oldMap
  const candidates = candidatesBySymbol(markets, list)
  const allIds = [...new Set(Object.values(candidates).flat())]
  const rows = allIds.length ? await d.fetchCgMarkets(allIds, d.apiKey) : []
  if (!rows && allIds.length) return oldMap
  const byMarket = { ...(oldMap?.byMarket || {}), ...resolveCollisions(markets, candidates, rows || []) }
  const next = { builtAt: new Date(now).toISOString(), byMarket }
  await d.withLock('coingecko-map', () => d.writeJson('coingecko-map.json', next))
  return next
}

// 캐시 갱신: 락 안에서 fresh 재확인(double-check) 후 매핑된 id 일괄 조회. 실패 시 null.
async function refreshCache(markets, map, d, now) {
  return d.withLock('coingecko-cache', async () => {
    const cur = await d.readJson('coingecko-cache.json', null)
    if (isFresh(cur, CACHE_TTL_MS, now)) return cur // 다른 스캐너가 방금 갱신함
    const idOf = {}
    for (const m of markets) { const id = map.byMarket?.[m]; if (id) idOf[m] = id }
    const ids = [...new Set(Object.values(idOf))]
    if (!ids.length) return null
    const rows = await d.fetchCgMarkets(ids, d.apiKey)
    if (!rows) return null
    const entryOf = Object.fromEntries(rows.map((r) => [r.id, toCacheEntry(r)]))
    const byMarket = {}
    for (const [m, id] of Object.entries(idOf)) { if (entryOf[id]) byMarket[m] = entryOf[id] }
    const next = { fetchedAt: new Date(now).toISOString(), byMarket }
    await d.writeJson('coingecko-cache.json', next)
    return next
  })
}

// 스캐너 진입점. 어떤 실패에도 { byMarket: {}, coverage: 0 } — 스캔 불사침.
export async function ensureCgData(markets, { allowFetch = true, now = Date.now(), deps = {} } = {}) {
  const NEUTRAL = { byMarket: {}, coverage: 0 }
  try {
    const d = { readJson, writeJson, withLock, loadApiKey, fetchCgMarkets, fetchCgCoinsList, env: process.env, ...deps }
    d.apiKey = await d.loadApiKey(d.readJson, d.env)
    if (!d.apiKey) return NEUTRAL

    let map = await d.readJson('coingecko-map.json', null)
    const missing = markets.some((m) => !(m in (map?.byMarket || {})))
    if (allowFetch && (!isFresh(map, MAP_TTL_MS, now) || missing)) map = await rebuildMap(markets, map, d, now)
    if (!map?.byMarket) return NEUTRAL

    let cache = await d.readJson('coingecko-cache.json', null)
    if (allowFetch && !isFresh(cache, CACHE_TTL_MS, now)) cache = await refreshCache(markets, map, d, now)
    if (!isFresh(cache, CACHE_TTL_MS, now)) return NEUTRAL // stale 캐시로 감점하지 않는다

    const byMarket = {}
    let covered = 0
    for (const m of markets) { const e = cache.byMarket?.[m]; if (e) { byMarket[m] = e; covered++ } }
    return { byMarket, coverage: markets.length ? +(covered / markets.length).toFixed(2) : 0 }
  } catch {
    return NEUTRAL
  }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run __tests__/cg-data.test.mjs` → PASS 전체

- [ ] **Step 5: 커밋**

```bash
git add lib/cg-data.mjs __tests__/cg-data.test.mjs
git commit -m "feat(cg): ensureCgData orchestrator (map rebuild, cache ttl, neutral fallback)"
```

---

### Task 5: 판정 함수 `upbitDominancePenalty` (scan-universe.mjs)

**Files:**
- Modify: `lib/scan-universe.mjs` (liquidityPenalty 아래에 추가)
- Test: `__tests__/scan-universe.test.mjs` (describe 추가)

**Interfaces:**
- Produces: `upbitDominancePenalty(upbit24hKrw, globalVolKrw) → { mult: number, share: number|null, label: string|null }`

- [ ] **Step 1: 실패하는 테스트 추가** (`__tests__/scan-universe.test.mjs`에 — 기존 import 문에 `upbitDominancePenalty` 추가)

```js
describe('upbitDominancePenalty', () => {
  it('글로벌 데이터 없음/0/업비트 null → 중립', () => {
    expect(upbitDominancePenalty(1e9, null)).toEqual({ mult: 1.0, share: null, label: null })
    expect(upbitDominancePenalty(1e9, 0)).toEqual({ mult: 1.0, share: null, label: null })
    expect(upbitDominancePenalty(null, 1e9)).toEqual({ mult: 1.0, share: null, label: null })
  })
  it('비중 80%+ → ×0.8 + 업비트단독 라벨', () => {
    const r = upbitDominancePenalty(8e9, 1e10)
    expect(r.mult).toBe(0.8)
    expect(r.share).toBe(0.8)
    expect(r.label).toBe('⚠️업비트단독 80%')
  })
  it('비중 50%+ → ×0.9 + 업비트비중 라벨', () => {
    const r = upbitDominancePenalty(5e9, 1e10)
    expect(r.mult).toBe(0.9)
    expect(r.label).toBe('⚠️업비트비중 50%')
  })
  it('비중 50% 미만 → 감점 없음, share는 기록', () => {
    const r = upbitDominancePenalty(3e9, 1e10)
    expect(r).toEqual({ mult: 1.0, share: 0.3, label: null })
  })
  it('업비트가 글로벌보다 크면(집계 시차) share는 1로 캡', () => {
    const r = upbitDominancePenalty(2e10, 1e10)
    expect(r.share).toBe(1)
    expect(r.mult).toBe(0.8)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run __tests__/scan-universe.test.mjs` → FAIL

- [ ] **Step 3: 구현** (`lib/scan-universe.mjs`의 `liquidityPenalty` 아래에 추가)

```js
// 업비트 단독 펌프 감지: 글로벌(코인게코) 24h 거래대금 대비 업비트 비중.
// 데이터 없으면 중립(신규 상장·미등록 코인은 위험이 아니라 미확인). share는 집계 시차 대비 1로 캡.
export function upbitDominancePenalty(upbit24hKrw, globalVolKrw) {
  if (upbit24hKrw == null || !globalVolKrw || globalVolKrw <= 0) return { mult: 1.0, share: null, label: null }
  const share = +Math.min(1, upbit24hKrw / globalVolKrw).toFixed(3)
  const pct = Math.round(share * 100)
  if (share >= 0.8) return { mult: 0.8, share, label: `⚠️업비트단독 ${pct}%` }
  if (share >= 0.5) return { mult: 0.9, share, label: `⚠️업비트비중 ${pct}%` }
  return { mult: 1.0, share, label: null }
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run __tests__/scan-universe.test.mjs` → PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/scan-universe.mjs __tests__/scan-universe.test.mjs
git commit -m "feat(cg): upbitDominancePenalty (share>=0.5 x0.9, >=0.8 x0.8)"
```

---

### Task 6: monitor.mjs 연결 (fetch 주체 + 감점 + 아카이브 필드)

**Files:**
- Modify: `scripts/monitor.mjs`

**Interfaces:**
- Consumes: `ensureCgData(markets, {allowFetch})` (Task 4), `upbitDominancePenalty` (Task 5)
- Produces: 아카이브/로그 엔트리에 `cgCoverage: number`, 매수 픽에 `dominance: {share, mult}` + `cg: {circRatio, athChangePct, rank}`

- [ ] **Step 1: import 추가 및 유니버스 직후 코인게코 데이터 확보**

`scripts/monitor.mjs` 상단 import에 추가:

```js
import { getScanUniverse, BATCH, DELAY, sleep, liquidityPenalty, upbitDominancePenalty } from '../lib/scan-universe.mjs'
import { ensureCgData } from '../lib/cg-data.mjs'
```

`main()`에서 `console.log(\`스캔 대상 ...\`)` 바로 다음 줄에 추가 (monitor가 사이클 첫 스캐너 = fetch 주체):

```js
// 코인게코 글로벌 데이터 (사이클 첫 스캐너가 갱신, 실패 시 중립 — 스캔 불사침)
const cg = await ensureCgData(targets, { allowFetch: true })
console.log(`코인게코 커버리지: ${(cg.coverage * 100).toFixed(0)}%`)
```

- [ ] **Step 2: 감점 적용** — `liquidityPenalty` 적용 블록(`if (liqMult < 1) {...}`) 바로 아래에 추가:

```js
      // 업비트 단독 펌프 감점 (코인게코 글로벌 거래대금 대비 비중)
      const dom = upbitDominancePenalty(tradePrice[market], cg.byMarket[market]?.globalVolKrw)
      if (dom.mult < 1) { finalBuyScore *= dom.mult; buySignals = [...buySignals, dom.label] }
```

- [ ] **Step 3: 픽·엔트리 필드 저장** — 매수 item 생성 블록(`if (finalBuyScore >= BUY_THRESHOLD ...)`) 안, `if (lowLiq) item.lowLiquidity = true` 아래에 추가:

```js
        if (dom.share != null) item.dominance = { share: dom.share, mult: dom.mult }
        const cgE = cg.byMarket[market]
        if (cgE) item.cg = { circRatio: cgE.circRatio, athChangePct: cgE.athChangePct, rank: cgE.rank }
```

`const entry = { timestamp: ..., buy, sell, regime: regimeInfo }` 다음 줄에 추가:

```js
  entry.cgCoverage = cg.coverage
```

- [ ] **Step 4: 전체 테스트 + 라이브 검증**

Run: `npx vitest run`
Expected: 전체 PASS (기존 포함)

Run (정시 슬롯 xx:00·02·05·17 피해서): `node scripts/monitor.mjs`
Expected: 콘솔에 `코인게코 커버리지: NN%` (0보다 큼), `data/coingecko-map.json`·`data/coingecko-cache.json` 생성됨, `data/monitor-log.json` 마지막 스캔 엔트리에 `cgCoverage` 존재. 오류·exit 1 없음.

- [ ] **Step 5: 커밋**

```bash
git add scripts/monitor.mjs
git commit -m "feat(cg): wire dominance penalty + cg fields into monitor scan"
```

---

### Task 7: momentum-scan.mjs 연결 (캐시 읽기 전용)

**Files:**
- Modify: `scripts/momentum-scan.mjs`

**Interfaces:**
- Consumes: `ensureCgData(targets, { allowFetch: false })` — momentum(xx:02)은 monitor(xx:00)가 만든 캐시만 읽음. stale이면 중립.

- [ ] **Step 1: import 추가**

```js
import { getScanUniverse, BATCH, DELAY, sleep, liquidityPenalty, upbitDominancePenalty } from '../lib/scan-universe.mjs'
import { ensureCgData } from '../lib/cg-data.mjs'
```

- [ ] **Step 2: 유니버스 직후 캐시 읽기 + 감점 적용**

`getScanUniverse()` 호출 다음에:

```js
  const cg = await ensureCgData(targets, { allowFetch: false }) // 캐시만 읽기 (monitor가 갱신 주체)
```

`liquidityPenalty` 적용 줄(`scripts/momentum-scan.mjs:22-23`, `if (liqMult < 1) {...}`) 바로 아래에 추가 (`tradePrice`는 이미 line 10에서 구조분해돼 있음):

```js
      // 업비트 단독 펌프 감점 (코인게코 글로벌 거래대금 대비 비중)
      const dom = upbitDominancePenalty(tradePrice[market], cg.byMarket[market]?.globalVolKrw)
      if (dom.mult < 1) { score = +(score * dom.mult).toFixed(1); signals = [...signals, dom.label] }
```

픽 객체(line 27-29, `if (lowLiq) pick.lowLiquidity = true` 아래)에 추가:

```js
        if (dom.share != null) pick.dominance = { share: dom.share, mult: dom.mult }
```

- [ ] **Step 3: 전체 테스트** — `npx vitest run` → PASS

- [ ] **Step 4: 라이브 검증** (monitor가 캐시를 만든 뒤): `node scripts/momentum-scan.mjs`
Expected: 정상 완료, 오류 없음. 캐시가 fresh면 dominance 반영, 없어도 스캔 정상.

- [ ] **Step 5: 커밋**

```bash
git add scripts/momentum-scan.mjs
git commit -m "feat(cg): dominance penalty in momentum scan (cache read-only)"
```

---

### Task 8: flow-scan.mjs 연결 (캐시 읽기 전용)

**Files:**
- Modify: `scripts/flow-scan.mjs`

**Interfaces:**
- Consumes: `ensureCgData(targets, { allowFetch: false })`, `upbitDominancePenalty`
- 주의: flow-scan은 현재 `tradePrice`를 구조분해하지 않음 → 추가 필요

- [ ] **Step 1: import·유니버스 수정**

```js
import { getScanUniverse, BATCH, DELAY, sleep, upbitDominancePenalty } from '../lib/scan-universe.mjs'
import { ensureCgData } from '../lib/cg-data.mjs'
```

`main()` 첫 줄 구조분해에 `tradePrice` 추가:

```js
  const { targets, nameOf, warnOf, tradePrice } = await getScanUniverse({ minTradePrice: CONFIG.minTradePrice24h })
```

그 아래(대상 로그 출력 다음)에:

```js
  const cg = await ensureCgData(targets, { allowFetch: false }) // 캐시만 읽기
```

- [ ] **Step 2: 감점 적용** — `const { score, parts } = scoreFlow({...})` 다음 줄에:

```js
      const dom = upbitDominancePenalty(tradePrice[market], cg.byMarket[market]?.globalVolKrw)
      const finalScore = dom.mult < 1 ? +(score * dom.mult).toFixed(1) : score
```

picks.push의 `score`를 `score: finalScore`로 바꾸고, push 객체에 추가:

```js
        ...(dom.share != null ? { dominance: { share: dom.share, mult: dom.mult } } : {}),
```

- [ ] **Step 3: 전체 테스트** — `npx vitest run` → PASS

- [ ] **Step 4: 라이브 검증**: `node scripts/flow-scan.mjs`
Expected: 정상 완료. `data/flow-log.json` 최신 엔트리 픽에 dominance 필드(캐시 fresh + 비중 계산된 종목 한정).

- [ ] **Step 5: 커밋**

```bash
git add scripts/flow-scan.mjs
git commit -m "feat(cg): dominance penalty in flow scan (cache read-only)"
```

---

### Task 9: 최종 검증·문서·푸시

**Files:**
- Modify: `docs/superpowers/specs/2026-07-04-coingecko-upbit-dominance-design.md` (상태 갱신)

- [ ] **Step 1: 전체 테스트** — `npx vitest run` → 전체 PASS (기존 256 + 신규)

- [ ] **Step 2: 라이브 통합 검증** (정시 슬롯 피해서, superpowers:verification-before-completion 준수)

```bash
node scripts/monitor.mjs && node scripts/momentum-scan.mjs && node scripts/flow-scan.mjs
```

확인 항목:
1. 세 스캔 모두 exit 0
2. `data/coingecko-cache.json`의 `fetchedAt`이 monitor 실행 시각 (momentum/flow가 재fetch 안 함 — 파일 mtime 불변)
3. monitor-log 최신 엔트리에 `cgCoverage` > 0
4. 비중 50%+ 종목이 있으면 라벨 확인, 없으면 임계 미달 정상(대부분의 날은 라벨 0개가 정상)

- [ ] **Step 3: 스펙 상태 갱신** — 스펙 문서 상단 `상태: 설계 승인 대기` → `상태: 구현 완료 (YYYY-MM-DD)`

- [ ] **Step 4: 커밋·푸시**

```bash
git add docs/superpowers/specs/2026-07-04-coingecko-upbit-dominance-design.md
git commit -m "docs(spec): mark coingecko dominance spec implemented"
git push origin master
```
