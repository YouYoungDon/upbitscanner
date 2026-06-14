# 스캔 기록(아카이브) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매 스캔을 append-only 아카이브에 영구 누적하고, 날짜별·종목별로 훑어보는 "스캔기록" 탭을 추가한다.

**Architecture:** `lib/archive.mjs`가 jsonl append/read와 순수 집계(summarize/coinHistory)를 담당한다. `monitor.mjs`가 스캔마다 append하고, `seed-archive.mjs`가 기존 monitor-log를 1회 이관한다. 서버가 mtime 캐시로 아카이브를 읽어 `/api/scans|scan-detail|coin-history`로 제공하고, 프론트에 `📜 스캔기록` 탭을 추가한다.

**Tech Stack:** zero-dep Node ESM, Vitest, DaisyUI(이미 적용된 프론트), jsonl.

---

## Task 1: 아카이브 모듈 (lib/archive.mjs)

**Files:**
- Create: `lib/archive.mjs`
- Test: `__tests__/archive.test.mjs`

IO(append/read) + 순수 집계(summarizeScans/coinHistory)를 한 모듈에 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

`__tests__/archive.test.mjs`:
```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync, writeFileSync } from 'node:fs'
import { appendScan, readArchive, summarizeScans, coinHistory } from '../lib/archive.mjs'

let file
beforeEach(() => { file = join(tmpdir(), `arch-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`) })
afterEach(() => { if (existsSync(file)) rmSync(file) })

describe('appendScan/readArchive', () => {
  it('append한 스캔을 순서대로 읽음', () => {
    appendScan({ timestamp: 't1', buy: [], sell: [] }, file)
    appendScan({ timestamp: 't2', buy: [{ market: 'KRW-A' }], sell: [] }, file)
    const r = readArchive(file)
    expect(r).toHaveLength(2)
    expect(r[0].timestamp).toBe('t1')
    expect(r[1].buy[0].market).toBe('KRW-A')
  })
  it('파일 없으면 빈 배열', () => {
    expect(readArchive(file)).toEqual([])
  })
  it('깨진 줄은 건너뜀', () => {
    writeFileSync(file, '{"timestamp":"t1","buy":[],"sell":[]}\n깨진줄\n{"timestamp":"t2","buy":[],"sell":[]}\n')
    const r = readArchive(file)
    expect(r.map((s) => s.timestamp)).toEqual(['t1', 't2'])
  })
})

describe('summarizeScans', () => {
  it('스캔별 매수/매도 수 + 상위 매수 종목명', () => {
    const scans = [{
      timestamp: 't1',
      buy: [
        { korean_name: '에이', score: 5 },
        { korean_name: '비', score: 9 },
        { korean_name: '씨', score: 7 },
        { korean_name: '디', score: 1 },
      ],
      sell: [{ korean_name: '이' }],
    }]
    const r = summarizeScans(scans)
    expect(r[0]).toEqual({ timestamp: 't1', buyCount: 4, sellCount: 1, topBuy: ['비', '씨', '에이'] })
  })
})

describe('coinHistory', () => {
  it('해당 마켓이 등장한 스캔만 시간순으로', () => {
    const scans = [
      { timestamp: 't1', buy: [{ market: 'KRW-A', score: 6, signals: ['x'] }], sell: [] },
      { timestamp: 't2', buy: [], sell: [{ market: 'KRW-A', score: 4, signals: ['y'] }] },
      { timestamp: 't3', buy: [{ market: 'KRW-B', score: 5, signals: [] }], sell: [] },
    ]
    const r = coinHistory(scans, 'KRW-A')
    expect(r).toEqual([
      { timestamp: 't1', side: 'buy', score: 6, signals: ['x'] },
      { timestamp: 't2', side: 'sell', score: 4, signals: ['y'] },
    ])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/archive.test.mjs`
Expected: FAIL — import 실패

- [ ] **Step 3: lib/archive.mjs 구현**

