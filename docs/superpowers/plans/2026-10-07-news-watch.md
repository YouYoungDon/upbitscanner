# 뉴스·공지 감시 데몬 (news-watch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코인니스·업비트·바이낸스·빗썸 무료 소스를 1~5분 주기로 수집해 보유·후보 코인 소식과 중요 속보, 공식 상장 공지를 텔레그램으로 알리고, 공식 악재는 기존 이벤트 저장소로 점수에 반영하며, 모든 항목을 측정용 로그로 쌓는 상시 데몬을 만든다.

**Architecture:** `lib/news/` 아래 소스 수집기·매칭·분류·저장·라우팅·사이클을 작은 순수 모듈로 나누고, `scripts/news-watch.mjs`는 배선과 루프만 맡는다. 공식 악재·해제는 기존 `ensureEvents`(빗썸 소스 추가)를 `alerting:false`로 호출해 `event-log.json`에 넣고, 스캐너들이 그대로 읽는다. 네트워크·파일은 deps로 주입해 테스트한다.

**Tech Stack:** Node 24 ESM(`.mjs`), vitest 2, 내장 `fetch`, 기존 `lib/store.mjs`(readJson/writeJson/withLock), Windows 작업 스케줄러.

**Spec:** `docs/superpowers/specs/2026-10-07-news-watch-design.md`

## Global Constraints

- 무료 소스만 사용한다: 코인니스 `https://api.coinness.com/feed/v3/breaking-news?languageCode=ko&limit=30`, 업비트 api-manager 공지, 바이낸스 bapi CMS, 빗썸 `https://api.bithumb.com/v1/notices?count=20`.
- 주기: 코인니스 60초, 업비트 60초, 빗썸 120초, 바이낸스 300초. 소스 타임아웃 8초.
- 알림 범위: 보유(`positions.json`) 또는 후보(monitor-log 최신 buy ∪ momentum-log 최신 picks) 관련 소식, 코인니스 `isImportant`, 업비트 KRW 코인의 공식 상장 공지(보유 무관).
- 공식 호재(상장)는 저장과 알림만 하고 점수에 넣지 않는다.
- 빗썸 공지 점수 배수: 유의 ×0.8, 입출금 중단 ×0.85, 상폐 ×1(알림만).
- 같은 `market|type` 알림은 6시간 안에 한 번만 보낸다.
- 첫 실행(상태 파일 없음)에는 알림을 보내지 않고 seen만 기록한다.
- 소스 30분 연속 실패 시 중단 알림 1회, 회복 시 회복 알림 1회.
- 데몬 생존 시각이 10분 넘게 멈추면 monitor가 하루 1회 경고한다.
- 공식 악재 알림 중 보유·후보와 무관한 것은 기존 monitor `notifyEventAlerts`가 맡는다(중복 금지).
- 기존 파일 중 CRLF 파일(`lib/exchange-events.mjs`, `scripts/monitor.mjs` 등)은 Edit 도구로 고쳐 줄바꿈을 유지한다. 새 파일은 LF로 써도 된다(git autocrlf가 처리).
- 데이터 파일 `data/news-log.jsonl`, `data/news-state.json`, `data/news-watch-health.json`은 git에 올리지 않는다.

## Review Focus

1. **알림이 몰릴 때(재시작 직후 수십 건)** — 텔레그램 4096자 제한을 넘기지 않도록 최대 20줄 + "외 N건"으로 자른다. → Task 6 테스트.
2. **같은 사건이 공식 공지와 코인니스 기사로 둘 다 올 때** — 공식 알림이 나간 코인의 뉴스 알림은 30분 안에는 보내지 않는다. → Task 6 테스트.
3. **상태 파일이 깨졌을 때** — readJson 폴백으로 빈 상태가 되면 "첫 실행"으로 취급해 알림 폭탄 없이 seen만 다시 쌓는다. → Task 7 테스트.
4. **바이낸스 공지 ts가 null일 때** — 로그와 라우팅이 ts 없이도 동작하고, ensureEvents는 기존처럼 처리한다. → Task 7 테스트.
5. **한글명이 더 긴 단어의 일부일 때 / 일반 영단어 티커** — "솔라나파이"에 솔라나를, "ONE"에 하모니를 매칭하지 않는다. → Task 3 테스트.

---

## File Structure

| 파일 | 역할 |
|---|---|
| Create `lib/news/sources/coinness.mjs` | 코인니스 응답 파싱·수집 → `NewsItem[] \| null` |
| Create `lib/news/sources/bithumb.mjs` | 빗썸 공지 파싱·수집 → `NewsItem[] \| null` |
| Create `lib/news/sources/exchanges.mjs` | 업비트·바이낸스 기존 페처를 `NewsItem`으로 감싸기 |
| Modify `lib/exchange-events.mjs` | 빗썸 소스, 거래소별 배수, "입출금 중지" 규칙 |
| Modify `lib/binance.mjs` | 없음(catalogIds 인자로 48 추가만 호출부에서) |
| Create `lib/news/match.mjs` | NewsItem → 업비트 KRW 마켓 |
| Create `lib/news/classify.mjs` | kind/type/tags 분류 |
| Create `lib/news/store.mjs` | 상태(seen·alerted·sourceFail) 순수 갱신, jsonl 로그 추가 |
| Create `lib/news/route.mjs` | 알림 대상 판정·중복 묶기·메시지 |
| Create `lib/news/cycle.mjs` | 한 사이클 오케스트레이션(deps 주입) |
| Create `lib/news/health.mjs` | 데몬 정지 판정(monitor용) |
| Create `scripts/news-watch.mjs` | 배선 + 무한 루프 |
| Modify `scripts/monitor.mjs` | 데몬 정지 경고 호출, 거래소명에 빗썸 추가 |
| Modify `scripts/install-scheduler.ps1` | `UpbitNewsWatch` 등록 |
| Modify `.gitignore` | 뉴스 데이터 파일 |
| Create `scripts/research/news/listing-effect.mjs` | 공식 상장 공지 → 가격 효과 측정 |
| Tests | `__tests__/news-*.test.mjs`, `__tests__/exchange-events.test.mjs` 추가분 |

### 공통 타입 `NewsItem`

```js
// { id, source, title, body, ts, url, important, codes, categories? }
// id: '<source>:<원본id>', source: 'coinness'|'upbit'|'binance'|'bithumb'
// ts: ISO 문자열 또는 null, codes: 소스 제공 코인 코드(대문자) 배열, 없으면 []
```

---

### Task 1: 소스 수집기 (코인니스·빗썸·업비트·바이낸스 래퍼)

**Files:**
- Create: `lib/news/sources/coinness.mjs`, `lib/news/sources/bithumb.mjs`, `lib/news/sources/exchanges.mjs`
- Test: `__tests__/news-sources.test.mjs`

**Interfaces:**
- Produces:
  - `parseCoinness(arr: any[]): NewsItem[]`, `fetchCoinness({ fetchImpl?, timeoutMs? }): Promise<NewsItem[] | null>`
  - `parseBithumbNotices(arr: any[]): NewsItem[]`, `fetchBithumbNotices({ fetchImpl?, timeoutMs? }): Promise<NewsItem[] | null>`
  - `fetchUpbitNews({ fetchAnn? }): Promise<NewsItem[] | null>`, `fetchBinanceNews({ fetchAnn? }): Promise<NewsItem[] | null>`
  - 실패(네트워크·비정상 응답·파싱 오류)는 **null**, 정상인데 0건이면 **[]**. 예외를 던지지 않는다.

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-sources.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { parseCoinness, fetchCoinness } from '../lib/news/sources/coinness.mjs'
import { parseBithumbNotices, fetchBithumbNotices } from '../lib/news/sources/bithumb.mjs'
import { fetchUpbitNews, fetchBinanceNews } from '../lib/news/sources/exchanges.mjs'

const cn = [
  { id: 1171041, title: '익명 고래, $380만 ETH 매수', content: '본문', publishAt: '2026-10-07T21:51:40.528+09:00', isImportant: false, originCodes: ['ETH'], quickOrderCode: 'ETH', link: null },
  { id: 1171032, title: '서클, USDC·EURC 도입', content: null, publishAt: '2026-10-07T21:29:44.138+09:00', isImportant: true, originCodes: ['usdc', 'EURC'], quickOrderCode: null, link: 'https://x' },
]
const bt = [
  { categories: ['입출금'], title: '세이(SEI) 입출금 일시 중지 안내 (10/08 오후 6시~)', pc_url: 'https://feed.bithumb.com/notice/1655212', published_at: '2026-10-07 17:00:00' },
  { categories: ['거래유의'], title: '자이(XAI) 거래유의종목 지정', pc_url: 'https://feed.bithumb.com/notice/1655198', published_at: '2026-10-07 12:00:00' },
]
const okFetch = (body) => vi.fn(async () => ({ ok: true, json: async () => body }))

