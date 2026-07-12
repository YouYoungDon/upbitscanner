# 포지션 직접 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 UI에서 보유 포지션을 직접 추가·수정·삭제할 수 있게 만든다.

**Architecture:** `lib/positions.mjs`에 순수 함수(validate/upsert/delete)와 얇은 쓰기 래퍼를 추가하고, `server/server.mjs`에 `POST`/`DELETE /api/positions`와 `GET /api/ticker` 라우트를 붙인다. 프론트(`public/app.js`)는 종합 페이지 포지션 카드에 추가/편집/삭제 UI와 모달 폼을 얹고, 개별분석 탭의 코인 검색 패턴을 재활용한다.

**Tech Stack:** Node.js ESM(.mjs), 내장 http 서버, vitest, 바닐라 JS SPA, daisyUI 4.12 modal, Tailwind Play CDN.

## Global Constraints

- 데이터 모델 고정: `{ market, korean_name, entry, stopLoss, takeProfit }` — 수량/투자금 없음.
- `market` 형식: `^KRW-[A-Z0-9]+$` (고유 키).
- `entry` 필수·양수. `stopLoss`/`takeProfit`는 선택이며 둘 다 있으면 `takeProfit > stopLoss`.
- 원자적 저장은 기존 `store.writeJson('positions.json', list)` 재사용 — 새 원자 로직 금지.
- XSS 방지: 클라이언트는 기존 `esc()` 사용, 서버는 화이트리스트 검증.
- 테스트 러너: `npx vitest run <경로>` (Windows PowerShell/Bash 공통). 파일은 UTF-8(BOM 없음).
- 커밋 메시지 말미에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 새 API 라우트 추가 후 대시보드 서버 재시작 필요.

---

### Task 1: 순수 함수 — validatePosition / upsertPosition / deletePosition

**Files:**
- Modify: `lib/positions.mjs` (파일 끝에 함수 추가; 기존 `readPositions`/`evalPositions`/`POSITIONS` 유지)
- Test: `__tests__/positions.test.mjs` (기존 파일에 describe 블록 추가)

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `validatePosition(input, { markets = [] } = {})` → `{ ok: true, position }` 또는 `{ ok: false, error }`. `position`은 `{ market, korean_name, entry, stopLoss, takeProfit }` 화이트리스트. `stopLoss`/`takeProfit` 미지정 시 해당 키를 `null`로 정규화. `markets`는 `[{ market, korean_name }]` 배열.
  - `upsertPosition(list, position)` → 새 배열 (`market` 기준 교체 또는 추가)
  - `deletePosition(list, market)` → 새 배열 (해당 market 제거)

- [ ] **Step 1: Write the failing tests**

`__tests__/positions.test.mjs` 상단 import에 함수 추가하고 파일 끝에 아래 describe 블록들을 추가한다.

```javascript
// 상단 import 교체
import { evalPositions, validatePosition, upsertPosition, deletePosition } from '../lib/positions.mjs'
```