```javascript
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ARCHIVE = join(ROOT, 'data', 'scan-archive.jsonl')

// 스캔 1건을 jsonl 한 줄로 append (디렉토리 없으면 생성)
export function appendScan(scan, file = ARCHIVE) {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(file, JSON.stringify(scan) + '\n', 'utf-8')
}

// 아카이브 전체를 스캔 배열로 (없으면 []). 깨진 줄은 건너뜀.
export function readArchive(file = ARCHIVE) {
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch { /* 깨진 줄 무시 */ }
  }
  return out
}

// 스캔별 요약 (입력 순서 유지). topBuy = score 내림차순 상위 3 종목명.
export function summarizeScans(scans) {
  return scans.map((s) => ({
    timestamp: s.timestamp,
    buyCount: (s.buy || []).length,
    sellCount: (s.sell || []).length,
    topBuy: [...(s.buy || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map((x) => x.korean_name),
  }))
}

// 특정 market 등장 이력 (시간순). 매수/매도 양쪽 검사.
export function coinHistory(scans, market) {
  const out = []
  for (const s of scans) {
    const b = (s.buy || []).find((x) => x.market === market)
    if (b) out.push({ timestamp: s.timestamp, side: 'buy', score: b.score, signals: b.signals })
    const se = (s.sell || []).find((x) => x.market === market)
    if (se) out.push({ timestamp: s.timestamp, side: 'sell', score: se.score, signals: se.signals })
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/archive.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/archive.mjs __tests__/archive.test.mjs
git commit -m "feat: add scan archive module (append/read/summarize/coinHistory)"
```

---

## Task 2: monitor.mjs append + 시드 스크립트 + .gitignore

**Files:**
- Modify: `scripts/monitor.mjs`
- Create: `scripts/seed-archive.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: monitor.mjs에서 스캔 후 아카이브 append**

`scripts/monitor.mjs` 상단 import에 추가:
```javascript
import { appendScan } from '../lib/archive.mjs'
```
`await writeJson('monitor-log.json', log)` 줄 **바로 아래**에 추가:
```javascript
  appendScan({ timestamp: log.scans.at(-1).timestamp, buy, sell })
```
(주의: `buy`/`sell`은 main() 내 이미 정렬된 결과 배열이고, timestamp는 방금 기록한 scan과 동일하게 맞춘다.)

- [ ] **Step 2: scripts/seed-archive.mjs 작성**

```javascript
// 기존 monitor-log.json의 스캔들을 아카이브에 1회 시드. 이미 아카이브가 있으면 건너뜀.
import { existsSync } from 'node:fs'
import { readJson } from '../lib/store.mjs'
import { appendScan, ARCHIVE } from '../lib/archive.mjs'

