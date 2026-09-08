# 거래소 이벤트 방어 레이어 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 업비트(주)·바이낸스(보조) 공식 공지 API로 상폐·유의지정·입출금중단·마이그레이션 이벤트를 잡아 매수 점수를 감점/제외하고 신규 이벤트를 텔레그램으로 알린다.

**Architecture:** `lib/structural-risk.mjs`·`lib/funding.mjs`와 동일한 패턴 — 순수 분류/매칭 함수 + `ensureEvents()` 오케스트레이터(deps 주입, 실패 시 neutral 폴백). 스캔 루프 전 1회 조회, `lib/buy-modifiers.mjs` 배수 체인에 `eventRisk` 단계 추가, monitor가 신규 이벤트를 텔레그램 발송. dedup 상태는 `data/event-log.json`에 영속(withLock).

**Tech Stack:** Node.js ESM(.mjs), vitest, 기존 `store.mjs`(readJson/writeJson/withLock), 전역 `fetch`.

## Global Constraints

- 스캔 불사침(不可侵): 이벤트 레이어의 어떤 실패도 스캔을 중단시키지 않는다. 모든 진입점은 try/catch로 감싸고 실패 시 `{ byMarket: {}, newEvents: [], coverage: 0, reason }` 반환.
- 업비트=주 신뢰 소스, 바이낸스=best-effort 보조. 바이낸스 실패는 정상 경로로 간주(업비트만으로 완전 동작).
- 한글 주석은 반드시 Write/Edit 도구로만 작성(PowerShell은 UTF-8-no-BOM 한글을 깨뜨림).
- 커밋 트레일러: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- `data/` 아래 기존 파일(positions.json 등) 절대 훼손 금지. 신규 파일은 `event-log.json`만.
- `Date.now()`/`new Date(explicitArg)`는 앱 코드에서 정상 사용 가능(Workflow 스크립트 제약과 무관).
- 감점 배수(스펙 확정): 상폐 mult=0(제외) / 유의 ×0.5 / 입출금중단·마이그레이션 ×0.7. 만료 TTL: 상폐 90일·유의 30일·입출금중단 14일.

---

### Task 1: 순수 분류·매칭 함수 (lib/exchange-events.mjs)

공지 제목 → 이벤트 타입/심각도 분류, 티커 추출, 유니버스 매칭, 종목별 최종 배수/라벨 계산. 네트워크 없음, 100% 순수 함수.

**Files:**
- Create: `lib/exchange-events.mjs`
- Test: `__tests__/exchange-events.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `EVENT_RULES` — 규칙 배열(순서 중요)
  - `classifyAnnouncement(title: string) → { type, severity, mult, ttlDays } | null`
  - `parseTickers(title: string) → string[]`
  - `matchMarkets(tickers: string[], universeSet: Set<string>) → string[]`
  - `eventRiskMult(events: Array<{type,exchange,mult}>) → { mult: number, label: string|null }`
  - 타입: `type ∈ {'delist','resume','caution','halt','listing'}`, `severity ∈ {'critical','clear','high','mid','neutral'}`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/exchange-events.test.mjs` 생성:

```javascript
import { describe, it, expect } from 'vitest'
import {
  classifyAnnouncement, parseTickers, matchMarkets, eventRiskMult,
} from '../lib/exchange-events.mjs'

describe('classifyAnnouncement', () => {
  it('상폐 → delist(mult 0)', () => {
    expect(classifyAnnouncement('OO 거래지원 종료 안내')).toMatchObject({ type: 'delist', mult: 0 })
    expect(classifyAnnouncement('Binance Will Delist ABC')).toMatchObject({ type: 'delist' })
  })
  it('유의지정 → caution(×0.5)', () => {
    expect(classifyAnnouncement('샌드박스(SAND) 거래 유의 종목 지정 안내')).toMatchObject({ type: 'caution', mult: 0.5 })
  })
  it('입출금중단/마이그레이션 → halt(×0.7)', () => {
    expect(classifyAnnouncement('네트워크 전환에 따른 소폰(SOPH) 입출금 중단 안내')).toMatchObject({ type: 'halt', mult: 0.7 })
    expect(classifyAnnouncement('아르고(AERGO) 토큰 스왑 일정 안내')).toMatchObject({ type: 'halt' })
  })
  it('재개/해제 → resume — halt/caution 규칙보다 먼저 매칭', () => {
    expect(classifyAnnouncement('문빔(GLMR) 입출금 재개 안내')).toMatchObject({ type: 'resume' })
    expect(classifyAnnouncement('타이코(TAIKO) 거래 유의 종목 지정 해제 안내')).toMatchObject({ type: 'resume' })
  })
  it('신규상장 → listing(중립)', () => {
    expect(classifyAnnouncement('클러스터프로토콜(CP) 신규 거래지원 안내')).toMatchObject({ type: 'listing', mult: 1 })
  })
  it('무관 제목 → null', () => {
    expect(classifyAnnouncement('보이스피싱 예방 주간 안내')).toBeNull()
    expect(classifyAnnouncement(null)).toBeNull()
  })
})

describe('parseTickers', () => {
  it('괄호 안 단일/복수 티커', () => {
    expect(parseTickers('소폰(SOPH) 입출금 중단')).toEqual(['SOPH'])
    expect(parseTickers('아르고(AERGO), 알파쿼크(AQT) 토큰 스왑')).toEqual(['AERGO', 'AQT'])
  })
  it('마켓 표기 괄호는 오탐 안 함', () => {
    // "(KRW, BTC, USDT 마켓)"은 단일 대문자 토큰이 아니라 매칭 안 됨
    expect(parseTickers('클러스터프로토콜(CP) 신규 거래지원 안내 (KRW, BTC, USDT 마켓)')).toEqual(['CP'])
  })
  it('티커 없음 → 빈 배열', () => {
    expect(parseTickers('Binance Futures Will Launch USDs-Margined XYZ')).toEqual([])
    expect(parseTickers(null)).toEqual([])
  })
})

describe('matchMarkets', () => {
  const uni = new Set(['KRW-SOPH', 'KRW-AERGO', 'KRW-BTC'])
  it('유니버스에 있는 티커만 KRW- 마켓으로', () => {
    expect(matchMarkets(['SOPH', 'AQT'], uni)).toEqual(['KRW-SOPH'])
    expect(matchMarkets(['AERGO', 'BTC'], uni)).toEqual(['KRW-AERGO', 'KRW-BTC'])
  })
  it('매칭 없음 → 빈 배열', () => {
    expect(matchMarkets(['DOGE'], uni)).toEqual([])
  })
})

describe('eventRiskMult', () => {
  it('빈 이벤트 → mult 1, label null', () => {
    expect(eventRiskMult([])).toEqual({ mult: 1, label: null })
  })
  it('가장 강한(min) 배수 채택 + 라벨', () => {
    const r = eventRiskMult([
      { type: 'halt', exchange: 'upbit', mult: 0.7 },
      { type: 'caution', exchange: 'binance', mult: 0.5 },
    ])
    expect(r.mult).toBe(0.5)
    expect(r.label).toContain('유의지정')
    expect(r.label).toContain('바이낸스')
  })
  it('상폐(0)가 최우선', () => {
    expect(eventRiskMult([{ type: 'halt', exchange: 'upbit', mult: 0.7 }, { type: 'delist', exchange: 'upbit', mult: 0 }]).mult).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/exchange-events.test.mjs`
Expected: FAIL — `classifyAnnouncement is not a function` (모듈 미존재)

- [ ] **Step 3: 최소 구현**

`lib/exchange-events.mjs` 생성 (이 스텝에서는 순수 함수만):