```javascript
describe('validatePosition', () => {
  const markets = [{ market: 'KRW-SOPH', korean_name: '소폰' }]
  it('정상 입력 정규화 + korean_name 마켓목록 보충', () => {
    const r = validatePosition({ market: 'KRW-SOPH', entry: '60', stopLoss: '55.2', takeProfit: '78' }, { markets })
    expect(r.ok).toBe(true)
    expect(r.position).toEqual({ market: 'KRW-SOPH', korean_name: '소폰', entry: 60, stopLoss: 55.2, takeProfit: 78 })
  })
  it('여분 필드 제거', () => {
    const r = validatePosition({ market: 'KRW-SOPH', entry: 60, hacked: 'x', price: 999 }, { markets })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.position).sort()).toEqual(['entry', 'korean_name', 'market', 'stopLoss', 'takeProfit'])
    expect(r.position.stopLoss).toBe(null)
    expect(r.position.takeProfit).toBe(null)
  })
  it('market 형식 오류 거부', () => {
    expect(validatePosition({ market: 'BTC', entry: 60 }).ok).toBe(false)
    expect(validatePosition({ market: 'krw-soph', entry: 60 }).ok).toBe(false)
  })
  it('entry 누락/음수/0 거부', () => {
    expect(validatePosition({ market: 'KRW-SOPH' }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: -1 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 0 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 'abc' }).ok).toBe(false)
  })
  it('TP<=SL 거부, 한쪽만 있으면 허용', () => {
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: 78, takeProfit: 55 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: 78, takeProfit: 78 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: 55 }).ok).toBe(true)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, takeProfit: 78 }).ok).toBe(true)
  })
  it('SL/TP 음수 거부', () => {
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: -5 }).ok).toBe(false)
  })
  it('korean_name 마켓목록에 없으면 market 사용', () => {
    const r = validatePosition({ market: 'KRW-XYZ', entry: 10 }, { markets })
    expect(r.position.korean_name).toBe('KRW-XYZ')
  })
})

describe('upsertPosition', () => {
  const base = [{ market: 'KRW-A', korean_name: '에이', entry: 100, stopLoss: null, takeProfit: null }]
  it('신규 추가', () => {
    const r = upsertPosition(base, { market: 'KRW-B', korean_name: '비', entry: 200, stopLoss: null, takeProfit: null })
    expect(r.length).toBe(2)
  })
  it('같은 market 교체 — 중복 없음', () => {
    const r = upsertPosition(base, { market: 'KRW-A', korean_name: '에이', entry: 150, stopLoss: null, takeProfit: null })
    expect(r.length).toBe(1)
    expect(r[0].entry).toBe(150)
  })
  it('원본 불변', () => {
    upsertPosition(base, { market: 'KRW-A', korean_name: '에이', entry: 150, stopLoss: null, takeProfit: null })
    expect(base[0].entry).toBe(100)
  })
})

describe('deletePosition', () => {
  const base = [{ market: 'KRW-A', entry: 100 }, { market: 'KRW-B', entry: 200 }]
  it('제거', () => {
    const r = deletePosition(base, 'KRW-A')
    expect(r.map((p) => p.market)).toEqual(['KRW-B'])
  })
  it('없는 market 무변화', () => {
    expect(deletePosition(base, 'KRW-Z').length).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/positions.test.mjs`
Expected: FAIL — `validatePosition is not a function` (또는 import 에러)

- [ ] **Step 3: Implement the functions**

`lib/positions.mjs` 파일 끝(마지막 `}` 뒤)에 추가한다.

```javascript
const MARKET_RE = /^KRW-[A-Z0-9]+$/

// 숫자로 강제. 유한한 양수만 통과, 그 외 null.
function posNum(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

// 입력을 검증·정규화. { ok, position } | { ok:false, error }
export function validatePosition(input = {}, { markets = [] } = {}) {
  const market = String(input.market || '')
  if (!MARKET_RE.test(market)) return { ok: false, error: '잘못된 마켓 형식' }
  const entry = posNum(input.entry)
  if (entry == null || Number.isNaN(entry)) return { ok: false, error: '진입가는 양수여야 합니다' }
  const stopLoss = posNum(input.stopLoss)
  const takeProfit = posNum(input.takeProfit)
  if (Number.isNaN(stopLoss)) return { ok: false, error: '손절가는 양수여야 합니다' }
  if (Number.isNaN(takeProfit)) return { ok: false, error: '목표가는 양수여야 합니다' }
  if (stopLoss != null && takeProfit != null && takeProfit <= stopLoss) {
    return { ok: false, error: '목표가는 손절가보다 커야 합니다' }
  }
  const korean_name = String(input.korean_name || '') ||
    (markets.find((m) => m.market === market)?.korean_name) || market
  return { ok: true, position: { market, korean_name, entry, stopLoss, takeProfit } }
}

// market 기준 교체 또는 추가. 새 배열 반환.
export function upsertPosition(list = [], position) {
  const rest = list.filter((p) => p.market !== position.market)
  return [...rest, position]
}

// 해당 market 제거. 새 배열 반환.
export function deletePosition(list = [], market) {
  return list.filter((p) => p.market !== market)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/positions.test.mjs`