if (existsSync(ARCHIVE)) {
  console.log('아카이브가 이미 존재합니다. 시드 건너뜀:', ARCHIVE)
  process.exit(0)
}
const log = await readJson('monitor-log.json', { scans: [] })
const scans = [...(log.scans || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
for (const s of scans) appendScan({ timestamp: s.timestamp, buy: s.buy || [], sell: s.sell || [] })
console.log(`시드 완료 — ${scans.length}개 스캔을 아카이브에 기록`)
```

- [ ] **Step 3: .gitignore에 아카이브 추가**

`.gitignore` 끝에 추가:
```
data/scan-archive.jsonl
```

- [ ] **Step 4: 시드 실행 + 검증**

Run: `node scripts/seed-archive.mjs`
Expected: `시드 완료 — N개 스캔을 아카이브에 기록` (N = 현재 monitor-log scans 수)
Run: `node -e "import('./lib/archive.mjs').then(({readArchive})=>console.log('아카이브 스캔 수:', readArchive().length))"`
Expected: 위 N과 동일

- [ ] **Step 5: Commit**

```bash
git add scripts/monitor.mjs scripts/seed-archive.mjs .gitignore
git commit -m "feat: archive each scan + seed archive from monitor-log"
```

---

## Task 3: API 빌더 (server/api.mjs)

**Files:**
- Modify: `server/api.mjs`
- Test: `__tests__/api.test.mjs`

- [ ] **Step 1: 실패하는 테스트 추가 (`__tests__/api.test.mjs` 끝에 append)**

```javascript
import { buildScans, findScanByTimestamp } from '../server/api.mjs'

describe('buildScans', () => {
  const scans = [
    { timestamp: 't1', buy: [{ korean_name: '에이', score: 5 }], sell: [] },
    { timestamp: 't2', buy: [], sell: [{ korean_name: '비' }] },
    { timestamp: 't3', buy: [{ korean_name: '씨', score: 7 }], sell: [] },
  ]
  it('최신순 요약 + total + limit/offset', () => {
    const r = buildScans(scans, { limit: 2, offset: 0 })
    expect(r.total).toBe(3)
    expect(r.items.map((i) => i.timestamp)).toEqual(['t3', 't2'])
  })
  it('offset 적용', () => {
    const r = buildScans(scans, { limit: 2, offset: 2 })
    expect(r.items.map((i) => i.timestamp)).toEqual(['t1'])
  })
})

describe('findScanByTimestamp', () => {
  it('timestamp로 스캔 찾기', () => {
    const scans = [{ timestamp: 't1', buy: [], sell: [] }, { timestamp: 't2', buy: [{ market: 'KRW-A' }], sell: [] }]
    expect(findScanByTimestamp(scans, 't2').buy[0].market).toBe('KRW-A')
    expect(findScanByTimestamp(scans, 'nope')).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: FAIL — export 없음

- [ ] **Step 3: server/api.mjs에 추가**

상단 import에 추가:
```javascript
import { summarizeScans } from '../lib/archive.mjs'
```
함수 추가:
```javascript
// 아카이브 스캔(시간 오름차순)을 최신순 요약으로, limit/offset 적용
export function buildScans(scans, { limit = 20, offset = 0 } = {}) {
  const summaries = summarizeScans(scans).slice().reverse() // 최신순
  return { total: summaries.length, items: summaries.slice(offset, offset + limit) }
}

export function findScanByTimestamp(scans, ts) {
  return scans.find((s) => s.timestamp === ts) || null
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: PASS. 그 후 `npx vitest run` 회귀 확인.

- [ ] **Step 5: Commit**

```bash
git add server/api.mjs __tests__/api.test.mjs
git commit -m "feat: add buildScans/findScanByTimestamp API builders"
```

---

## Task 4: 서버 라우트 + mtime 캐시 (server/server.mjs)

**Files:**
- Modify: `server/server.mjs`

- [ ] **Step 1: import + 아카이브 캐시 + 라우트 추가**

`server/server.mjs` 상단 import 구역에 추가:
```javascript
import { statSync } from 'node:fs'
import { readArchive, coinHistory, ARCHIVE } from '../lib/archive.mjs'
import { buildScans, findScanByTimestamp } from './api.mjs'
```
(이미 `buildResults` 등 api.mjs import가 있으면 `buildScans, findScanByTimestamp`만 그 import에 합쳐도 됨.)

`cachedMarkets` 함수 정의 아래에 아카이브 캐시 추가:
```javascript
// 아카이브 mtime 캐시 — 파일 안 바뀌면 재파싱 안 함
let archiveCache = { mtimeMs: 0, data: [] }
function cachedArchive() {
  let mtimeMs = 0
  try { mtimeMs = statSync(ARCHIVE).mtimeMs } catch { return [] }
  if (mtimeMs !== archiveCache.mtimeMs) archiveCache = { mtimeMs, data: readArchive() }
  return archiveCache.data
}
```

`/api/history` 라우트 블록 **아래**에 3개 라우트 추가:
```javascript
    if (p === '/api/scans') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100)
      const offset = Number(url.searchParams.get('offset')) || 0
      return sendJson(res, 200, buildScans(cachedArchive(), { limit, offset }))
    }
    if (p === '/api/scan-detail') {
      const ts = url.searchParams.get('timestamp')
      const scan = findScanByTimestamp(cachedArchive(), ts)
      return scan ? sendJson(res, 200, scan) : sendJson(res, 404, { error: 'not found' })
    }
    if (p === '/api/coin-history') {
      const market = url.searchParams.get('market')
      if (!market || !/^KRW-[A-Z0-9]+$/.test(market)) return sendJson(res, 400, { error: 'invalid market' })
      return sendJson(res, 200, coinHistory(cachedArchive(), market))
    }
```

- [ ] **Step 2: 서버 기동 + 스모크 테스트**

서버 백그라운드 실행(run_in_background): `node server/server.mjs`. 2초 대기 후:
```bash
curl -s "http://127.0.0.1:8787/api/scans?limit=3" | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log('total',d.total,'items',d.items.length,'최신',d.items[0]&&d.items[0].timestamp)"
curl -s "http://127.0.0.1:8787/api/scan-detail?timestamp=$(curl -s 'http://127.0.0.1:8787/api/scans?limit=1' | node -e "const d=JSON.parse(require('fs').readFileSync(0));process.stdout.write(d.items[0].timestamp)")" | head -c 80
curl -s "http://127.0.0.1:8787/api/coin-history?market=KRW-BTC" | head -c 120
```
Expected: scans는 total/items, scan-detail은 buy/sell 포함 JSON, coin-history는 배열(빈 배열일 수도). 서버 종료.

- [ ] **Step 3: Commit**

```bash
git add server/server.mjs
git commit -m "feat: add /api/scans, /api/scan-detail, /api/coin-history routes"
```

---

## Task 5: 사이드바 메뉴 추가 (index.html)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: 메뉴 항목 추가**

`public/index.html`의 `<ul class="menu ...">` 안, `신호검증` 항목 **아래**에 추가:
```html
        <li><a href="#/history" data-tab="history">📜 스캔기록</a></li>
```

- [ ] **Step 2: 서버 기동 확인**

서버 백그라운드 실행 후:
```bash
curl -s http://127.0.0.1:8787/ | grep -c 'data-tab="history"'
```
Expected: 1. 서버 종료.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add 스캔기록 sidebar menu item"
```

---

## Task 6: 스캔기록 탭 — 날짜별/종목별 (app.js)

**Files:**
- Modify: `public/app.js`

`routes` 객체에 `history` 라우트를 추가한다. 기존 `marketsList`(개별분석에서 쓰는 전체 마켓 캐시), `signalTags`, `fmt`, `esc`, `api`, `setActiveTab` 헬퍼를 재사용한다.

- [ ] **Step 1: `history` 라우트 추가**

`routes` 객체 안(예: `verify` 메서드 뒤)에 추가:
```javascript
  async history() {
    setActiveTab('history')
    view.innerHTML = `<h2 class="text-2xl font-bold mb-4">📜 스캔기록</h2>
      <div class="join mb-4">
        <button class="btn btn-sm join-item btn-active" id="hSegDate">날짜별</button>
        <button class="btn btn-sm join-item" id="hSegCoin">종목별</button>
      </div>
      <div id="hBody"></div>`
    const showDate = () => renderDateView()
    const showCoin = () => renderCoinView()
    $('#hSegDate').onclick = () => { $('#hSegDate').classList.add('btn-active'); $('#hSegCoin').classList.remove('btn-active'); showDate() }
    $('#hSegCoin').onclick = () => { $('#hSegCoin').classList.add('btn-active'); $('#hSegDate').classList.remove('btn-active'); showCoin() }
    showDate()
  },
```

- [ ] **Step 2: 날짜별/종목별 렌더 함수 추가 (파일 하단, 다른 헬퍼들 옆)**

`function topTable(...)` 근처(모듈 최상위)에 추가:
```javascript
let histOffset = 0
async function renderDateView() {
  histOffset = 0
  $('#hBody').innerHTML = '<span class="loading loading-spinner"></span>'
  const data = await api(`/api/scans?limit=20&offset=0`)
  if (!data.items || !data.items.length) { $('#hBody').innerHTML = '<p class="opacity-60">기록 없음</p>'; return }
  const rows = (items) => items.map((s) => `
    <tr class="hover cursor-pointer" onclick="window.__scanDetail('${esc(s.timestamp)}', this)">
      <td>${new Date(s.timestamp).toLocaleString('ko-KR')}</td>
      <td><span class="badge badge-success badge-sm">${s.buyCount}</span></td>
      <td><span class="badge badge-error badge-sm">${s.sellCount}</span></td>
      <td class="opacity-70 text-xs">${s.topBuy.map(esc).join(', ')}</td>
    </tr>
    <tr class="detail-row hidden"><td colspan="4" class="bg-base-300/40"></td></tr>`).join('')
  $('#hBody').innerHTML = `<div class="card bg-base-200 shadow"><div class="card-body p-3">
    <div class="overflow-x-auto"><table class="table table-zebra table-sm">
      <thead><tr><th>스캔 시각</th><th>매수</th><th>매도</th><th>상위 매수</th></tr></thead>
      <tbody id="hRows">${rows(data.items)}</tbody></table></div>
    <button id="hMore" class="btn btn-sm btn-ghost mt-2 ${data.total <= 20 ? 'hidden' : ''}">더 보기 (${data.total}건 중 ${data.items.length})</button>
  </div></div>`
  $('#hMore').onclick = async () => {
    histOffset += 20
    const more = await api(`/api/scans?limit=20&offset=${histOffset}`)
    $('#hRows').insertAdjacentHTML('beforeend', rows(more.items))
    const shown = Math.min(histOffset + 20, more.total)
    const btn = $('#hMore'); btn.textContent = `더 보기 (${more.total}건 중 ${shown})`
    if (shown >= more.total) btn.classList.add('hidden')
  }
}

// 행 클릭 시 그 스캔의 매수/매도 전체 펼치기 (전역 핸들러)
window.__scanDetail = async (ts, rowEl) => {
  const detailRow = rowEl.nextElementSibling
  const cell = detailRow.firstElementChild
  if (!detailRow.classList.contains('hidden')) { detailRow.classList.add('hidden'); return }
  detailRow.classList.remove('hidden')
  cell.innerHTML = '<span class="loading loading-spinner loading-sm"></span>'
  const scan = await api(`/api/scan-detail?timestamp=${encodeURIComponent(ts)}`)
  if (scan.error) { cell.innerHTML = '<span class="opacity-60">상세 조회 실패</span>'; return }
  cell.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-3 p-2">
    <div><div class="text-sm font-semibold mb-1">🟢 매수 ${scan.buy.length}</div>${topTable(scan.buy, 999)}</div>
    <div><div class="text-sm font-semibold mb-1">🔴 매도 ${scan.sell.length}</div>${topTable(scan.sell, 999)}</div>
  </div>`
}

async function renderCoinView() {
  $('#hBody').innerHTML = `<div class="flex gap-2 mb-3">
      <input id="hCoin" class="input input-bordered input-sm flex-1 min-w-52" placeholder="🔎 비트코인 또는 KRW-BTC">
    </div><div id="hCoinResult"></div>`
  if (!marketsList) { try { marketsList = await api('/api/markets') } catch { marketsList = [] } }
  const nameOf = Object.fromEntries((marketsList || []).map((m) => [m.market, m.korean_name]))
  const resolve = (q) => {
    const up = q.trim().toUpperCase()
    if (/^KRW-[A-Z0-9]+$/.test(up)) return up
    const hit = (marketsList || []).find((m) => m.korean_name === q.trim() || m.korean_name.includes(q.trim()))
    return hit ? hit.market : null
  }
  const run = async () => {
    const market = resolve($('#hCoin').value)
    if (!market) { $('#hCoinResult').innerHTML = '<p class="opacity-60">종목을 찾을 수 없습니다</p>'; return }
    $('#hCoinResult').innerHTML = '<span class="loading loading-spinner"></span>'
    const hist = await api(`/api/coin-history?market=${encodeURIComponent(market)}`)
    if (hist.error || !hist.length) { $('#hCoinResult').innerHTML = `<p class="opacity-60">${esc(nameOf[market] || market)} 등장 기록 없음</p>`; return }
    $('#hCoinResult').innerHTML = `<div class="card bg-base-200 shadow"><div class="card-body p-3">
      <h3 class="card-title text-sm">${esc(nameOf[market] || '')} <span class="opacity-50 text-xs">${esc(market)}</span> · ${hist.length}회</h3>
      <div class="overflow-x-auto"><table class="table table-zebra table-sm">
        <thead><tr><th>시각</th><th>구분</th><th>점수</th><th>신호</th></tr></thead>
        <tbody>${hist.slice().reverse().map((h) => `<tr>
          <td>${new Date(h.timestamp).toLocaleString('ko-KR')}</td>
          <td>${h.side === 'buy' ? '<span class="badge badge-success badge-sm">매수</span>' : '<span class="badge badge-error badge-sm">매도</span>'}</td>
          <td>${h.score ?? '-'}</td><td>${signalTags(h.signals)}</td>
        </tr>`).join('')}</tbody></table></div>
    </div></div>`
  }
  $('#hCoin').oninput = run
  $('#hCoin').onkeydown = (e) => { if (e.key === 'Enter') run() }
}
```

- [ ] **Step 3: 문법 확인**

Run: `node --check public/app.js`
Expected: exit 0

- [ ] **Step 4: 서버 기동 + 브라우저 확인**

서버 백그라운드 실행 → `curl -s http://127.0.0.1:8787/app.js | grep -c "async history"` ≥ 1.
브라우저 `http://127.0.0.1:8787` → 📜 스캔기록 탭: 날짜별 목록·행 펼침, 종목별 검색 동작 확인. 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: add scan history tab (date view + coin view)"
```

---

## Task 7: 전체 검증 + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run`
Expected: 모든 테스트 PASS (기존 53 + archive + api 신규)

- [ ] **Step 2: README 대시보드 탭 목록에 추가**

`## 대시보드` 섹션 탭 목록 끝에 추가:
```markdown
- **스캔기록 탭**: 매 스캔을 영구 아카이브(`data/scan-archive.jsonl`)에 누적. 날짜별 드릴다운 + 종목별 등장 이력.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: note scan history tab"
```

---

## 완료 기준

- [ ] `npx vitest run` 전체 통과 (archive/api 신규 포함)
- [ ] `node scripts/seed-archive.mjs`로 기존 스캔 시드됨
- [ ] `/api/scans`·`/api/scan-detail`·`/api/coin-history` 동작
- [ ] 사이드바 📜 스캔기록 탭: 날짜별 목록+펼침, 종목별 타임라인
- [ ] monitor.mjs가 새 스캔을 아카이브에 append
- [ ] README 갱신