describe('코인니스', () => {
  it('NewsItem으로 정규화(코드 대문자, 중요 플래그, ISO 시각)', () => {
    const r = parseCoinness(cn)
    expect(r[0]).toEqual({ id: 'coinness:1171041', source: 'coinness', title: '익명 고래, $380만 ETH 매수', body: '본문', ts: '2026-10-07T12:51:40.528Z', url: null, important: false, codes: ['ETH'] })
    expect(r[1].important).toBe(true)
    expect(r[1].codes).toEqual(['USDC', 'EURC'])
  })
  it('fetch 성공 → 배열, 실패/비정상 → null', async () => {
    expect(await fetchCoinness({ fetchImpl: okFetch(cn) })).toHaveLength(2)
    expect(await fetchCoinness({ fetchImpl: vi.fn(async () => ({ ok: false })) })).toBe(null)
    expect(await fetchCoinness({ fetchImpl: vi.fn(async () => { throw new Error('net') }) })).toBe(null)
    expect(await fetchCoinness({ fetchImpl: okFetch({ not: 'array' }) })).toBe(null)
  })
})

describe('빗썸', () => {
  it('id는 URL 끝 번호, 시각은 KST → ISO, categories 보존', () => {
    const r = parseBithumbNotices(bt)
    expect(r[0]).toMatchObject({ id: 'bithumb:1655212', source: 'bithumb', ts: '2026-10-07T08:00:00.000Z', categories: ['입출금'], codes: [], important: false })
  })
  it('fetch 실패 → null', async () => {
    expect(await fetchBithumbNotices({ fetchImpl: vi.fn(async () => ({ ok: false })) })).toBe(null)
    expect(await fetchBithumbNotices({ fetchImpl: okFetch(bt) })).toHaveLength(2)
  })
})