Expected: PASS (기존 evalPositions 4개 + 신규 케이스 모두 통과)

- [ ] **Step 5: Commit**

```bash
git add lib/positions.mjs __tests__/positions.test.mjs
git commit -m "$(cat <<'EOF'
feat(positions): add validate/upsert/delete pure functions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: writePositions 쓰기 래퍼

**Files:**
- Modify: `lib/positions.mjs` (import 추가 + 함수 추가)

**Interfaces:**
- Consumes: `store.writeJson` from `lib/store.mjs`
- Produces: `writePositions(list)` → `Promise<void>`. `data/positions.json`에 원자적으로 저장.

- [ ] **Step 1: Add import at top of lib/positions.mjs**

기존 import 구문들 아래에 추가한다.

```javascript
import { writeJson } from './store.mjs'
```

- [ ] **Step 2: Add writePositions near the other exports**

`validatePosition` 정의 앞이나 `deletePosition` 뒤, 아무 export 옆에 추가한다.

```javascript
// 원자적 저장 (store.writeJson = temp+rename). data/positions.json.
export async function writePositions(list) {
  await writeJson('positions.json', Array.isArray(list) ? list : [])
}
```

- [ ] **Step 3: Verify module loads (no test — thin wrapper)**

Run: `node -e "import('./lib/positions.mjs').then(m => console.log(typeof m.writePositions))"`
Expected: `function`

- [ ] **Step 4: Commit**

```bash
git add lib/positions.mjs
git commit -m "$(cat <<'EOF'
feat(positions): add writePositions atomic wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 서버 라우트 — POST/DELETE /api/positions, GET /api/ticker

**Files:**
- Modify: `server/server.mjs` (import 확장, `readBody` 헬퍼 추가, 라우트 3개 추가)
- Test: `__tests__/routes.test.mjs` (기존 파일 — 존재 시 라우트 스모크 추가; 없으면 이 Task의 테스트 스텝은 수동 curl 검증으로 대체)

**Interfaces:**
- Consumes: `validatePosition`, `upsertPosition`, `deletePosition`, `writePositions`, `readPositions` from `lib/positions.mjs`; `getTicker` from `lib/upbit.mjs`; `cachedMarkets()` (server 내부).
- Produces: HTTP 라우트
  - `POST /api/positions` body `{market, korean_name?, entry, stopLoss?, takeProfit?}` → 200 `{ ok: true, positions }` | 400 `{ error }` | 500 `{ error }`
  - `DELETE /api/positions?market=KRW-X` → 200 `{ ok: true, positions }` | 400 `{ error }`
  - `GET /api/ticker?market=KRW-X` → 200 `{ market, price }` (실패 시 `price: null`) | 400 `{ error }`

- [ ] **Step 1: Extend the positions import**

`server/server.mjs`의 기존 라인
```javascript
import { readPositions, evalPositions } from '../lib/positions.mjs'
```
을 아래로 교체한다.
```javascript
import { readPositions, evalPositions, validatePosition, upsertPosition, deletePosition, writePositions } from '../lib/positions.mjs'
```

- [ ] **Step 2: Add readBody helper**

`sendJson` 함수 정의 바로 아래에 추가한다.

```javascript
// 요청 본문을 상한(16KB)까지 읽어 JSON 파싱. 초과/깨진 JSON은 예외.
function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) { reject(new Error('본문이 너무 큽니다')); req.destroy() }
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try { resolve(JSON.parse(data)) } catch { reject(new Error('잘못된 JSON')) }
    })
    req.on('error', reject)
  })
}
```

- [ ] **Step 3: Add the three routes**