```javascript
// 거래소 이벤트 방어 스크린 — 공식 공지 제목을 분류해 매수 점수 감점/제외(방어).
// 업비트=주 소스, 바이낸스=보조. 소폰(-86%) 마이그레이션 재발 방지. 최종 판단은 사용자.

// 규칙 순서 중요: 상폐(최강) → 재개/해제(중단/유의보다 먼저) → 유의 → 입출금중단 → 신규상장.
// "유의 종목 지정 해제"가 "유의 종목 지정"보다, "입출금 재개"가 "입출금 중단"보다 먼저 매칭돼야 한다.
export const EVENT_RULES = [
  { type: 'delist',  severity: 'critical', mult: 0,   ttlDays: 90, re: /거래지원\s*종료|상장\s*폐지|디지털\s*자산.*폐지|will\s+delist|delisting/i },
  { type: 'resume',  severity: 'clear',    mult: 1,   ttlDays: 0,  re: /입출금\s*(지원)?\s*재개|거래\s*재개|유의\s*종목\s*지정\s*해제|모니터링\s*(태그)?\s*해제/i },
  { type: 'caution', severity: 'high',     mult: 0.5, ttlDays: 30, re: /유의\s*종목\s*지정|유의\s*촉구|monitoring\s*tag|투자\s*유의/i },
  { type: 'halt',    severity: 'mid',      mult: 0.7, ttlDays: 14, re: /입출금\s*(일시)?\s*중단|네트워크\s*전환|마이그레이션|토큰\s*스왑|migration|token\s*swap/i },
  { type: 'listing', severity: 'neutral',  mult: 1,   ttlDays: 0,  re: /신규\s*거래지원|추가\s*거래지원|will\s+list|seed\s*tag/i },
]

// 제목 → { type, severity, mult, ttlDays } | null. 첫 매칭 규칙 채택.
export function classifyAnnouncement(title) {
  if (typeof title !== 'string') return null
  for (const r of EVENT_RULES) {
    if (r.re.test(title)) return { type: r.type, severity: r.severity, mult: r.mult, ttlDays: r.ttlDays }
  }
  return null
}

// 제목의 괄호 안 대문자 티커 추출: "소폰(SOPH)" → ['SOPH']. 마켓표기 "(KRW, BTC 마켓)"은 미매칭.
export function parseTickers(title) {
  if (typeof title !== 'string') return []
  const out = []
  const re = /\(([A-Z0-9]{2,10})\)/g
  let m
  while ((m = re.exec(title))) out.push(m[1])
  return [...new Set(out)]
}

// 티커 → 유니버스에 존재하는 KRW- 마켓만.
export function matchMarkets(tickers, universeSet) {
  const out = []
  for (const t of tickers || []) { const m = `KRW-${t}`; if (universeSet.has(m)) out.push(m) }
  return out
}

const TYPE_KO = { delist: '상폐', caution: '유의지정', halt: '입출금중단' }
const EX_KO = { upbit: '업비트', binance: '바이낸스' }

// 종목의 활성 이벤트들 → 가장 강한(min mult) 배수 + 표시 라벨.
export function eventRiskMult(events) {
  if (!events || !events.length) return { mult: 1, label: null }
  let worst = events[0]
  for (const e of events) if (e.mult < worst.mult) worst = e
  const label = `⚠️거래소이벤트(${TYPE_KO[worst.type] || worst.type}·${EX_KO[worst.exchange] || worst.exchange})`
  return { mult: worst.mult, label }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/exchange-events.test.mjs`
Expected: PASS (전체 describe 4개)

- [ ] **Step 5: 커밋**

```bash
git add lib/exchange-events.mjs __tests__/exchange-events.test.mjs
git commit -m "feat: 거래소 이벤트 분류·매칭 순수 함수 (Phase1 Task1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 페처 + ensureEvents 오케스트레이터 + dedup 상태

두 거래소 공지 조회, 분류·매칭, `data/event-log.json`에 dedup/만료 상태 유지, 종목별 배수맵과 신규 이벤트 반환.

**Files:**
- Modify: `lib/binance.mjs` (끝에 `fetchBinanceAnnouncements` 추가)
- Modify: `lib/exchange-events.mjs` (`fetchUpbitAnnouncements`, `ensureEvents` 추가)
- Test: `__tests__/exchange-events.test.mjs` (ensureEvents describe 추가)

**Interfaces:**
- Consumes: Task 1의 `classifyAnnouncement`, `parseTickers`, `matchMarkets`, `eventRiskMult`; `store.mjs`의 `readJson(name, default)`, `writeJson(name, obj)`, `withLock(name, fn)`
- Produces:
  - `fetchBinanceAnnouncements({ catalogIds?, timeoutMs? }) → Array<{id,title,ts}> | null` (binance.mjs)
  - `fetchUpbitAnnouncements({ pages?, timeoutMs? }) → Array<{id,title,ts}> | null` (exchange-events.mjs)
  - `ensureEvents(markets, { now?, positions?, deps? }) → { byMarket, newEvents, coverage, reason? }`
    - `byMarket[market] = { mult, label, events: Array<active event> }`
    - `newEvents = Array<{ srcId, exchange, type, title, ts, markets }>`

- [ ] **Step 1: 바이낸스 상폐/모니터링 catalogId 확정 (조사)**

바이낸스 bapi 카탈로그를 프로브해 상폐(Delisting)·모니터링 카탈로그 ID를 확인한다. 연속 호출 시 레이트리밋(빈 응답)이 관찰되므로 각 호출 사이 400ms 이상 간격을 둔다:

```bash
node --input-type=module -e "
const j=async u=>{const r=await fetch(u,{headers:{'User-Agent':'Mozilla/5.0','lang':'en'}});return r.json();};
for(const id of [161,49,157,128,93]){
  try{const d=await j('https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId='+id+'&pageNo=1&pageSize=5');
    const c=d?.data?.catalogs?.[0]; console.log(id, c?.catalogName, (c?.articles||[]).slice(0,2).map(a=>a.title).join(' | '));
  }catch(e){console.log(id,'ERR')}
  await new Promise(r=>setTimeout(r,600));
}"
```

상폐/모니터링 성격의 제목이 나오는 catalogId를 골라 Step 3의 `catalogIds` 기본값에 넣는다. 프로브가 전부 레이트리밋으로 비면 알려진 신규상장 ID(48)를 제외한 후보 `[161, 161]`를 잠정 사용하고, 실환경 검증(Task 4)에서 재확인한다. **바이낸스 조회는 실패해도 업비트만으로 동작하므로 이 ID가 완벽하지 않아도 기능은 성립한다.**

- [ ] **Step 2: 실패 테스트 작성 (ensureEvents)**

`__tests__/exchange-events.test.mjs` 상단 import에 `ensureEvents` 추가하고, 파일 끝에 append:

```javascript
import { ensureEvents } from '../lib/exchange-events.mjs'
import { vi } from 'vitest'