describe('업비트·바이낸스 래퍼', () => {
  it('기존 페처 결과 {id,title,ts} → NewsItem, null은 null', async () => {
    const up = await fetchUpbitNews({ fetchAnn: async () => [{ id: 'upbit:5', title: 'T', ts: '2026-10-06T00:00:00+09:00' }] })
    expect(up[0]).toMatchObject({ id: 'upbit:5', source: 'upbit', title: 'T', ts: '2026-10-05T15:00:00.000Z', codes: [], important: false })
    expect(await fetchUpbitNews({ fetchAnn: async () => null })).toBe(null)
    const bn = await fetchBinanceNews({ fetchAnn: async () => [{ id: 'binance:9', title: 'Binance Will List X (X)', ts: null }] })
    expect(bn[0]).toMatchObject({ id: 'binance:9', source: 'binance', ts: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-sources.test.mjs`
Expected: FAIL — `Failed to load url ../lib/news/sources/coinness.mjs`

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/sources/coinness.mjs
// 코인니스 속보(공개 JSON API, 2026-10-07 확인). v3는 limit=30 지원, 페이지 넘김 없이 최신 30건.
const URL_V3 = 'https://api.coinness.com/feed/v3/breaking-news?languageCode=ko&limit=30'

const isoOrNull = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }

export function parseCoinness(arr) {
  return arr.map((x) => ({
    id: `coinness:${x.id}`,
    source: 'coinness',
    title: String(x.title ?? ''),
    body: x.content ?? null,
    ts: isoOrNull(x.publishAt),
    url: x.link ?? null,
    important: x.isImportant === true,
    codes: (x.originCodes || []).map((c) => String(c).toUpperCase()),
  }))
}

export async function fetchCoinness({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetchImpl(URL_V3, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d) ? parseCoinness(d) : null
  } catch { return null }
}
```

```js
// lib/news/sources/bithumb.mjs
// 빗썸 공식 공지 API(2026-10-07 확인). published_at은 KST 'YYYY-MM-DD HH:mm:ss'.
const URL_NOTICES = 'https://api.bithumb.com/v1/notices?count=20'

function kstToIso(s) {
  const t = Date.parse(String(s ?? '').replace(' ', 'T') + '+09:00')
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function parseBithumbNotices(arr) {
  return arr.map((x) => {
    const num = String(x.pc_url ?? '').match(/(\d+)\/?$/)?.[1] ?? String(x.title ?? '')
    return {
      id: `bithumb:${num}`,
      source: 'bithumb',
      title: String(x.title ?? ''),
      body: null,
      ts: kstToIso(x.published_at),
      url: x.pc_url ?? null,
      important: false,
      codes: [],
      categories: Array.isArray(x.categories) ? x.categories : [],
    }
  })
}

export async function fetchBithumbNotices({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetchImpl(URL_NOTICES, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d) ? parseBithumbNotices(d) : null
  } catch { return null }
}
```

```js
// lib/news/sources/exchanges.mjs
// 기존 업비트·바이낸스 공지 페처({id,title,ts}[] | null)를 NewsItem으로 감싼다.
import { fetchUpbitAnnouncements } from '../../exchange-events.mjs'
import { fetchBinanceAnnouncements } from '../../binance.mjs'

const isoOrNull = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }
const wrap = (source) => (list) => list.map((a) => ({
  id: a.id, source, title: String(a.title ?? ''), body: null, ts: isoOrNull(a.ts), url: null, important: false, codes: [],
}))

export async function fetchUpbitNews({ fetchAnn = () => fetchUpbitAnnouncements({ pages: 1 }) } = {}) {
  try { const l = await fetchAnn(); return l ? wrap('upbit')(l) : null } catch { return null }
}

// 48 = 신규 상장(New Cryptocurrency Listing) 카탈로그. 161/157은 기존 상폐·입출금중단.
export async function fetchBinanceNews({ fetchAnn = () => fetchBinanceAnnouncements({ catalogIds: [161, 157, 48] }) } = {}) {
  try { const l = await fetchAnn(); return l ? wrap('binance')(l) : null } catch { return null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/news-sources.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/sources __tests__/news-sources.test.mjs
git commit -m "feat(news): source fetchers for CoinNess, Bithumb, Upbit/Binance wrappers"
```

---

### Task 2: 거래소 이벤트에 빗썸 추가 (배수·"중지" 규칙·라벨)

**Files:**
- Modify: `lib/exchange-events.mjs` (EVENT_RULES halt 정규식, EX_KO, ensureEvents 소스 목록, 이벤트 생성부 배수)
- Modify: `scripts/monitor.mjs` (`notifyEventAlerts`의 `EX_KO`에 빗썸)
- Test: `__tests__/exchange-events.test.mjs` (추가)

**Interfaces:**
- Consumes: Task 1 `fetchBithumbNotices`
- Produces: `EXCHANGE_MULT_OVERRIDE = { bithumb: { delist: 1, caution: 0.8, halt: 0.85 } }`(export), `ensureEvents`의 deps에 `fetchBithumbAnnouncements(): Promise<{id,title,ts}[] | null>` 추가(기본값은 빗썸 공지를 `{id,title,ts}`로 변환).

- [ ] **Step 1: Write the failing test** (`__tests__/exchange-events.test.mjs` 끝에 추가, import에 `EXCHANGE_MULT_OVERRIDE` 추가)

```js
describe('빗썸 소스 (2026-10-07)', () => {
  const HALT_TS2 = Date.parse('2026-10-07T17:00:00+09:00')
  const mkDeps2 = (bithumb) => ({
    ...memStore(),
    fetchUpbitAnnouncements: vi.fn(async () => null),
    fetchBinanceAnnouncements: vi.fn(async () => null),
    fetchBithumbAnnouncements: vi.fn(async () => bithumb),
  })
  it('"입출금 일시 중지"도 halt로 분류(빗썸 표현)', () => {
    expect(classifyAnnouncement('세이(SEI) 입출금 일시 중지 안내')).toMatchObject({ type: 'halt' })
  })
  it('빗썸 halt는 ×0.85, 유의는 ×0.8 (업비트보다 약하게)', async () => {
    const r = await ensureEvents(['KRW-SEI', 'KRW-XAI'], { now: HALT_TS2, deps: mkDeps2([
      { id: 'bithumb:1', title: '세이(SEI) 입출금 일시 중지 안내', ts: '2026-10-07T08:00:00.000Z' },
      { id: 'bithumb:2', title: '자이(XAI) 거래유의종목 지정', ts: '2026-10-07T03:00:00.000Z' },
    ]) })
    expect(r.byMarket['KRW-SEI'].mult).toBe(0.85)
    expect(r.byMarket['KRW-XAI'].mult).toBe(0.8)
    expect(r.byMarket['KRW-SEI'].label).toContain('빗썸')
  })
  it('빗썸 상폐는 제외(×0)하지 않음 — 업비트 거래는 계속', async () => {
    const r = await ensureEvents(['KRW-AAA'], { now: HALT_TS2, deps: mkDeps2([{ id: 'bithumb:3', title: '에이(AAA) 거래지원 종료 안내', ts: '2026-10-07T03:00:00.000Z' }]) })
    expect(r.byMarket['KRW-AAA'].mult).toBe(1)
    expect(EXCHANGE_MULT_OVERRIDE.bithumb.delist).toBe(1)
  })
  it('세 소스 모두 실패해야 fetch-fail', async () => {
    const r = await ensureEvents(['KRW-SEI'], { now: HALT_TS2, deps: mkDeps2(null) })
    expect(r.reason).toBe('fetch-fail')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/exchange-events.test.mjs`
Expected: FAIL — `EXCHANGE_MULT_OVERRIDE` undefined, halt 미분류(중지)

- [ ] **Step 3: Write minimal implementation** (Edit 도구로, CRLF 유지)

1. halt 규칙 정규식의 `입출금\s*(일시)?\s*중단`을 `입출금\s*(일시)?\s*(중단|중지)`로 바꾼다.
2. 파일 상단 import 아래에 추가:

```js
import { fetchBithumbNotices } from './news/sources/bithumb.mjs'

// 거래소별 배수 덮어쓰기. 빗썸 공지는 업비트 거래 자체를 막지 않으므로 약하게 반영하고,
// 빗썸 상폐는 업비트 픽을 제외하지 않는다(×1, 기록·알림만). 2026-10-07 news-watch 스펙.
export const EXCHANGE_MULT_OVERRIDE = { bithumb: { delist: 1, caution: 0.8, halt: 0.85 } }

async function defaultFetchBithumb() {
  const l = await fetchBithumbNotices()
  return l ? l.map((x) => ({ id: x.id, title: x.title, ts: x.ts })) : null
}
```

3. `const EX_KO = { upbit: '업비트', binance: '바이낸스' }` → `const EX_KO = { upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }`
4. `ensureEvents` 안:

```js
  const d = { fetchUpbitAnnouncements, fetchBinanceAnnouncements, fetchBithumbAnnouncements: defaultFetchBithumb, readJson, writeJson, withLock, ...deps }
```

```js
    const [up, bn, bt] = await Promise.all([
      Promise.resolve().then(() => d.fetchUpbitAnnouncements()).catch(() => null),
      Promise.resolve().then(() => d.fetchBinanceAnnouncements()).catch(() => null),
      Promise.resolve().then(() => d.fetchBithumbAnnouncements()).catch(() => null),
    ])
```

```js
    const fetchFailed = !up && !bn && !bt
    const raw = [
      ...(up || []).map((a) => ({ ...a, exchange: 'upbit' })),
      ...(bn || []).map((a) => ({ ...a, exchange: 'binance' })),
      ...(bt || []).map((a) => ({ ...a, exchange: 'bithumb' })),
    ]
```

5. 이벤트 생성부(`const ev = { type: c.type, severity: c.severity, mult: c.mult, ...`)의 `mult: c.mult`를 `mult: EXCHANGE_MULT_OVERRIDE[c.exchange]?.[c.type] ?? c.mult`로 바꾼다.
6. `scripts/monitor.mjs`의 `notifyEventAlerts` 안 `const EX_KO = { upbit: '업비트', binance: '바이낸스' }`를 `{ upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }`로 바꾼다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/exchange-events.test.mjs` → PASS. 이어서 `npx vitest run` → 전체 PASS(기존 테스트의 deps에는 빗썸이 없으므로 기본 페처가 실제 네트워크를 타지 않게, 기존 `mkDeps`에 `fetchBithumbAnnouncements: vi.fn(async () => null)`을 추가한다).

- [ ] **Step 5: Commit**

```bash
git add lib/exchange-events.mjs scripts/monitor.mjs __tests__/exchange-events.test.mjs
git commit -m "feat(events): Bithumb notices as a third source with weaker multipliers"
```

---

### Task 3: 코인 매칭

**Files:**
- Create: `lib/news/match.mjs`
- Test: `__tests__/news-match.test.mjs`

**Interfaces:**
- Consumes: `parseTickers(title)` from `lib/exchange-events.mjs`
- Produces: `AMBIGUOUS_TICKERS: Set<string>`, `buildMatcher(markets: {market, korean_name, english_name?}[]): (item: NewsItem) => { markets: string[], via: Record<string, 'code'|'paren'|'ko'|'en'> }`

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-match.test.mjs
import { describe, it, expect } from 'vitest'
import { buildMatcher } from '../lib/news/match.mjs'

const markets = [
  { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' },
  { market: 'KRW-ONE', korean_name: '하모니', english_name: 'Harmony' },
  { market: 'KRW-SOPH', korean_name: '소폰', english_name: 'Sophon' },
  { market: 'KRW-ETH', korean_name: '이더리움', english_name: 'Ethereum' },
  { market: 'KRW-NMR', korean_name: '뉴메레르', english_name: 'Numeraire' },
]
const item = (title, codes = []) => ({ id: 'x', source: 'coinness', title, body: null, ts: null, url: null, important: false, codes })
const m = buildMatcher(markets)

describe('buildMatcher', () => {
  it('소스 코드 우선', () => {
    expect(m(item('고래 매수', ['ETH']))).toEqual({ markets: ['KRW-ETH'], via: { 'KRW-ETH': 'code' } })
  })
  it('괄호 티커', () => {
    expect(m(item('뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가')).via['KRW-NMR']).toBe('paren') // 한글명도 있지만 괄호가 먼저 기록됨
  })
  it('한글명: 단독 단어만(더 긴 단어의 일부는 제외)', () => {
    expect(m(item('솔라나 9월 활성 프로그램 역대 최다')).markets).toEqual(['KRW-SOL'])
    expect(m(item('솔라나파이 프로젝트 출시')).markets).toEqual([])
  })
  it('2글자 이하 한글명은 매칭하지 않음(소폰)', () => {
    expect(m(item('소폰 생태계 업데이트')).markets).toEqual([])
  })
  it('영문 티커 단독 대문자(3자+), 모호 티커 제외', () => {
    expect(m(item('SOL ETF 승인 기대')).markets).toEqual(['KRW-SOL'])
    expect(m(item('ONE more thing')).markets).toEqual([])
    expect(m(item('SOLANA 업데이트')).markets).toEqual([])
  })
  it('코드가 유니버스에 없으면 무시', () => {
    expect(m(item('x', ['DOGE'])).markets).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-match.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/match.mjs
// 뉴스·공지 → 업비트 KRW 마켓. 제목만 본다(본문은 언급이 넓어 오탐이 많다 — 본문의 코인은 소스 codes가 담당).
import { parseTickers } from '../exchange-events.mjs'

// 일반 영단어와 겹치는 티커 — 영문 단독 매칭에서 제외(괄호·소스 코드 매칭은 허용).
export const AMBIGUOUS_TICKERS = new Set(['ONE', 'GAS', 'MOVE', 'AI', 'ME', 'IQ', 'T', 'ID', 'CAT', 'BIG', 'JOE', 'MAX', 'NOT', 'OPEN', 'POND', 'SIGN', 'SAFE', 'TRUMP', 'HUNT', 'GO', 'LA', 'ZK', 'XAI', 'USD'])

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildMatcher(markets) {
  const byTicker = new Map(markets.map((m) => [m.market.replace('KRW-', ''), m.market]))
  const ko = markets
    .filter((m) => (m.korean_name || '').length >= 3)
    .map((m) => ({ market: m.market, re: new RegExp(`(?<![가-힣])${escapeRe(m.korean_name)}(?![가-힣])`) }))
  const en = [...byTicker.entries()]
    .filter(([t]) => t.length >= 3 && !AMBIGUOUS_TICKERS.has(t))
    .map(([t, market]) => ({ market, re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(t)}(?![A-Za-z0-9])`) }))

  return (item) => {
    const via = {}
    const add = (market, how) => { if (market && !via[market]) via[market] = how }
    for (const c of item.codes || []) add(byTicker.get(c), 'code')
    const title = item.title || ''
    for (const t of parseTickers(title)) add(byTicker.get(t), 'paren')
    for (const k of ko) if (k.re.test(title)) add(k.market, 'ko')
    for (const e of en) if (e.re.test(title)) add(e.market, 'en')
    return { markets: Object.keys(via), via }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/news-match.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/match.mjs __tests__/news-match.test.mjs
git commit -m "feat(news): coin matcher (source codes, paren tickers, Korean names, safe tickers)"
```

---

### Task 4: 분류

**Files:**
- Create: `lib/news/classify.mjs`
- Test: `__tests__/news-classify.test.mjs`

**Interfaces:**
- Consumes: `classifyAnnouncement(title)`, `scopedOutsideKrw(title)` from `lib/exchange-events.mjs`
- Produces: `classifyItem(item: NewsItem): { kind: 'official-risk'|'official-clear'|'official-listing'|'official-other'|'news', type: string|null, tags: string[] }`, `NEWS_TAGS: Record<string, RegExp>`

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-classify.test.mjs
import { describe, it, expect } from 'vitest'
import { classifyItem } from '../lib/news/classify.mjs'

const it_ = (source, title, extra = {}) => ({ id: 'x', source, title, body: null, ts: null, url: null, important: false, codes: [], ...extra })

describe('classifyItem — 공식 공지', () => {
  it('업비트 상폐·유의·중단·재개', () => {
    expect(classifyItem(it_('upbit', '아이콘(ICX) 거래지원 종료 안내 (10/19 15:00)'))).toMatchObject({ kind: 'official-risk', type: 'delist' })
    expect(classifyItem(it_('bithumb', '자이(XAI) 거래유의종목 지정'))).toMatchObject({ kind: 'official-risk', type: 'caution' })
    expect(classifyItem(it_('bithumb', '세이(SEI) 입출금 일시 중지 안내'))).toMatchObject({ kind: 'official-risk', type: 'halt' })
    expect(classifyItem(it_('bithumb', '헤미(HEMI) 거래유의종목 지정 해제'))).toMatchObject({ kind: 'official-clear', type: 'resume' })
  })
  it('공식 상장', () => {
    expect(classifyItem(it_('upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가'))).toMatchObject({ kind: 'official-listing', type: 'upbit-krw' })
    expect(classifyItem(it_('upbit', '돌핀(POD) 신규 거래지원 안내 (KRW, BTC, USDT 마켓)'))).toMatchObject({ kind: 'official-listing', type: 'upbit-krw' })
    expect(classifyItem(it_('binance', 'Binance Will List Sophon (SOPH)'))).toMatchObject({ kind: 'official-listing', type: 'binance-spot' })
    expect(classifyItem(it_('binance', 'Binance Futures Will Launch USDⓈ-Margined SOPHUSDT Perpetual Contract'))).toMatchObject({ kind: 'official-listing', type: 'binance-futures' })
    expect(classifyItem(it_('bithumb', '돌핀(POD) 원화 마켓 추가'))).toMatchObject({ kind: 'official-listing', type: 'bithumb-krw' })
  })
  it('KRW 없는 마켓 한정 상장·기타 공지 → official-other', () => {
    expect(classifyItem(it_('upbit', '렌조(REZ) 신규 거래지원 안내 (USDT 마켓)')).kind).toBe('official-other')
    expect(classifyItem(it_('upbit', 'API Maker 거래 수수료 0% 이벤트')).kind).toBe('official-other')
  })
})

describe('classifyItem — 코인니스 뉴스 태그', () => {
  it('태그 부여, 점수 영향 없음(kind=news)', () => {
    expect(classifyItem(it_('coinness', '2,500 BTC 이체... 익명 → 비트파이넥스'))).toEqual({ kind: 'news', type: null, tags: ['고래'] })
    expect(classifyItem(it_('coinness', 'XX 프로토콜 해킹, $3,000만 탈취')).tags).toContain('해킹')
    expect(classifyItem(it_('coinness', '테더, 카자흐 중앙은행과 MOU 체결')).tags).toContain('파트너십')
    expect(classifyItem(it_('coinness', '미 10년물 국채 수익률 5.35%')).tags).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-classify.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/classify.mjs
// 공식 공지(업비트·바이낸스·빗썸): 악재/해제는 기존 EVENT_RULES, 상장은 아래 규칙.
// 코인니스 뉴스: kind='news' + 키워드 태그(알림 문구·측정용, 점수 무관).
import { classifyAnnouncement, scopedOutsideKrw } from '../exchange-events.mjs'

const LISTING_RULES = [
  { source: 'upbit', type: 'upbit-krw', re: /KRW[^)]*마켓\s*디지털\s*자산\s*추가|신규\s*거래지원\s*안내\s*\([^)]*KRW/ },
  { source: 'binance', type: 'binance-futures', re: /Futures Will Launch|Will Launch .*Perpetual/i },
  { source: 'binance', type: 'binance-spot', re: /Will List|HODLer Airdrops|Launchpool|Megadrop/i },
  { source: 'bithumb', type: 'bithumb-krw', re: /원화\s*마켓\s*(추가|상장|디지털\s*자산\s*추가)/ },
]

export const NEWS_TAGS = {
  해킹: /해킹|익스플로잇|탈취|exploit|hack/i,
  규제: /SEC|소송|기소|제재|규제/,
  고래: /고래|이체|대량\s*(매수|매도|입금|출금)/,
  파트너십: /파트너십|MOU|협력|제휴/,
  언락: /언락|락업\s*해제|unlock/i,
  업그레이드: /메인넷|업그레이드|하드포크/,
  소각: /소각|바이백|buyback|burn/i,
}

export function classifyItem(item) {
  const title = item.title || ''
  if (item.source === 'coinness') {
    const tags = Object.entries(NEWS_TAGS).filter(([, re]) => re.test(title)).map(([k]) => k)
    return { kind: 'news', type: null, tags }
  }
  if (scopedOutsideKrw(title)) return { kind: 'official-other', type: null, tags: [] }
  const c = classifyAnnouncement(title)
  if (c && ['delist', 'caution', 'halt'].includes(c.type)) return { kind: 'official-risk', type: c.type, tags: [] }
  if (c && c.type === 'resume') return { kind: 'official-clear', type: 'resume', tags: [] }
  const l = LISTING_RULES.find((r) => r.source === item.source && r.re.test(title))
  if (l) return { kind: 'official-listing', type: l.type, tags: [] }
  return { kind: 'official-other', type: null, tags: [] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/news-classify.test.mjs`
Expected: PASS (4 tests). 실패하는 실제 제목이 있으면 규칙 정규식을 고치고, 테스트 기대값은 바꾸지 않는다.

- [ ] **Step 5: Commit**

```bash
git add lib/news/classify.mjs __tests__/news-classify.test.mjs
git commit -m "feat(news): classify official risk/clear/listing and tag CoinNess news"
```

---

### Task 5: 상태·로그 저장

**Files:**
- Create: `lib/news/store.mjs`
- Modify: `.gitignore` (아래 3줄 추가)
- Test: `__tests__/news-store.test.mjs`

**Interfaces:**
- Produces:
  - `emptyState(): NewsState` → `{ initialized: false, seen: {}, alerted: {}, sourceFail: {}, lastFetchAt: {}, lastLoopAt: null }`
  - `pruneState(state, nowMs): NewsState` (seen 7일, alerted 6시간 초과 제거, 입력 불변)
  - `newItems(items: NewsItem[], state): NewsItem[]` (seen 제외 + 배치 내 id 중복 제거)
  - `markSeen(state, items, nowMs): NewsState`
  - `appendNewsLog(records: object[], { dir? }): Promise<void>` (`dir` 기본 `DATA_DIR`, 파일 `news-log.jsonl`)

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-store.test.mjs
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState, pruneState, newItems, markSeen, appendNewsLog } from '../lib/news/store.mjs'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const H = 3600000

describe('news store', () => {
  it('emptyState 형태', () => {
    expect(emptyState()).toEqual({ initialized: false, seen: {}, alerted: {}, sourceFail: {}, lastFetchAt: {}, lastLoopAt: null })
  })
  it('newItems: seen·배치 중복 제외', () => {
    const s = { ...emptyState(), seen: { 'a:1': new Date(NOW).toISOString() } }
    const r = newItems([{ id: 'a:1' }, { id: 'a:2' }, { id: 'a:2' }], s)
    expect(r.map((x) => x.id)).toEqual(['a:2'])
  })
  it('markSeen은 입력 불변', () => {
    const s0 = emptyState()
    const s1 = markSeen(s0, [{ id: 'a:9' }], NOW)
    expect(s1.seen['a:9']).toBe(new Date(NOW).toISOString())
    expect(s0.seen).toEqual({})
  })
  it('pruneState: seen 7일·alerted 6시간 초과 제거', () => {
    const s = { ...emptyState(),
      seen: { old: new Date(NOW - 8 * 24 * H).toISOString(), fresh: new Date(NOW - H).toISOString() },
      alerted: { 'KRW-A|news': new Date(NOW - 7 * H).toISOString(), 'KRW-B|news': new Date(NOW - H).toISOString() } }
    const p = pruneState(s, NOW)
    expect(Object.keys(p.seen)).toEqual(['fresh'])
    expect(Object.keys(p.alerted)).toEqual(['KRW-B|news'])
  })
  it('appendNewsLog: jsonl 한 줄씩 추가', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'news-'))
    await appendNewsLog([{ a: 1 }, { b: 2 }], { dir })
    await appendNewsLog([{ c: 3 }], { dir })
    const lines = readFileSync(join(dir, 'news-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-store.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/store.mjs
// news-watch 상태(순수 갱신)와 측정용 jsonl 로그.
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from '../store.mjs'

const DAY = 86400000, H = 3600000

export function emptyState() {
  return { initialized: false, seen: {}, alerted: {}, sourceFail: {}, lastFetchAt: {}, lastLoopAt: null }
}

const keepNewer = (obj, cutoff) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => Date.parse(v) >= cutoff))

export function pruneState(state, nowMs) {
  return { ...state, seen: keepNewer(state.seen, nowMs - 7 * DAY), alerted: keepNewer(state.alerted, nowMs - 6 * H) }
}

export function newItems(items, state) {
  const out = [], ids = new Set()
  for (const it of items) {
    if (state.seen?.[it.id] || ids.has(it.id)) continue
    ids.add(it.id); out.push(it)
  }
  return out
}

export function markSeen(state, items, nowMs) {
  const iso = new Date(nowMs).toISOString()
  const seen = { ...state.seen }
  for (const it of items) if (!seen[it.id]) seen[it.id] = iso
  return { ...state, seen }
}

export async function appendNewsLog(records, { dir = DATA_DIR } = {}) {
  if (!records.length) return
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, 'news-log.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}
```

`.gitignore` 끝에 추가:

```
data/news-log.jsonl
data/news-state.json
data/news-watch-health.json
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/news-store.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/store.mjs __tests__/news-store.test.mjs .gitignore
git commit -m "feat(news): state helpers and jsonl news log"
```

---

### Task 6: 알림 라우팅과 메시지

**Files:**
- Create: `lib/news/route.mjs`
- Test: `__tests__/news-route.test.mjs`

**Interfaces:**
- Consumes: Task 3/4 결과를 합친 레코드 `Rec = { item: NewsItem, markets: string[], via, kind, type, tags }`, Task 5 `NewsState`
- Produces:
  - `alertReasons(rec: Rec, ctx: { held: Set<string>, candidates: Set<string> }): string[]` — 'listing' | 'risk' | 'important' | 'held' | 'candidate'
  - `alertKey(rec): string` — `${markets[0]}|${kind==='news' ? 'news' : type}`, 코인 없으면 `id|${item.id}`
  - `selectAlerts(recs: Rec[], ctx, state, nowMs): { alerts: {rec, reasons}[], keys: string[] }` (state는 읽기만, 기록은 호출부가 전송 성공 후)
  - `formatNewsAlert(alerts, whenLabel: string, notices?: string[]): string`
  - 상수 `MAX_LINES = 20`

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-route.test.mjs
import { describe, it, expect } from 'vitest'
import { alertReasons, alertKey, selectAlerts, formatNewsAlert } from '../lib/news/route.mjs'
import { emptyState } from '../lib/news/store.mjs'

const NOW = Date.parse('2026-10-07T13:41:00Z')
const rec = (o = {}) => ({
  item: { id: o.id || 'coinness:1', source: o.source || 'coinness', title: o.title || '제목', important: !!o.important, ts: null, codes: [] },
  markets: o.markets || [], via: {}, kind: o.kind || 'news', type: o.type ?? null, tags: o.tags || [],
})
const ctx = { held: new Set(['KRW-ID']), candidates: new Set(['KRW-STX']) }

describe('alertReasons', () => {
  it('공식 상장은 보유 무관 알림', () => {
    expect(alertReasons(rec({ kind: 'official-listing', type: 'binance-spot', markets: ['KRW-ZZZ'] }), ctx)).toEqual(['listing'])
  })
  it('공식 악재는 보유·후보일 때만(그 외는 monitor 담당)', () => {
    expect(alertReasons(rec({ kind: 'official-risk', type: 'halt', markets: ['KRW-ID'] }), ctx)).toEqual(['risk', 'held'])
    expect(alertReasons(rec({ kind: 'official-risk', type: 'halt', markets: ['KRW-ZZZ'] }), ctx)).toEqual([])
  })
  it('뉴스: 보유/후보/중요', () => {
    expect(alertReasons(rec({ markets: ['KRW-STX'] }), ctx)).toEqual(['candidate'])
    expect(alertReasons(rec({ markets: [], important: true }), ctx)).toEqual(['important'])
    expect(alertReasons(rec({ markets: ['KRW-ZZZ'] }), ctx)).toEqual([])
  })
  it('official-other는 알림 없음', () => {
    expect(alertReasons(rec({ kind: 'official-other', markets: ['KRW-ID'] }), ctx)).toEqual([])
  })
})

describe('selectAlerts', () => {
  it('6시간 내 같은 키는 다시 보내지 않음', () => {
    const r = rec({ markets: ['KRW-ID'] })
    const state = { ...emptyState(), alerted: { [alertKey(r)]: new Date(NOW - 3600000).toISOString() } }
    expect(selectAlerts([r], ctx, state, NOW).alerts).toEqual([])
  })
  it('같은 사이클 같은 키는 하나만', () => {
    const a = rec({ id: 'coinness:1', markets: ['KRW-ID'] }), b = rec({ id: 'coinness:2', markets: ['KRW-ID'] })
    expect(selectAlerts([a, b], ctx, emptyState(), NOW).alerts).toHaveLength(1)
  })
  it('공식 알림이 나간 코인의 뉴스는 30분 안엔 생략(같은 사건 이중 알림 방지)', () => {
    const off = rec({ id: 'upbit:1', source: 'upbit', kind: 'official-listing', type: 'upbit-krw', markets: ['KRW-ID'] })
    const news = rec({ id: 'coinness:5', markets: ['KRW-ID'] })
    const r1 = selectAlerts([off, news], ctx, emptyState(), NOW)
    expect(r1.alerts.map((a) => a.rec.item.id)).toEqual(['upbit:1'])
    const state = { ...emptyState(), alerted: { 'KRW-ID|upbit-krw': new Date(NOW - 10 * 60000).toISOString() } }
    expect(selectAlerts([news], ctx, state, NOW).alerts).toEqual([])
  })
})

describe('formatNewsAlert', () => {
  it('이유 이모지·출처·제목·티커', () => {
    const msg = formatNewsAlert([{ rec: rec({ source: 'upbit', kind: 'official-listing', type: 'upbit-krw', markets: ['KRW-NMR'], title: '뉴메레르(NMR) KRW 마켓 추가' }), reasons: ['listing'] }], '22:41')
    expect(msg).toContain('📰 뉴스·공지 (22:41)')
    expect(msg).toContain('🟢상장 · 업비트 · 뉴메레르(NMR) KRW 마켓 추가')
  })
  it('20줄 초과는 잘라서 "외 N건"', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ rec: rec({ id: `c:${i}`, important: true, title: `t${i}` }), reasons: ['important'] }))
    const msg = formatNewsAlert(many, '22:41')
    expect(msg).toContain('외 5건')
    expect(msg.length).toBeLessThan(4096)
  })
  it('공지(notices)도 덧붙임', () => {
    expect(formatNewsAlert([], '22:41', ['⚠️뉴스 소스 중단: 바이낸스'])).toContain('⚠️뉴스 소스 중단: 바이낸스')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-route.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/route.mjs
// 알림 대상 판정·중복 묶기·텔레그램 메시지. 상태는 읽기만 한다(전송 성공 후 호출부가 alerted 기록).
export const MAX_LINES = 20
const SIX_H = 6 * 3600000, NEWS_AFTER_OFFICIAL_MS = 30 * 60000
const SRC_KO = { coinness: '코인니스', upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }
const REASON_EMOJI = { listing: '🟢상장', risk: '🚨악재', important: '⭐중요', held: '💼보유', candidate: '🎯후보' }

export function alertReasons(rec, ctx) {
  const held = rec.markets.some((m) => ctx.held.has(m))
  const cand = !held && rec.markets.some((m) => ctx.candidates.has(m))
  const mine = held ? ['held'] : cand ? ['candidate'] : []
  switch (rec.kind) {
    case 'official-listing': return rec.markets.length ? ['listing'] : []
    case 'official-risk': return mine.length ? ['risk', ...mine] : []
    case 'official-clear': return mine
    case 'news': return rec.item.important ? ['important', ...mine] : mine
    default: return []
  }
}

export function alertKey(rec) {
  if (!rec.markets.length) return `id|${rec.item.id}`
  return `${rec.markets[0]}|${rec.kind === 'news' ? 'news' : rec.type}`
}

export function selectAlerts(recs, ctx, state, nowMs) {
  const recent = (key, ms) => { const t = Date.parse(state.alerted?.[key] ?? ''); return Number.isFinite(t) && nowMs - t < ms }
  const officialRecent = (market) => Object.entries(state.alerted || {}).some(([k, v]) =>
    k.startsWith(`${market}|`) && !k.endsWith('|news') && nowMs - Date.parse(v) < NEWS_AFTER_OFFICIAL_MS)
  // 공식 공지를 먼저 처리해야 같은 사이클의 뉴스를 그 코인에 대해 생략할 수 있다.
  const ordered = [...recs].sort((a, b) => (a.kind === 'news') - (b.kind === 'news'))
  const alerts = [], keys = [], officialNow = new Set()
  for (const rec of ordered) {
    const reasons = alertReasons(rec, ctx)
    if (!reasons.length) continue
    const key = alertKey(rec)
    if (keys.includes(key) || recent(key, SIX_H)) continue
    if (rec.kind === 'news' && rec.markets.some((m) => officialNow.has(m) || officialRecent(m))) continue
    if (rec.kind !== 'news') rec.markets.forEach((m) => officialNow.add(m))
    alerts.push({ rec, reasons }); keys.push(key)
  }
  return { alerts, keys }
}

export function formatNewsAlert(alerts, whenLabel, notices = []) {
  const line = ({ rec, reasons }) => {
    const tickers = rec.markets.map((m) => m.replace('KRW-', '')).join(',')
    const tag = rec.tags?.length ? ` [${rec.tags.join('·')}]` : ''
    const title = rec.item.title.length > 120 ? rec.item.title.slice(0, 117) + '…' : rec.item.title
    const showTickers = tickers && !rec.markets.every((m) => title.includes(`(${m.replace('KRW-', '')})`))
    return `${reasons.map((r) => REASON_EMOJI[r]).join('')} · ${SRC_KO[rec.item.source] || rec.item.source} · ${title}${showTickers ? ` (${tickers})` : ''}${tag}`
  }
  const shown = alerts.slice(0, MAX_LINES).map(line)
  if (alerts.length > MAX_LINES) shown.push(`… 외 ${alerts.length - MAX_LINES}건`)
  return [`📰 뉴스·공지 (${whenLabel})`, ...shown, ...notices].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/news-route.test.mjs`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/news/route.mjs __tests__/news-route.test.mjs
git commit -m "feat(news): alert routing with 6h dedup and official-first suppression"
```

---

### Task 7: 한 사이클 오케스트레이션

**Files:**
- Create: `lib/news/cycle.mjs`
- Test: `__tests__/news-cycle.test.mjs`

**Interfaces:**
- Consumes: Task 1 수집기(deps로 주입), Task 3 `buildMatcher`, Task 4 `classifyItem`, Task 5 store 함수, Task 6 `selectAlerts`/`formatNewsAlert`/`alertKey`, 기존 `ensureEvents`
- Produces:
  - `SOURCE_EVERY_MS = { coinness: 60000, upbit: 60000, bithumb: 120000, binance: 300000 }`
  - `FAIL_NOTIFY_MS = 1800000`
  - `runCycle({ state, nowMs, deps }): Promise<{ state, sent: number, newCount: number, notices: string[] }>`
  - deps 계약: `{ fetchers: { coinness, upbit, binance, bithumb }: () => Promise<NewsItem[]|null>, getMarkets: () => Promise<{market,korean_name,english_name}[]>, readCtx: () => Promise<{held:Set, candidates:Set, positions: object[]}>, ensureEvents: (markets, opts) => Promise<any>, appendLog: (records) => Promise<void>, send: (text) => Promise<boolean>, whenLabel: (nowMs) => string }`

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-cycle.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { runCycle, SOURCE_EVERY_MS } from '../lib/news/cycle.mjs'
import { emptyState } from '../lib/news/store.mjs'

const NOW = Date.parse('2026-10-07T13:41:00Z')
const markets = [{ market: 'KRW-ID', korean_name: '스페이스아이디', english_name: 'Space ID' }, { market: 'KRW-NMR', korean_name: '뉴메레르', english_name: 'Numeraire' }]
const ni = (id, source, title, o = {}) => ({ id, source, title, body: null, ts: o.ts ?? null, url: null, important: !!o.important, codes: o.codes || [] })

function mkDeps(over = {}) {
  return {
    fetchers: {
      coinness: vi.fn(async () => [ni('coinness:1', 'coinness', 'ID 고래 이체', { codes: ['ID'] })]),
      upbit: vi.fn(async () => [ni('upbit:1', 'upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가', { ts: '2026-10-07T13:00:00.000Z' })]),
      binance: vi.fn(async () => []),
      bithumb: vi.fn(async () => []),
      ...(over.fetchers || {}),
    },
    getMarkets: vi.fn(async () => markets),
    readCtx: vi.fn(async () => ({ held: new Set(['KRW-ID']), candidates: new Set(), positions: [{ market: 'KRW-ID' }] })),
    ensureEvents: vi.fn(async () => ({ byMarket: {}, newEvents: [] })),
    appendLog: vi.fn(async () => {}),
    send: vi.fn(async () => true),
    whenLabel: () => '22:41',
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'fetchers')),
  }
}

describe('runCycle', () => {
  it('첫 실행: seen만 기록, 알림 없음, 로그는 남김', async () => {
    const deps = mkDeps()
    const r = await runCycle({ state: emptyState(), nowMs: NOW, deps })
    expect(deps.send).not.toHaveBeenCalled()
    expect(r.state.initialized).toBe(true)
    expect(Object.keys(r.state.seen)).toEqual(expect.arrayContaining(['coinness:1', 'upbit:1']))
    expect(deps.appendLog).toHaveBeenCalledTimes(1)
  })
  it('다음 사이클: 새 항목만 알림, 전송 성공 시 alerted 기록', async () => {
    const deps = mkDeps()
    const s1 = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:2', 'coinness', '스페이스아이디 메인넷 업그레이드')])
    deps.fetchers.upbit = vi.fn(async () => [ni('upbit:2', 'upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가')])
    const r = await runCycle({ state: s1, nowMs: NOW + 61000, deps })
    expect(deps.send).toHaveBeenCalledTimes(1)
    const msg = deps.send.mock.calls[0][0]
    expect(msg).toContain('🟢상장 · 업비트')
    expect(msg).toContain('💼보유 · 코인니스 · 스페이스아이디 메인넷 업그레이드')
    expect(Object.keys(r.state.alerted)).toEqual(expect.arrayContaining(['KRW-NMR|upbit-krw', 'KRW-ID|news']))
  })
  it('전송 실패 시 alerted를 기록하지 않음', async () => {
    const deps = mkDeps({ send: vi.fn(async () => false) })
    const s1 = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:3', 'coinness', 'ID 고래', { codes: ['ID'] })])
    const r = await runCycle({ state: s1, nowMs: NOW + 61000, deps })
    expect(r.state.alerted).toEqual({})
  })
  it('주기가 안 된 소스는 호출하지 않음(바이낸스 5분)', async () => {
    const deps = mkDeps()
    const s1 = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    await runCycle({ state: s1, nowMs: NOW + 61000, deps })
    expect(deps.fetchers.binance).toHaveBeenCalledTimes(1)
    await runCycle({ state: s1, nowMs: NOW + SOURCE_EVERY_MS.binance, deps })
    expect(deps.fetchers.binance).toHaveBeenCalledTimes(2)
  })
  it('공식 소스 결과를 ensureEvents에 alerting:false로 전달(바이낸스 ts null 포함)', async () => {
    const deps = mkDeps({ fetchers: { binance: vi.fn(async () => [ni('binance:7', 'binance', 'Binance Will Delist ABC (ABC)')]) } })
    await runCycle({ state: emptyState(), nowMs: NOW, deps })
    const [mk, opts] = deps.ensureEvents.mock.calls[0]
    expect(mk).toEqual(['KRW-ID', 'KRW-NMR'])
    expect(opts.alerting).toBe(false)
    expect(await opts.deps.fetchBinanceAnnouncements()).toEqual([{ id: 'binance:7', title: 'Binance Will Delist ABC (ABC)', ts: null }])
    expect(await opts.deps.fetchBithumbAnnouncements()).toEqual([])
  })
  it('소스 30분 연속 실패 → 중단 알림 1회, 회복 → 회복 알림', async () => {
    const deps = mkDeps({ fetchers: { bithumb: vi.fn(async () => null) } })
    let s = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    s = (await runCycle({ state: s, nowMs: NOW + 31 * 60000, deps })).state
    expect(deps.send.mock.calls.at(-1)[0]).toContain('⚠️뉴스 소스 중단: 빗썸')
    const calls = deps.send.mock.calls.length
    s = (await runCycle({ state: s, nowMs: NOW + 33 * 60000, deps })).state
    expect(deps.send.mock.calls.length).toBe(calls) // 중복 경고 없음
    deps.fetchers.bithumb = vi.fn(async () => [])
    s = (await runCycle({ state: s, nowMs: NOW + 36 * 60000, deps })).state
    expect(deps.send.mock.calls.at(-1)[0]).toContain('✅ 뉴스 소스 회복: 빗썸')
  })
  it('깨진 상태(빈 객체)도 첫 실행처럼 무알림 복구', async () => {
    const deps = mkDeps()
    const r = await runCycle({ state: {}, nowMs: NOW, deps })
    expect(deps.send).not.toHaveBeenCalled()
    expect(r.state.initialized).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-cycle.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/cycle.mjs
// news-watch 한 사이클: 주기 된 소스 수집 → 새 항목 → 매칭·분류 → 로그 → 공식 악재 반영 → 알림.
import { buildMatcher } from './match.mjs'
import { classifyItem } from './classify.mjs'
import { emptyState, pruneState, newItems, markSeen } from './store.mjs'
import { selectAlerts, formatNewsAlert } from './route.mjs'

export const SOURCE_EVERY_MS = { coinness: 60000, upbit: 60000, bithumb: 120000, binance: 300000 }
export const FAIL_NOTIFY_MS = 30 * 60000
const SRC_KO = { coinness: '코인니스', upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }
const OFFICIAL = ['upbit', 'binance', 'bithumb']

export async function runCycle({ state: raw, nowMs, deps }) {
  let state = { ...emptyState(), ...(raw || {}) }
  const due = Object.keys(SOURCE_EVERY_MS).filter((s) => {
    const last = Date.parse(state.lastFetchAt?.[s] ?? '')
    return !Number.isFinite(last) || nowMs - last >= SOURCE_EVERY_MS[s] - 5000
  })
  const results = {}
  await Promise.all(due.map(async (s) => { results[s] = await deps.fetchers[s]().catch(() => null) }))

  const iso = new Date(nowMs).toISOString()
  const lastFetchAt = { ...state.lastFetchAt }, sourceFail = { ...state.sourceFail }
  const notices = []
  for (const s of due) {
    lastFetchAt[s] = iso
    if (results[s] == null) {
      const f = sourceFail[s] || { since: iso, notified: false }
      if (!f.notified && nowMs - Date.parse(f.since) >= FAIL_NOTIFY_MS) { notices.push(`⚠️뉴스 소스 중단: ${SRC_KO[s]}`); sourceFail[s] = { ...f, notified: true } }
      else sourceFail[s] = f
    } else if (sourceFail[s]) {
      if (sourceFail[s].notified) notices.push(`✅ 뉴스 소스 회복: ${SRC_KO[s]}`)
      delete sourceFail[s]
    }
  }
  state = { ...state, lastFetchAt, sourceFail }

  const items = due.flatMap((s) => results[s] || [])
  const fresh = newItems(items, state)
  const markets = await deps.getMarkets()
  const match = buildMatcher(markets)
  const recs = fresh.map((item) => ({ item, ...match(item), ...classifyItem(item) }))
  await deps.appendLog(recs.map((r) => ({
    ts: r.item.ts, seenAt: iso, source: r.item.source, id: r.item.id, title: r.item.title, url: r.item.url,
    markets: r.markets, via: r.via, kind: r.kind, type: r.type, tags: r.tags, important: r.item.important,
  })))

  const ctx = await deps.readCtx()
  if (OFFICIAL.some((s) => results[s] != null)) {
    const asAnn = (s) => async () => (results[s] == null ? null : results[s].map((x) => ({ id: x.id, title: x.title, ts: x.ts })))
    await deps.ensureEvents(markets.map((m) => m.market), {
      positions: ctx.positions || [], alerting: false,
      deps: { fetchUpbitAnnouncements: asAnn('upbit'), fetchBinanceAnnouncements: asAnn('binance'), fetchBithumbAnnouncements: asAnn('bithumb') },
    }).catch(() => null)
  }

  let sent = 0
  if (!state.initialized) {
    state = { ...markSeen(state, fresh, nowMs), initialized: true }
  } else {
    const { alerts, keys } = selectAlerts(recs, ctx, state, nowMs)
    state = markSeen(state, fresh, nowMs)
    if (alerts.length || notices.length) {
      const ok = await deps.send(formatNewsAlert(alerts, deps.whenLabel(nowMs), notices))
      if (ok) {
        sent = alerts.length
        const alerted = { ...state.alerted }
        for (const k of keys) alerted[k] = iso
        state = { ...state, alerted }
      }
    }
  }
  state = pruneState({ ...state, lastLoopAt: iso }, nowMs)
  return { state, sent, newCount: fresh.length, notices }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/news-cycle.test.mjs`
Expected: PASS (7 tests). 그 다음 `npx vitest run` 전체 PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/news/cycle.mjs __tests__/news-cycle.test.mjs
git commit -m "feat(news): single-cycle orchestration with source schedules and failure notices"
```

---

### Task 8: 데몬 스크립트·monitor 생존 경고·스케줄러 등록

**Files:**
- Create: `lib/news/health.mjs`, `scripts/news-watch.mjs`
- Modify: `scripts/monitor.mjs` (main 끝에 `await warnNewsDaemonStale()` 추가, 함수 추가), `scripts/install-scheduler.ps1` (봇 블록 아래 UpbitNewsWatch)
- Test: `__tests__/news-health.test.mjs`

**Interfaces:**
- Consumes: Task 7 `runCycle`, Task 1 수집기, 기존 `getMarkets`, `readPositions`, `readJson/writeJson/withLock`, `ensureEvents`, `sendTelegram`
- Produces: `newsDaemonStale(newsState, health, nowMs): { warn: boolean, health }` — newsState에 `lastLoopAt`이 없으면 경고하지 않는다(설치 전), 10분 초과 + 오늘(KST) 미경고일 때만 warn.

- [ ] **Step 1: Write the failing test**

```js
// __tests__/news-health.test.mjs
import { describe, it, expect } from 'vitest'
import { newsDaemonStale } from '../lib/news/health.mjs'

const NOW = Date.parse('2026-10-07T13:41:00Z')
describe('newsDaemonStale', () => {
  it('상태 없음(미설치) → 경고 안 함', () => {
    expect(newsDaemonStale(null, {}, NOW).warn).toBe(false)
  })
  it('10분 이내 → 정상', () => {
    expect(newsDaemonStale({ lastLoopAt: new Date(NOW - 5 * 60000).toISOString() }, {}, NOW).warn).toBe(false)
  })
  it('10분 초과 → 경고, 같은 KST 날짜엔 1회만', () => {
    const st = { lastLoopAt: new Date(NOW - 11 * 60000).toISOString() }
    const r1 = newsDaemonStale(st, {}, NOW)
    expect(r1.warn).toBe(true)
    expect(newsDaemonStale(st, r1.health, NOW + 3600000).warn).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/news-health.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// lib/news/health.mjs
// monitor가 정시 스캔 때 news-watch 데몬 생존을 점검(하루 1회 경고).
const STALE_MS = 10 * 60000
const kstDay = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10)

export function newsDaemonStale(newsState, health = {}, nowMs) {
  const last = Date.parse(newsState?.lastLoopAt ?? '')
  if (!Number.isFinite(last) || nowMs - last <= STALE_MS) return { warn: false, health }
  if (health?.warnedDay === kstDay(nowMs)) return { warn: false, health }
  return { warn: true, health: { ...health, warnedDay: kstDay(nowMs) } }
}
```

```js
// scripts/news-watch.mjs
// 뉴스·공지 감시 상주 데몬. 60초마다 runCycle(소스별 주기는 lib/news/cycle.mjs).
// 실행: node scripts/news-watch.mjs (작업 스케줄러 UpbitNewsWatch가 로그인 시 시작)
import '../lib/env.mjs'
import { getMarkets } from '../lib/upbit.mjs'
import { readJson, writeJson, withLock } from '../lib/store.mjs'
import { readPositions } from '../lib/positions.mjs'
import { ensureEvents } from '../lib/exchange-events.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import { fetchCoinness } from '../lib/news/sources/coinness.mjs'
import { fetchBithumbNotices } from '../lib/news/sources/bithumb.mjs'
import { fetchUpbitNews, fetchBinanceNews } from '../lib/news/sources/exchanges.mjs'
import { appendNewsLog } from '../lib/news/store.mjs'
import { runCycle } from '../lib/news/cycle.mjs'

const LOOP_MS = 60000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let marketsCache = { at: 0, list: [] }
async function cachedMarkets() {
  if (Date.now() - marketsCache.at < 3600000 && marketsCache.list.length) return marketsCache.list
  const list = await getMarkets()
  if (list && list.length) marketsCache = { at: Date.now(), list }
  return marketsCache.list
}

async function readCtx() {
  const positions = readPositions()
  const monitor = await readJson('monitor-log.json', { scans: [] })
  const momentum = await readJson('momentum-log.json', { scans: [] })
  const candidates = new Set([...(monitor.scans?.at(-1)?.buy || []), ...(momentum.scans?.at(-1)?.picks || [])].map((x) => x.market))
  return { held: new Set(positions.map((p) => p.market)), candidates, positions }
}

const deps = {
  fetchers: { coinness: fetchCoinness, upbit: fetchUpbitNews, binance: fetchBinanceNews, bithumb: fetchBithumbNotices },
  getMarkets: cachedMarkets,
  readCtx,
  ensureEvents,
  appendLog: (records) => appendNewsLog(records),
  send: sendTelegram,
  whenLabel: (ms) => new Date(ms).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }),
}

async function once() {
  await withLock('news-state', async () => {
    const state = await readJson('news-state.json', null)
    const r = await runCycle({ state, nowMs: Date.now(), deps })
    await writeJson('news-state.json', r.state)
    if (r.newCount || r.sent || r.notices.length) console.log(`${new Date().toISOString()} 새 ${r.newCount} · 알림 ${r.sent}${r.notices.length ? ' · ' + r.notices.join(' / ') : ''}`)
  })
}

console.log(`${new Date().toISOString()} news-watch 시작`)
for (;;) {
  const t0 = Date.now()
  try { await once() } catch (e) { console.error(`${new Date().toISOString()} 사이클 실패:`, e?.message || e) }
  await sleep(Math.max(1000, LOOP_MS - (Date.now() - t0)))
}
```

`scripts/monitor.mjs` 변경(Edit 도구, CRLF 유지):
- import 추가: `import { newsDaemonStale } from '../lib/news/health.mjs'`
- main 끝 `await notifyPositionAlerts()` 다음 줄에 `await warnNewsDaemonStale()`
- `notifyPositionAlerts` 함수 위에 추가:

```js
// news-watch 데몬 생존 점검: 10분 넘게 사이클이 없으면 하루 1회 경고(설치 전이면 조용).
async function warnNewsDaemonStale() {
  const st = await readJson('news-state.json', null)
  const health = await readJson('news-watch-health.json', {})
  const r = newsDaemonStale(st, health, Date.now())
  if (!r.warn) return
  console.log('⚠️ 뉴스 데몬 정지 — 마지막 사이클', st.lastLoopAt)
  if (await sendTelegram(`⚠️ 뉴스 데몬 정지 — 마지막 사이클 ${st.lastLoopAt}\n작업 스케줄러 UpbitNewsWatch 상태를 확인하세요.`)) await writeJson('news-watch-health.json', r.health)
}
```

`scripts/install-scheduler.ps1`: 봇 등록 블록 바로 아래, `Write-Host "`nverify: ...` 위에 추가:

```powershell
# 상주 뉴스·공지 감시 데몬 — 로그인 시 시작, 죽으면 1분 뒤 재시작(봇과 같은 설정).
$newsScript = Join-Path $projectRoot 'scripts\news-watch.mjs'
$newsAction = New-LoggingAction $newsScript 'UpbitNewsWatch'
$newsTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'UpbitNewsWatch' -Action $newsAction -Trigger $newsTrigger -Settings $botSettings -Force | Out-Null
Write-Host "registered: UpbitNewsWatch (AtLogOn, always-on)"
```

- [ ] **Step 4: Run tests and an isolated real cycle**

Run: `npx vitest run` → 전체 PASS.
격리 실행(텔레그램 끔, 실데이터 미오염):

```bash
SP=<scratchpad>/iso-news && rm -rf $SP && mkdir -p $SP/data && cp -r lib scripts package.json $SP/ && cp data/*.json $SP/data/ && cd $SP
env -u TELEGRAM_TOKEN -u TELEGRAM_CHAT_ID timeout 150 node scripts/news-watch.mjs
```

Expected: 첫 사이클 "새 N"(초기화, 알림 없음), 둘째 사이클 이후 새 항목만. `data/news-log.jsonl`에서 매칭(markets·via)과 kind를 눈으로 점검하고, 오탐 티커가 있으면 `AMBIGUOUS_TICKERS`에 추가 + Task 3 테스트에 케이스 추가.

- [ ] **Step 5: Commit**

```bash
git add lib/news/health.mjs scripts/news-watch.mjs scripts/monitor.mjs scripts/install-scheduler.ps1 __tests__/news-health.test.mjs
git commit -m "feat(news): news-watch daemon, monitor liveness warning, scheduler task"
```

- [ ] **Step 6: 설치(사용자 확인 후)**

작업 스케줄러 재등록은 모든 Upbit 작업을 지우고 다시 만드는 스크립트라 실행 전에 사용자에게 확인받는다. 승인되면:
`powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1` 후 `Start-ScheduledTask -TaskName UpbitNewsWatch`, 2분 뒤 `data\task-logs\UpbitNewsWatch.log`와 `data\news-state.json`의 `lastLoopAt` 확인.

---

### Task 9: 공식 상장 공지 → 가격 효과 측정 (점수 가산 판단용)

**Files:**
- Create: `scripts/research/news/listing-effect.mjs`, `scripts/research/news/README.md`

**Interfaces:**
- Consumes: Task 4 `classifyItem`, Task 3 `buildMatcher`, `data/research/candles.json`(일봉 600일, signal-ablation fetch로 생성), 업비트 공지 페이지 API, 바이낸스 catalog 48 페이지 API.
- Produces: 콘솔 표 + README 결과 기록. 코드 변경 없음(가산은 사용자 결정 후 별도 작업).

- [ ] **Step 1: 스크립트 작성**

```js
// scripts/research/news/listing-effect.mjs
// 공식 상장 공지 뒤 업비트 KRW 가격이 같은 날 전 종목 평균보다 더 올랐나(일봉 기준, 18개월).
// 진입 = 공지 다음 확정 일봉 종가(공지 당일 급등을 사는 비용을 포함하려고 당일 종가도 따로 본다).
import { readFileSync } from 'node:fs'
import { getMarkets } from '../../../lib/upbit.mjs'
import { classifyItem } from '../../../lib/news/classify.mjs'
import { buildMatcher } from '../../../lib/news/match.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const DAY = 86400

async function upbitHistory(maxPages = 60) {
  const out = []
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetch(`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=30&category=trade`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
    if (!r?.ok) break
    const d = await r.json()
    const n = d?.data?.notices || []
    if (!n.length) break
    for (const x of n) out.push({ id: `upbit:${x.id}`, source: 'upbit', title: x.title, ts: x.first_listed_at || x.listed_at, codes: [], important: false, body: null, url: null })
    await sleep(300)
  }
  return out
}
async function binanceHistory(maxPages = 15) {
  const out = []
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=${p}&pageSize=20`, { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'en' } }).catch(() => null)
    if (!r?.ok) break
    const d = await r.json()
    const a = d?.data?.articles || []
    if (!a.length) break
    for (const x of a) out.push({ id: `binance:${x.id}`, source: 'binance', title: x.title, ts: x.releaseDate ? new Date(x.releaseDate).toISOString() : null, codes: [], important: false, body: null, url: null })
    await sleep(1500) // 레이트리밋 회피
  }
  return out
}

// 일별 전 종목 평균 수익(초과수익 기준선): day → (close_{d+h}/close_d − 1) 평균
const dayIdx = {}
for (const [m, o] of Object.entries(candles)) dayIdx[m] = new Map(o.map((c, i) => [Math.floor(c.time / DAY), i]))
const fwd = (m, d, h) => { const o = candles[m], i = dayIdx[m]?.get(d); if (i == null || i + h >= o.length) return null; return o[i + h].close / o[i].close - 1 }
const base = new Map()
const baseAt = (d, h) => {
  const k = `${d}|${h}`
  if (!base.has(k)) { const v = Object.keys(candles).map((m) => fwd(m, d, h)).filter((x) => x != null).map((x) => Math.max(-0.5, Math.min(0.5, x))); base.set(k, v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0) }
  return base.get(k)
}

const markets = await getMarkets()
const match = buildMatcher(markets)
const items = [...await upbitHistory(), ...await binanceHistory()]
const events = []
for (const it of items) {
  const c = classifyItem(it)
  if (c.kind !== 'official-listing' || !it.ts) continue
  for (const m of match(it).markets) events.push({ m, type: c.type, d: Math.floor(Date.parse(it.ts) / 1000 / DAY), title: it.title })
}
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
const rows = {}
for (const e of events) {
  // 진입 A: 공지 당일 종가(당일 급등 포함 후 매수), 진입 B: 공지 전날 종가(이상적, 비현실 — 참고용)
  for (const [entry, d0] of [['당일종가 진입', e.d], ['전날종가(참고)', e.d - 1]]) {
    for (const h of [1, 3, 7]) {
      const r = fwd(e.m, d0, h); if (r == null) continue
      const key = `${e.type}|${entry}|${h}`
      ;(rows[key] ||= []).push(W(r) - baseAt(d0, h))
    }
  }
}
console.log(`공지 ${items.length}건 → 상장 이벤트(업비트 KRW 코인 매칭) ${events.length}건`)
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
for (const [k, v] of Object.entries(rows).sort()) console.log(k.padEnd(36), `n ${String(v.length).padStart(4)}  초과 ${(mean(v) * 100).toFixed(2)}%p  승 ${(v.filter((x) => x > 0).length / v.length * 100).toFixed(0)}%`)
```

- [ ] **Step 2: 실행**

Run: `node scripts/research/news/listing-effect.mjs`
Expected: 유형별(upbit-krw / binance-spot / binance-futures) × 진입(당일종가/전날종가) × 1·3·7일 초과수익 표. 이벤트 수가 유형당 20건 미만이면 그 칸은 결론을 내지 않는다고 README에 적는다.

- [ ] **Step 3: README에 결과 기록**

`scripts/research/news/README.md`에 실행 방법, 실행 일자, 표, 해석(현실적 진입인 "당일종가 진입"이 양(+)인지)을 적는다. "전날종가"는 공지를 미리 알 수 없으므로 참고값임을 명시한다.

- [ ] **Step 4: Commit**

```bash
git add scripts/research/news
git commit -m "research(news): official listing announcement effect on Upbit KRW prices"
```

- [ ] **Step 5: 사용자 보고** — 표와 함께 "점수 가산을 할지" 결정을 요청한다(이 계획에서는 구현하지 않는다).