기존 `if (p === '/api/positions') { ... }` 블록 **바로 다음**에 아래 3블록을 추가한다. (GET 블록은 그대로 두고, 메서드로 분기)

```javascript
    if (p === '/api/positions' && req.method === 'POST') {
      let body
      try { body = await readBody(req) } catch (e) { return sendJson(res, 400, { error: String(e.message || e) }) }
      const markets = await cachedMarkets()
      const v = validatePosition(body, { markets })
      if (!v.ok) return sendJson(res, 400, { error: v.error })
      const next = upsertPosition(readPositions(), v.position)
      await writePositions(next)
      return sendJson(res, 200, { ok: true, positions: next })
    }
    if (p === '/api/positions' && req.method === 'DELETE') {
      const market = url.searchParams.get('market') || ''
      if (!/^KRW-[A-Z0-9]+$/.test(market)) return sendJson(res, 400, { error: '잘못된 마켓' })
      const next = deletePosition(readPositions(), market)
      await writePositions(next)
      return sendJson(res, 200, { ok: true, positions: next })
    }
    if (p === '/api/ticker') {
      const market = url.searchParams.get('market') || ''
      if (!/^KRW-[A-Z0-9]+$/.test(market)) return sendJson(res, 400, { error: '잘못된 마켓' })
      const t = await getTicker([market]) || []
      return sendJson(res, 200, { market, price: t[0]?.trade_price ?? null })
    }
```

- [ ] **Step 4: Manual verification (server restart required)**

기존 대시보드 서버를 재시작한 뒤:

```bash
# 추가
curl -s -X POST http://127.0.0.1:8787/api/positions -H "Content-Type: application/json" -d '{"market":"KRW-BTC","entry":100000000}'
# → {"ok":true,"positions":[...KRW-BTC...]}

# 잘못된 입력
curl -s -X POST http://127.0.0.1:8787/api/positions -H "Content-Type: application/json" -d '{"market":"BTC","entry":1}'
# → {"error":"잘못된 마켓 형식"}

# 현재가
curl -s "http://127.0.0.1:8787/api/ticker?market=KRW-BTC"
# → {"market":"KRW-BTC","price":<숫자>}

# 삭제
curl -s -X DELETE "http://127.0.0.1:8787/api/positions?market=KRW-BTC"
# → {"ok":true,"positions":[...KRW-BTC 없음...]}
```

Expected: 위 주석의 응답 형태. 삭제 후 `data/positions.json`에서 KRW-BTC가 사라진다(원래 있던 실제 포지션은 건드리지 않도록 테스트용 KRW-BTC만 넣었다 뺀다).

- [ ] **Step 5: Commit**

```bash
git add server/server.mjs
git commit -m "$(cat <<'EOF'
feat(server): add POST/DELETE /api/positions and GET /api/ticker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 프론트 — 포지션 카드 항상 표시 + 추가/편집/삭제 버튼

**Files:**
- Modify: `public/app.js` (`routes.home` 내 `posBar` 블록 + 카드 마크업)
- Modify: `public/styles.css` (`.pos-actions` 등 최소 스타일)

**Interfaces:**
- Consumes: 기존 `positions`(evalPositions 결과), `esc`, `fmt`, `clampPct`
- Produces: 포지션 카드 헤더의 `#posAddBtn`, 각 카드의 `.pos-edit`/`.pos-del` 버튼(`data-market`, `data-payload`). 모달 열기 함수 `openPosModal(mode, position?)`는 Task 5에서 정의 — 이 Task에서는 버튼만 배치하고 `window.openPosModal`를 호출하도록 연결(Task 5 완료 전까지 클릭 시 no-op이어도 무방).

- [ ] **Step 1: Replace the posBar block**

`public/app.js`의 `const posBar = !positions.length ? '' : \`...\`` 전체를 아래로 교체한다. (헤더에 추가 버튼, 빈 상태 처리, 각 카드에 편집/삭제 버튼)