// 인메모리 상태 저장소 스텁 (store.mjs 대체)
function memStore(init = { seenIds: {}, active: {} }) {
  let data = JSON.parse(JSON.stringify(init))
  return {
    readJson: vi.fn(async () => JSON.parse(JSON.stringify(data))),
    writeJson: vi.fn(async (_n, obj) => { data = JSON.parse(JSON.stringify(obj)) }),
    withLock: vi.fn(async (_n, fn) => fn()),
    _get: () => data,
  }
}

describe('ensureEvents', () => {
  const markets = ['KRW-SOPH', 'KRW-BTC']
  const sophHalt = [{ id: 'upbit:6548', title: '네트워크 전환에 따른 소폰(SOPH) 입출금 중단 안내', ts: '2026-09-07T12:20:00+09:00' }]

  const mkDeps = (over = {}) => ({
    ...memStore(),
    fetchUpbitAnnouncements: vi.fn(async () => sophHalt),
    fetchBinanceAnnouncements: vi.fn(async () => null),
    ...over,
  })

  it('업비트 halt → byMarket 감점 + newEvents', async () => {
    const r = await ensureEvents(markets, { now: 1_000_000_000_000, deps: mkDeps() })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7)
    expect(r.byMarket['KRW-SOPH'].label).toContain('입출금중단')
    expect(r.newEvents).toHaveLength(1)
    expect(r.newEvents[0].markets).toEqual(['KRW-SOPH'])
  })

  it('dedup: 같은 상태 재조회 → newEvents 비어야 함', async () => {
    const deps = mkDeps()
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    const r2 = await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    expect(r2.newEvents).toHaveLength(0)
    expect(r2.byMarket['KRW-SOPH'].mult).toBe(0.7) // 활성은 유지
  })

  it('resume가 활성 이벤트 상쇄', async () => {
    const deps = mkDeps()
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => [{ id: 'upbit:6600', title: '소폰(SOPH) 입출금 재개 안내', ts: '2026-09-20T10:00:00+09:00' }])
    const r = await ensureEvents(markets, { now: 1_000_100_000_000, deps })
    expect(r.byMarket['KRW-SOPH']).toBeUndefined() // 재개로 제거
  })

  it('만료된 활성 이벤트 청소', async () => {
    // 14일 지난 halt는 자동 제거
    const deps = mkDeps()
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => []) // 신규 없음
    const r = await ensureEvents(markets, { now: 1_000_000_000_000 + 15 * 86400000, deps })
    expect(r.byMarket['KRW-SOPH']).toBeUndefined()
  })

  it('바이낸스 실패·업비트 성공 → 정상 동작(degrade)', async () => {
    const r = await ensureEvents(markets, { now: 1_000_000_000_000, deps: mkDeps({ fetchBinanceAnnouncements: vi.fn(async () => null) }) })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7)
  })

  it('둘 다 실패 → neutral(스캔 무중단)', async () => {
    const r = await ensureEvents(markets, {
      now: 1, deps: mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => null), fetchBinanceAnnouncements: vi.fn(async () => null) }),
    })
    expect(r.byMarket).toEqual({})
    expect(r.reason).toBeTruthy()
  })

  it('유니버스 밖 종목 이벤트는 무시, 보유 포지션은 포함', async () => {
    const deps = mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => [{ id: 'upbit:7000', title: '도지코인(DOGE) 입출금 중단 안내', ts: '2026-09-07T00:00:00+09:00' }]) })
    const r1 = await ensureEvents(['KRW-SOPH'], { now: 1_000_000_000_000, deps })
    expect(r1.byMarket['KRW-DOGE']).toBeUndefined() // 유니버스 밖
    const deps2 = mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => [{ id: 'upbit:7000', title: '도지코인(DOGE) 입출금 중단 안내', ts: '2026-09-07T00:00:00+09:00' }]) })
    const r2 = await ensureEvents(['KRW-SOPH'], { now: 1_000_000_000_000, positions: [{ market: 'KRW-DOGE' }], deps: deps2 })
    expect(r2.byMarket['KRW-DOGE'].mult).toBe(0.7) // 보유 포지션이면 포함
  })
})
```

- [ ] **Step 3: 실패 확인 후 구현**

Run: `npx vitest run __tests__/exchange-events.test.mjs` → FAIL(`ensureEvents is not a function`)

`lib/binance.mjs` 끝에 추가:

```javascript
// 바이낸스 공지(비공식 bapi CMS) — 상폐/모니터링 카탈로그. 레이트리밋·포맷변경에 취약 → 실패 시 null(업비트만으로 degrade).
// catalogIds: Task2 Step1에서 확정한 상폐/모니터링 ID.
export async function fetchBinanceAnnouncements({ catalogIds = [161], timeoutMs = 8000 } = {}) {
  try {
    const out = []
    for (const cid of catalogIds) {
      const r = await fetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=${cid}&pageNo=1&pageSize=20`,
        { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'en', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) continue
      const d = await r.json()
      const arts = d?.data?.catalogs?.[0]?.articles || []
      for (const a of arts) out.push({ id: `binance:${a.id}`, title: a.title, ts: a.releaseDate ? new Date(a.releaseDate).toISOString() : null })
    }
    return out.length ? out : null
  } catch { return null }
}
```

`lib/exchange-events.mjs` 상단 import 추가 + 파일 끝에 페처·오케스트레이터 추가:

```javascript
import { readJson, writeJson, withLock } from './store.mjs'
import { fetchBinanceAnnouncements } from './binance.mjs'

const DAY_MS = 86400000

// 업비트 공지 API(api-manager) — 최근 pages 페이지. 실패 시 null(부분 성공은 있는 만큼 반환).
export async function fetchUpbitAnnouncements({ pages = 2, timeoutMs = 8000 } = {}) {
  try {
    const out = []
    for (let p = 1; p <= pages; p++) {
      const r = await fetch(`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=30&category=all`,
        { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) return out.length ? out : null
      const d = await r.json()
      for (const n of d?.data?.notices || []) out.push({ id: `upbit:${n.id}`, title: n.title, ts: n.first_listed_at || n.listed_at || null })
    }
    return out
  } catch { return null }
}

// 스캐너 진입점. 어떤 실패에도 스캔 불사침. markets: 스캔 유니버스. positions: 보유(유니버스 밖도 알림).
export async function ensureEvents(markets, { now = Date.now(), positions = [], deps = {} } = {}) {
  const d = { fetchUpbitAnnouncements, fetchBinanceAnnouncements, readJson, writeJson, withLock, ...deps }
  const neutral = (reason) => ({ byMarket: {}, newEvents: [], coverage: 0, reason })
  try {
    const universe = new Set([...(markets || []), ...positions.map((p) => p.market)])
    const [up, bn] = await Promise.all([
      Promise.resolve().then(() => d.fetchUpbitAnnouncements()).catch(() => null),
      Promise.resolve().then(() => d.fetchBinanceAnnouncements()).catch(() => null),
    ])
    if (!up && !bn) return neutral('fetch-fail')
    const raw = [
      ...(up || []).map((a) => ({ ...a, exchange: 'upbit' })),
      ...(bn || []).map((a) => ({ ...a, exchange: 'binance' })),
    ]
    const classified = []
    for (const a of raw) {
      const c = classifyAnnouncement(a.title)
      if (!c) continue
      const mkts = matchMarkets(parseTickers(a.title), universe)
      if (!mkts.length) continue
      classified.push({ srcId: a.id, exchange: a.exchange, title: a.title, ts: a.ts, ...c, markets: mkts })
    }
    return await d.withLock('event-log', async () => {
      const state = await d.readJson('event-log.json', { seenIds: {}, active: {} })
      const seenIds = state.seenIds || {}
      const active = state.active || {}
      // 만료 청소
      for (const m of Object.keys(active)) {
        active[m] = (active[m] || []).filter((e) => !e.expiresAt || Date.parse(e.expiresAt) > now)
        if (!active[m].length) delete active[m]
      }
      const newEvents = []
      for (const c of classified) {
        const isNew = !(c.srcId in seenIds)
        for (const m of c.markets) {
          if (c.type === 'resume') { delete active[m] }        // 재개/해제 → 활성 제거
          else if (c.type === 'listing') { /* 방어 무관 */ }
          else {
            const ev = { type: c.type, severity: c.severity, mult: c.mult, exchange: c.exchange, srcId: c.srcId, ts: c.ts, expiresAt: new Date(now + c.ttlDays * DAY_MS).toISOString() }
            const arr = active[m] || (active[m] = [])
            if (!arr.some((e) => e.srcId === ev.srcId)) arr.push(ev)
          }
        }
        if (isNew) {
          seenIds[c.srcId] = c.ts || new Date(now).toISOString()
          if (c.type !== 'listing') newEvents.push({ srcId: c.srcId, exchange: c.exchange, type: c.type, title: c.title, ts: c.ts, markets: c.markets })
        }
      }
      // seenIds 90일 초과분 청소(무한 증가 방지)
      for (const [k, v] of Object.entries(seenIds)) { const t = Date.parse(v); if (Number.isFinite(t) && now - t > 90 * DAY_MS) delete seenIds[k] }
      await d.writeJson('event-log.json', { seenIds, active })
      const byMarket = {}
      for (const m of universe) { const evs = active[m]; if (evs && evs.length) byMarket[m] = { ...eventRiskMult(evs), events: evs } }
      return { byMarket, newEvents, coverage: markets && markets.length ? +(Object.keys(byMarket).length / markets.length).toFixed(2) : 0 }
    })
  } catch { return neutral('error') }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/exchange-events.test.mjs`
Expected: PASS (ensureEvents describe 7개 포함 전체)

- [ ] **Step 5: 커밋**

```bash
git add lib/exchange-events.mjs lib/binance.mjs __tests__/exchange-events.test.mjs
git commit -m "feat: ensureEvents 오케스트레이터 + 공지 페처 + dedup 상태 (Phase1 Task2)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: buy-modifiers 배수 체인에 eventRisk 통합

`applyBuyModifiers`가 `ctx.eventRisk`(= `ensureEvents`가 준 `{ mult, label }`)를 마지막 배수로 적용. mult=0(상폐)이면 점수 0 → 임계 미달로 자동 제외.

**Files:**
- Modify: `lib/buy-modifiers.mjs`
- Test: `__tests__/buy-modifiers.test.mjs`

**Interfaces:**
- Consumes: Task 2의 `byMarket[market] = { mult, label, events }`
- Produces: `applyBuyModifiers(base, signals, ctx)` ctx에 `eventRisk?: { mult, label }` 추가. 반환 객체에 `eventRisk` 포함.

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/buy-modifiers.test.mjs`의 `describe('applyBuyModifiers', ...)` 안에 추가:

```javascript
  it('거래소이벤트 감점(halt ×0.7) + 라벨', () => {
    const r = applyBuyModifiers(10, [], { ...base(), eventRisk: { mult: 0.7, label: '⚠️거래소이벤트(입출금중단·업비트)' } })
    expect(r.score).toBeCloseTo(7, 6)
    expect(r.signals.some((s) => s.includes('거래소이벤트'))).toBe(true)
    expect(r.eventRisk.mult).toBe(0.7)
  })
  it('상폐(mult 0) → 점수 0(제외 유도)', () => {
    const r = applyBuyModifiers(10, [], { ...base(), eventRisk: { mult: 0, label: '⚠️거래소이벤트(상폐·업비트)' } })
    expect(r.score).toBe(0)
  })
  it('eventRisk 없으면 무변화', () => {
    const r = applyBuyModifiers(10, ['RSI 과매도'], base())
    expect(r.score).toBe(10)
    expect(r.eventRisk).toEqual({ mult: 1, label: null })
  })
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/buy-modifiers.test.mjs`
Expected: FAIL — `r.eventRisk`가 undefined / 점수에 배수 미적용

- [ ] **Step 3: 구현**

`lib/buy-modifiers.mjs` 수정. ctx 구조분해에 `eventRisk` 추가, 구조리스크 단계 뒤(return 직전)에 적용:

`const { ... , circRatio, athChangePct, rank, caution } = ctx` 줄을 다음으로 교체:
```javascript
    const { regimeTrend, tradePrice24h, globalVolKrw, sellSignals = [], volRatio, pump,
            fundingRate, circRatio, athChangePct, rank, caution, eventRisk } = ctx
```

구조리스크 블록 다음, `return` 직전에 추가:
```javascript
  // 거래소 이벤트 감점: 상폐(mult 0=제외)·유의·입출금중단 (lib/exchange-events)
  const er = eventRisk && typeof eventRisk.mult === 'number' ? eventRisk : { mult: 1, label: null }
  if (er.mult < 1) { score *= er.mult; if (er.label) sig.push(er.label) }
```

`return { ... }`에 `eventRisk: er` 추가:
```javascript
  return { score, signals: sig, lowLiq, dom, funding: { rate: fundingRate, mult: fundMult }, structuralRisk: sr, eventRisk: er }
```

상단 주석의 배수군 나열에 "거래소이벤트"도 추가:
```javascript
// 매수 점수 배수군 — 레짐·유동성·dominance·낙하칼·추격·펀딩·구조리스크·거래소이벤트를 순서대로 적용.
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/buy-modifiers.test.mjs`
Expected: PASS (기존 8 + 신규 3 = 11)

- [ ] **Step 5: 커밋**

```bash
git add lib/buy-modifiers.mjs __tests__/buy-modifiers.test.mjs
git commit -m "feat: buy-modifiers 배수 체인에 eventRisk 추가 (Phase1 Task3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: monitor.mjs 배선 + 신규 이벤트 텔레그램 알림

스캔 루프 전 `ensureEvents` 호출, 채점에 eventRisk 주입, item에 이벤트 기록, 스캔 후 신규 이벤트 텔레그램 발송. 실환경 스캔으로 검증.

**Files:**
- Modify: `scripts/monitor.mjs`

**Interfaces:**
- Consumes: `ensureEvents`(Task2), `applyBuyModifiers` ctx의 `eventRisk`(Task3), 기존 `sendTelegram`, `readPositions`
- Produces: 없음(엔트리포인트)

- [ ] **Step 1: import 추가**

`scripts/monitor.mjs` import 블록에 추가(다른 lib import 옆):
```javascript
import { ensureEvents } from '../lib/exchange-events.mjs'
```

- [ ] **Step 2: ensureEvents 호출 (루프 전)**

`const funding = await ensureFunding(targets, {})` 및 그 로그 줄 **다음**에 추가:
```javascript
  // 거래소 이벤트 방어 (업비트+바이낸스 공지 — 상폐·유의·입출금중단·마이그레이션). 실패 시 중립 — 스캔 불사침.
  const events = await ensureEvents(targets, { positions: readPositions() })
  console.log(`거래소이벤트: ${Object.keys(events.byMarket).length}종목${events.reason ? ` (${events.reason})` : ''}`)
```

- [ ] **Step 3: 채점에 eventRisk 주입**

`applyBuyModifiers(finalBuyScore, buySignals, { ... })` 호출의 ctx 객체 마지막 필드(`caution: warnOf[market] === 'caution',`) 다음 줄에 추가:
```javascript
        eventRisk: events.byMarket[market],
```

- [ ] **Step 4: item에 이벤트 기록**

buy item 빌드 블록에서 `if (sr.flags.length) item.structuralRisk = ...` 줄 **다음**에 추가:
```javascript
        const ev = events.byMarket[market]
        if (ev) item.event = { mult: ev.mult, label: ev.label, types: ev.events.map((e) => ({ type: e.type, exchange: e.exchange })) }
```

- [ ] **Step 5: 신규 이벤트 알림 함수 추가**

`notifyPositionAlerts` 함수 정의 **앞**에 추가:
```javascript
// 이번 스캔에서 처음 감지된 거래소 이벤트 → 콘솔 + Telegram 즉시 경보
async function notifyEventAlerts(events) {
  const list = events?.newEvents || []
  if (!list.length) return
  const TYPE_KO = { delist: '상장폐지', caution: '유의지정', halt: '입출금중단', resume: '재개/해제' }
  const EX_KO = { upbit: '업비트', binance: '바이낸스' }
  const lines = list.map((e) => `🚨 ${e.markets.map((m) => m.replace('KRW-', '')).join(',')} — ${TYPE_KO[e.type] || e.type}(${EX_KO[e.exchange] || e.exchange})\n   ${e.title}`)
  const msg = `🚨 [거래소 이벤트] ${list.length}건\n${lines.join('\n')}`
  console.log(msg)
  const TG_TOKEN = process.env.TELEGRAM_TOKEN, TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (TG_TOKEN && TG_CHAT_ID) await sendTelegram(msg)
}
```

- [ ] **Step 6: main에서 알림 호출**

`await notifyPositionAlerts()` 줄 **앞**에 추가:
```javascript
  await notifyEventAlerts(events)
```

- [ ] **Step 7: 전체 테스트 + 실환경 스캔 검증**

Run: `npx vitest run`
Expected: PASS (전체, 신규 포함)

그다음 실제 스캔 1회 실행(verify 스킬 — 런타임 관찰):
```bash
node scripts/monitor.mjs
```
확인 항목:
- 콘솔에 `거래소이벤트: N종목` 로그가 뜬다(N≥0, 에러 없이).
- reason이 있으면(`fetch-fail` 등) 스캔이 그래도 완료된다(불사침 확인).
- `data/event-log.json`이 생성되고 `{seenIds, active}` 구조를 가진다.
- 소폰류 활성 이벤트가 있으면 매수후보에서 감점/제외됐는지, 신규면 🚨 알림 콘솔 출력됐는지 확인.

- [ ] **Step 8: 커밋**

```bash
git add scripts/monitor.mjs
git commit -m "feat: monitor에 거래소 이벤트 방어 배선 + 신규 이벤트 알림 (Phase1 Task4)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 문서화 (CHANGELOG + 메모)

**Files:**
- Modify: `docs/CHANGELOG-2026-09.md` (없으면 Create)

- [ ] **Step 1: CHANGELOG 항목 추가**

`docs/CHANGELOG-2026-09.md`에 섹션 추가(기존 §1~§3 뒤 §4):
```markdown
## §4 거래소 이벤트 방어 레이어 (Phase 1) — 2026-09-08

소폰(-86%) 마이그레이션 사례 대응. 업비트(주)·바이낸스(보조) 공식 공지 API로
상폐·유의지정·입출금중단·마이그레이션 이벤트를 감지 → 매수 점수 감점/제외 + 텔레그램 알림.

- `lib/exchange-events.mjs`: 분류(EVENT_RULES)·티커 매칭·`ensureEvents` 오케스트레이터·dedup 상태(`data/event-log.json`)
- `lib/binance.mjs`: `fetchBinanceAnnouncements`(bapi CMS, best-effort)
- `lib/buy-modifiers.mjs`: `eventRisk` 배수(상폐=0 제외 / 유의 ×0.5 / 입출금중단 ×0.7)
- 만료 TTL: 상폐 90일·유의 30일·입출금중단 14일(재개 공지 놓쳐도 무한감점 방지)
- 스캔 불사침: 공지 조회 실패 시 neutral, 스캔 무중단
- Phase 2(코인니스 등 크롤링 기반 공격 신호)는 별도 진행
```

- [ ] **Step 2: 커밋**

```bash
git add docs/CHANGELOG-2026-09.md
git commit -m "docs: 거래소 이벤트 방어 레이어 CHANGELOG (Phase1 Task5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 이벤트 분류 5종 + 심각도/배수 → Task 1 ✅
- 업비트+바이낸스 페처 → Task 2 ✅
- dedup/만료 상태(event-log.json) → Task 2 ✅
- 유니버스+보유 포지션 매칭 → Task 2 ✅ (테스트 포함)
- 점수 감점/제외 통합 → Task 3 ✅
- 텔레그램 알림 → Task 4 ✅
- 스캔 불사침 → 전 태스크 neutral/try-catch ✅, Task 4 Step7 실환경 검증
- 빗썸 제외·백필 없음·크롤링 Phase2 → 스펙 YAGNI, 플랜 미포함 ✅

**2. Placeholder scan:** 바이낸스 catalogId는 Task2 Step1의 구체적 조사 절차로 확정(막연한 TODO 아님). 그 외 모든 스텝에 실제 코드 포함.

**3. Type consistency:**
- `ensureEvents` 반환 `byMarket[m] = { mult, label, events }` — Task3 ctx.eventRisk가 `{ mult, label }`로 소비(events 필드는 monitor가 item.event에 사용) ✅
- `classifyAnnouncement` 반환 `{ type, severity, mult, ttlDays }` — ensureEvents가 ttlDays로 expiresAt 계산 ✅
- `newEvents[]` 형태 `{ srcId, exchange, type, title, ts, markets }` — notifyEventAlerts가 `markets`,`type`,`exchange`,`title` 소비 ✅
- `eventRiskMult` 반환 `{ mult, label }` — byMarket 스프레드로 병합 ✅