```javascript
    const posCardInner = (p) => {
      const up = p.plPct != null && p.plPct >= 0
      const plBig = p.plPct == null ? '' : `<span class="pos-pl ${up ? 'up' : 'down'}">${up ? '+' : ''}${p.plPct}%</span>`
      const st = p.hitSL ? '<span class="badge badge-error badge-sm">SL 도달</span>' : p.hitTP ? '<span class="badge badge-success badge-sm">TP 도달</span>' : '<span class="badge badge-ghost badge-sm">보유</span>'
      let gauge
      if (p.stopLoss != null && p.takeProfit != null && p.takeProfit > p.stopLoss) {
        const span = p.takeProfit - p.stopLoss
        const curPos = clampPct(((p.price - p.stopLoss) / span) * 100)
        const entPos = clampPct(((p.entry - p.stopLoss) / span) * 100)
        gauge = `<div class="pos-gauge">
          <div class="pos-track"><div class="pos-entry" style="left:${entPos}%" title="진입 ${fmt(p.entry)}"></div><div class="pos-cur" style="left:${curPos}%" title="현재 ${fmt(p.price)}"></div></div>
          <div class="pos-scale"><span>SL ${fmt(p.stopLoss)}</span><span>진입 ${fmt(p.entry)}</span><span>TP ${fmt(p.takeProfit)}</span></div>
        </div>`
      } else {
        gauge = `<div class="text-xs opacity-70 mt-1">진입 ${fmt(p.entry)}${p.stopLoss != null ? ' · SL ' + fmt(p.stopLoss) : ''}${p.takeProfit != null ? ' · TP ' + fmt(p.takeProfit) : ''}</div>`
      }
      const toSL = p.hitSL || p.hitTP ? '' : `<span class="text-xs opacity-70">· SL까지 ${p.toSLPct == null ? '-' : p.toSLPct + '%'}</span>`
      const payload = esc(JSON.stringify({ market: p.market, korean_name: p.korean_name, entry: p.entry, stopLoss: p.stopLoss, takeProfit: p.takeProfit }))
      return `<div class="pos-card">
        <div class="pos-actions">
          <button class="pos-edit" data-payload="${payload}" title="편집">✏️</button>
          <button class="pos-del" data-market="${esc(p.market)}" data-name="${esc(p.korean_name || p.market)}" title="삭제">🗑</button>
        </div>
        <div class="pos-body cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(p.market)}'">
          <div class="flex items-center justify-between gap-2 pr-12"><span class="font-semibold">${esc(p.korean_name || p.market)}</span> ${st}</div>
          <div class="flex items-baseline flex-wrap gap-x-2 mt-0.5"><span class="text-lg font-bold">${fmt(p.price)}</span> ${plBig} ${toSL}</div>
          ${gauge}
        </div>
      </div>`
    }
    const posBar = `
      <div class="card mb-4"><div class="card-body p-4">
        <div class="flex items-center justify-between mb-1">
          <h3 class="card-title text-sm">💼 포지션</h3>
          <button id="posAddBtn" class="btn btn-primary btn-xs">＋ 추가</button>
        </div>
        ${positions.length
          ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">${positions.map(posCardInner).join('')}</div>`
          : '<p class="opacity-60 text-xs">등록된 포지션이 없습니다. ＋추가로 등록하세요.</p>'}
      </div></div>`
```

- [ ] **Step 2: Wire up the buttons after view.innerHTML**

`routes.home`의 `$('#scanBtn').onclick = runScan` 라인 **아래**에 추가한다. (모달 함수는 Task 5에서 정의되며 `window.openPosModal`로 노출된다)

```javascript
    // 포지션 편집 버튼 연결
    const addBtn = $('#posAddBtn')
    if (addBtn) addBtn.onclick = () => window.openPosModal && window.openPosModal('add')
    view.querySelectorAll('.pos-edit').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); const pos = JSON.parse(b.dataset.payload); window.openPosModal && window.openPosModal('edit', pos) }
    })
    view.querySelectorAll('.pos-del').forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation()
        if (!confirm(`${b.dataset.name} 포지션을 삭제할까요?`)) return
        await api(`/api/positions?market=${encodeURIComponent(b.dataset.market)}`, { method: 'DELETE' })
        routes.home()
      }
    })
```

- [ ] **Step 3: Add CSS for actions**

`public/styles.css`의 `.pos-card` 규칙 근처(또는 `.pos-scale` 뒤)에 추가한다.

```css
.pos-card { position: relative; }
.pos-actions { position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.25rem; z-index: 2; }
.pos-actions button { background: hsl(232 30% 18% / 0.7); border: 1px solid hsl(220 40% 70% / 0.12); border-radius: 0.4rem; font-size: 0.72rem; line-height: 1; padding: 0.2rem 0.34rem; cursor: pointer; transition: border-color 0.15s, transform 0.15s; }
.pos-actions button:hover { border-color: hsl(var(--p) / 0.5); transform: translateY(-1px); }
```

- [ ] **Step 4: Syntax check + visual verify**

Run: `node --check public/app.js`
Expected: 종료코드 0 (출력 없음)

서버 재시작 후 브라우저(또는 헤드리스 스크린샷)로 종합 페이지를 열어 포지션 카드 우상단에 ✏️🗑, 헤더에 ＋추가 버튼이 보이는지 확인. 포지션이 0개여도 카드와 ＋추가 버튼이 보인다. 🗑 클릭 시 confirm 후 삭제·갱신 동작(모달은 아직 no-op).

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/styles.css
git commit -m "$(cat <<'EOF'
feat(dashboard): position card actions (add/edit/delete buttons)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 프론트 — 모달 폼 (코인 검색·현재가 힌트·저장)

**Files:**
- Modify: `public/app.js` (모달 함수 `openPosModal` 추가 + `window` 노출)
- Modify: `public/index.html` (모달 컨테이너 `<dialog>` 추가)

**Interfaces:**
- Consumes: `marketsList`(전역 캐시), `api`, `esc`, `fmt`, `routes`
- Produces: `window.openPosModal(mode, position?)` — `mode`는 `'add'|'edit'`. 저장 시 `POST /api/positions` 후 `routes.home()`.

- [ ] **Step 1: Add modal dialog to index.html**

`public/index.html`의 `</body>` 직전, `<script>` 태그들 **위**에 추가한다.

```html
  <dialog id="posModal" class="modal">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-3" id="posModalTitle">포지션 추가</h3>
      <div id="posCoinPick" class="mb-3">
        <input id="posSearch" class="input input-bordered input-sm w-full mb-2" placeholder="🔎 비트코인 또는 KRW-BTC">
        <div id="posCoinList" class="coinlist" style="max-height:180px"></div>
      </div>
      <div id="posCoinFixed" class="mb-3 hidden text-sm opacity-80"></div>
      <div id="posPriceHint" class="text-xs opacity-70 mb-2"></div>
      <div class="grid grid-cols-3 gap-2 mb-3">
        <label class="form-control"><span class="label-text text-xs">진입가</span><input id="posEntry" type="number" step="any" class="input input-bordered input-sm"></label>
        <label class="form-control"><span class="label-text text-xs">손절가</span><input id="posSL" type="number" step="any" class="input input-bordered input-sm"></label>
        <label class="form-control"><span class="label-text text-xs">목표가</span><input id="posTP" type="number" step="any" class="input input-bordered input-sm"></label>
      </div>
      <div id="posErr" class="text-error text-xs mb-2"></div>
      <div class="modal-action">
        <button id="posCancel" class="btn btn-sm btn-ghost">취소</button>
        <button id="posSave" class="btn btn-sm btn-primary">저장</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop"><button>close</button></form>
  </dialog>
```

- [ ] **Step 2: Add openPosModal in app.js**

`public/app.js` 파일 끝(마지막 `window.addEventListener('DOMContentLoaded', router)` 위쪽 아무 곳, 최상위 스코프)에 추가한다.

```javascript
// 포지션 추가/편집 모달. mode: 'add' | 'edit'
async function openPosModal(mode, position) {
  const dlg = document.getElementById('posModal')
  const $m = (id) => document.getElementById(id)
  let picked = mode === 'edit' ? position.market : null
  $m('posModalTitle').textContent = mode === 'edit' ? '포지션 편집' : '포지션 추가'
  $m('posErr').textContent = ''
  $m('posEntry').value = mode === 'edit' && position.entry != null ? position.entry : ''
  $m('posSL').value = mode === 'edit' && position.stopLoss != null ? position.stopLoss : ''
  $m('posTP').value = mode === 'edit' && position.takeProfit != null ? position.takeProfit : ''
  $m('posPriceHint').innerHTML = ''

  if (!marketsList) { try { marketsList = await api('/api/markets') } catch { marketsList = [] } }
  const nameOf = Object.fromEntries((marketsList || []).map((m) => [m.market, m.korean_name]))

  const showHint = async (market) => {
    $m('posPriceHint').innerHTML = '현재가 조회 중…'
    const t = await api(`/api/ticker?market=${encodeURIComponent(market)}`)
    if (t && t.price != null) {
      $m('posPriceHint').innerHTML = `현재가 <b>${fmt(t.price)}</b> <button id="posFill" class="btn btn-xs btn-ghost">진입가로</button>`
      $m('posFill').onclick = () => { $m('posEntry').value = t.price }
    } else { $m('posPriceHint').innerHTML = '' }
  }

  // 코인 선택 UI: add=검색 리스트, edit=고정 표시
  if (mode === 'edit') {
    $m('posCoinPick').classList.add('hidden')
    $m('posCoinFixed').classList.remove('hidden')
    $m('posCoinFixed').innerHTML = `종목 <b>${esc(position.korean_name || position.market)}</b> <span class="opacity-60">${esc(position.market)}</span>`
    showHint(position.market)
  } else {
    $m('posCoinPick').classList.remove('hidden')
    $m('posCoinFixed').classList.add('hidden')
    const search = $m('posSearch'); search.value = ''
    const renderList = (q = '') => {
      const qq = q.trim(), upq = qq.toUpperCase()
      const list = (marketsList || []).filter((m) => !qq || m.korean_name.includes(qq) || m.market.includes(upq) || m.market.replace('KRW-', '').includes(upq)).slice(0, 60)
      $m('posCoinList').innerHTML = list.map((m) => `<div class="coin-row${m.market === picked ? ' active' : ''}" data-market="${m.market}">${esc(m.korean_name)} <span class="opacity-60 text-xs">${esc(m.market.replace('KRW-', ''))}</span></div>`).join('') || '<span class="opacity-60 text-xs">결과 없음</span>'
      $m('posCoinList').querySelectorAll('.coin-row').forEach((row) => {
        row.onclick = () => { picked = row.dataset.market; renderList(search.value); showHint(picked) }
      })
    }
    search.oninput = () => renderList(search.value)
    renderList()
  }

  $m('posCancel').onclick = () => dlg.close()
  $m('posSave').onclick = async () => {
    $m('posErr').textContent = ''
    if (!picked) { $m('posErr').textContent = '코인을 선택하세요'; return }
    const entry = $m('posEntry').value, sl = $m('posSL').value, tp = $m('posTP').value
    if (!entry || Number(entry) <= 0) { $m('posErr').textContent = '진입가를 입력하세요'; return }
    if (sl && tp && Number(tp) <= Number(sl)) { $m('posErr').textContent = '목표가는 손절가보다 커야 합니다'; return }
    const body = { market: picked, korean_name: nameOf[picked] || '', entry, stopLoss: sl || null, takeProfit: tp || null }
    const r = await api('/api/positions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r && r.ok) { dlg.close(); routes.home() }
    else { $m('posErr').textContent = (r && r.error) || '저장 실패' }
  }
  dlg.showModal()
}
window.openPosModal = openPosModal
```

- [ ] **Step 3: Syntax check**

Run: `node --check public/app.js`
Expected: 종료코드 0

- [ ] **Step 4: Manual/visual verification (server restart)**

서버 재시작 후 종합 페이지에서:
1. ＋추가 → 모달 열림 → 코인 검색해 선택 → 현재가 힌트 표시 → "진입가로" 클릭 시 진입가 채워짐 → SL/TP 입력 → 저장 → 카드에 새 포지션 표시.
2. 잘못된 입력(TP≤SL) → 모달에 에러 문구, 닫히지 않음.
3. ✏️편집 → 코인 고정 표시 + 기존값 프리필 → 값 수정 저장 → 갱신.
4. 백드롭 클릭/취소 → 닫힘.

(스크린샷 검증 권장: Edge 헤드리스로 모달 열린 상태 캡처)

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/index.html
git commit -m "$(cat <<'EOF'
feat(dashboard): position editor modal with coin search and price hint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 문서 — CHANGELOG 갱신

**Files:**
- Modify: `docs/CHANGELOG-2026-07.md`

- [ ] **Step 1: Add a changelog section**

`docs/CHANGELOG-2026-07.md`의 "## 4. 대시보드 — 일간/주간 추천" 섹션 뒤, "## 운영 메모" 앞에 추가한다.

```markdown
## 5. 대시보드 — 포지션 직접 편집 (2026-07-12)

보유 포지션을 대시보드에서 직접 추가/수정/삭제. 데이터 모델은 그대로(`{market, korean_name, entry, stopLoss, takeProfit}`).

- `lib/positions.mjs`: `validatePosition`(화이트리스트·TP>SL 검증)·`upsertPosition`·`deletePosition`(순수 함수) + `writePositions`(store.writeJson 원자적 래퍼).
- `POST /api/positions`(upsert)·`DELETE /api/positions?market=`·`GET /api/ticker?market=`(현재가 힌트) 라우트. 16KB 본문 상한, 서버측 화이트리스트 검증.
- 종합 페이지 포지션 카드에 ＋추가/✏️편집/🗑삭제 + 모달 폼(개별분석 코인검색 재활용, 현재가 "진입가로 채우기"). 포지션 0개여도 카드·추가 버튼 노출.
- 설계·계획: `docs/superpowers/specs|plans/2026-07-12-editable-positions*.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/CHANGELOG-2026-07.md
git commit -m "$(cat <<'EOF'
docs: changelog for editable positions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (작성자 체크)

**1. Spec coverage:**
- writePositions(원자적 재사용) → Task 2 ✓
- validatePosition/upsert/delete → Task 1 ✓
- POST/DELETE /api/positions, GET /api/ticker, readBody, 검증 → Task 3 ✓
- 카드 항상 표시 + 추가/편집/삭제 버튼 + stopPropagation → Task 4 ✓
- 모달 폼(코인 검색/고정, 현재가 힌트, 클라 1차검증) → Task 5 ✓
- 테스트(validate/upsert/delete) → Task 1 ✓
- 에러 처리(400/500, 모달 유지) → Task 3(서버)+Task 5(클라) ✓
- CHANGELOG → Task 6 ✓

**2. Placeholder scan:** 모든 스텝에 실제 코드/명령 포함, TBD/TODO 없음 ✓

**3. Type consistency:**
- `validatePosition(input, { markets })` 시그니처 Task 1 정의 = Task 3 호출 일치 ✓
- `writePositions(list)` Task 2 정의 = Task 3 사용 일치 ✓
- `window.openPosModal(mode, position?)` Task 5 정의 = Task 4 호출 일치 ✓
- position 필드 `{market, korean_name, entry, stopLoss, takeProfit}` 전 Task 일관 ✓
