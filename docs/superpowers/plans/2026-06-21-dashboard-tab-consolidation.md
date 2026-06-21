# 대시보드 탭 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 8개 대시보드 탭을 3개(🏠 종합 / 🔍 개별분석 / 📊 기록·검증)로 통합해 한눈에 보이게 한다.

**Architecture:** 프론트엔드만 변경. 라우트 별칭 순수함수(`public/routes.js`)는 TDD, 나머지 `public/app.js`/`index.html` 렌더 재구성은 기존 렌더 로직 재사용 + 구문체크/육안확인. 백엔드·lib 무변경.

**Tech Stack:** 바닐라 JS(브라우저), Tailwind+DaisyUI CDN, Vitest(routes.js만).

---

## 배경 지식

- **모든 bash 명령에 `cd /c/Users/toodo/workspace/upbit-dashboard &&` 프리픽스 필요.** 테스트: `npx vitest run <path>`, 전체 `npm test`. 구문: `node -c public/app.js`.
- `public/app.js`는 **classic script**(`<script src="/app.js">`). 최상단 헬퍼: `view`(=#view 엘리먼트), `$(sel,el)`, `fmt(n)`, `esc(s)`, `api(path)`(실패 시 `{error}` 반환, throw 안 함), `setActiveTab(tab)`(`.menu a`의 `data-tab` 토글), `signalTags(signals)`, `topTable(list,n)`(종목/점수/현재가/신호 테이블, n개 슬라이스). 전역 `Charts.sparkline(arr,color)`.
- 라우터(현재 app.js 끝): `router()` = `hash.slice(2).split('?')[0]` → `routes[name] || routes.dashboard`. `routes.dashboard()`는 runScan 완료 콜백에서도 호출됨(약 478행).
- 기존 라우트 메서드: dashboard/momentum/flow/positions/recommend/analyze/verify/history. `renderDateView`/`renderCoinView`/`window.__scanDetail`은 routes 객체 밖 모듈 레벨 함수(history가 사용) — **그대로 둠**.
- API 응답 형태:
  - `/api/results` → `{ empty, timestamp, kpi:{buyCount,sellCount,totalScans}, buy, buyLowLiq, sell, comboDist, candleSummary, regime:{label,emoji,trend,ratio} }`
  - `/api/momentum` → `{ timestamp, kpi:{count}, picks:[{market,korean_name,price,score,signals}] }`
  - `/api/flow` → `{ timestamp, kpi:{strong,attention,watch}, btc:{ret,favorable,bad}, picks:[{market,korean_name,price,score,level,ratio,accel,value5m,ch1m,ch5m,ch30m,ch24h,breakout,consol,emaOK,rsi}] }`
  - `/api/positions` → `{ positions:[{market,korean_name,entry,price,plPct,stopLoss,takeProfit,hitSL,hitTP,toSLPct}] }`
  - `/api/insights` → `{ topSignal:{key}, bestHitRate:{key,hitRate} }`, `/api/history` → `[{timestamp,buyCount,sellCount}]`

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|----------|
| `public/routes.js` | `resolveRoute(name)` 별칭 매핑 (ESM, window 노출) | 신규 |
| `__tests__/routes.test.mjs` | resolveRoute 검증 | 신규 |
| `public/index.html` | 사이드바 3탭 + routes.js 모듈 로드 | 수정 |
| `public/app.js` | home()·review() 라우트, router 별칭, 구 라우트 제거 | 수정 |

---

## Task 1: routes.js + resolveRoute (TDD)

**Files:** Create `public/routes.js`, `__tests__/routes.test.mjs`.

- [ ] **Step 1: 실패 테스트**

`__tests__/routes.test.mjs`:
```js
import { describe, it, expect } from 'vitest'
import { resolveRoute } from '../public/routes.js'

describe('resolveRoute', () => {
  it('구 신호 탭 별칭 → home', () => {
    for (const a of ['dashboard', 'recommend', 'momentum', 'flow', 'positions']) {
      expect(resolveRoute(a)).toBe('home')
    }
  })
  it('검증/기록 별칭 → review', () => {
    expect(resolveRoute('verify')).toBe('review')
    expect(resolveRoute('history')).toBe('review')
  })
  it('정식 라우트는 그대로', () => {
    expect(resolveRoute('home')).toBe('home')
    expect(resolveRoute('analyze')).toBe('analyze')
    expect(resolveRoute('review')).toBe('review')
  })
  it('미지/빈 값 → home', () => {
    expect(resolveRoute('nonsense')).toBe('home')
    expect(resolveRoute('')).toBe('home')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/routes.test.mjs`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`public/routes.js`:
```js
// 해시 라우트명 → 정식 라우트. 구 URL 호환 별칭 포함.
export function resolveRoute(name) {
  const alias = {
    dashboard: 'home', recommend: 'home', momentum: 'home', flow: 'home', positions: 'home',
    verify: 'review', history: 'review',
  }
  const canonical = ['home', 'analyze', 'review']
  const r = alias[name] || name
  return canonical.includes(r) ? r : 'home'
}
// 브라우저(classic app.js)에서 전역으로 사용. Node(테스트)에선 window 없음.
if (typeof window !== 'undefined') window.resolveRoute = resolveRoute
```

- [ ] **Step 4: 통과 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && npx vitest run __tests__/routes.test.mjs`
Expected: PASS (4 케이스). 그리고 `npm test` 전체 그린.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add public/routes.js __tests__/routes.test.mjs && git commit -m "feat: 라우트 별칭 resolveRoute(구 URL 호환)"
```

---

## Task 2: 사이드바 3탭 + routes.js 로드

**Files:** Modify `public/index.html`.

- [ ] **Step 1: 사이드바 교체**

`public/index.html`의 8개 `<li>`(현재 17~24행, `data-tab=` 가진 줄들)를 3개로 교체:
```html
        <li><a href="#/home" data-tab="home">🏠 종합</a></li>
        <li><a href="#/analyze" data-tab="analyze">🔍 개별분석</a></li>
        <li><a href="#/review" data-tab="review">📊 기록·검증</a></li>
```

- [ ] **Step 2: routes.js 모듈 로드**

`public/index.html`에서 `<script src="/app.js"></script>`(현재 30행) 줄 **바로 위**에 추가:
```html
  <script type="module" src="/routes.js"></script>
```
(모듈은 기본 defer라 DOMContentLoaded 전에 실행되어 `window.resolveRoute` 준비됨.)

- [ ] **Step 3: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add public/index.html && git commit -m "feat: 사이드바 3탭으로 통합 + routes.js 로드"
```

---

## Task 3: 🏠 종합 home() 라우트

**Files:** Modify `public/app.js` — `routes` 객체에 `home()` 추가(기존 `dashboard()` 메서드를 이걸로 교체, 즉 dashboard 메서드 자리에 home 작성).

- [ ] **Step 1: home() 작성**

`routes` 객체에서 기존 `async dashboard() { ... }` 메서드 **전체를** 아래 `async home() { ... }`로 교체:
```js
  async home() {
    setActiveTab('home')
    view.innerHTML = '<span class="loading loading-spinner"></span>'
    let res, mom, flow, pos
    try {
      [res, mom, flow, pos] = await Promise.all([
        api('/api/results'), api('/api/momentum'), api('/api/flow'), api('/api/positions'),
      ])
    } catch {
      view.innerHTML = '<div class="alert alert-error">데이터 조회 실패 — 서버 연결을 확인하세요.</div>'
      return
    }
    const stale = res.timestamp && (Date.now() - new Date(res.timestamp)) > 14 * 3600 * 1000
    const regime = res.regime
      ? `· 레짐 <span class="badge badge-sm ${res.regime.label === '확장' ? 'badge-success' : res.regime.label === '수축' ? 'badge-error' : 'badge-warning'}">${res.regime.emoji} ${esc(res.regime.label)}</span>`
      : ''
    const lastScans = `반등 ${res.timestamp ? new Date(res.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-'} · 자금 ${flow.timestamp ? new Date(flow.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-'}`

    // 포지션 요약 (보유 있을 때만)
    const positions = pos.positions || []
    const posBar = !positions.length ? '' : `
      <div class="card bg-base-200 shadow mb-3"><div class="card-body p-3">
        <h3 class="card-title text-sm">💼 포지션</h3>
        <div class="flex flex-wrap gap-3">${positions.map((p) => {
          const pl = p.plPct == null ? '-' : `<span class="${p.plPct >= 0 ? 'text-success' : 'text-error'}">${p.plPct >= 0 ? '+' : ''}${p.plPct}%</span>`
          const st = p.hitSL ? '<span class="badge badge-error badge-sm">SL도달</span>' : p.hitTP ? '<span class="badge badge-success badge-sm">TP도달</span>' : `<span class="opacity-60 text-xs">SL까지 ${p.toSLPct == null ? '-' : p.toSLPct + '%'}</span>`
          return `<div class="cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(p.market)}'"><span class="font-medium">${esc(p.korean_name || p.market)}</span> ${fmt(p.price)} ${pl} ${st}</div>`
        }).join('')}</div>
      </div></div>`

    // 모멘텀 카드 (compact)
    const momRows = (mom.picks || []).slice(0, 8).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td><span class="font-medium">${esc(x.korean_name)}</span></td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
      </tr>`).join('') || '<tr><td colspan="2" class="opacity-60 text-xs">스캔 대기</td></tr>'

    // 자금유입 카드 (compact)
    const flowEmoji = { strong: '🔴', attention: '🟠', watch: '🟡' }
    const flowRows = (flow.picks || []).slice(0, 8).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td>${flowEmoji[x.level] || ''} <span class="font-medium">${esc(x.korean_name)}</span></td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td class="text-xs opacity-70">${x.ratio == null ? '' : x.ratio + 'x'}</td>
      </tr>`).join('') || '<tr><td colspan="3" class="opacity-60 text-xs">스캔 대기</td></tr>'

    // 반등: 메인 매수 TOP8 + 저유동성/매도 접기
    const lowLiq = res.buyLowLiq || []
    const sell = res.sell || []

    view.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-2xl font-bold">🏠 종합</h2>
        <button id="scanBtn" class="btn btn-primary btn-sm">🔄 수동 스캔</button>
      </div>
      <p class="opacity-60 text-sm mb-3">${lastScans} ${regime} ${stale ? '<span class="badge badge-warning badge-sm">⏰ 스캔지연</span>' : ''}</p>
      <div id="scanProgress" class="mb-3"></div>
      ${posBar}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="card bg-base-200 shadow"><div class="card-body p-3">
          <h3 class="card-title text-sm">🟢 반등 TOP</h3>
          ${topTable((res.buy || []).slice(0, 8), 8)}
          ${lowLiq.length ? `<details class="mt-1"><summary class="text-xs opacity-60 cursor-pointer">⚠️ 저유동성 ${lowLiq.length}개</summary>${topTable(lowLiq, 99)}</details>` : ''}
          ${sell.length ? `<details class="mt-1"><summary class="text-xs opacity-60 cursor-pointer">🔴 매도 ${sell.length}개</summary>${topTable(sell, 99)}</details>` : ''}
        </div></div>
        <div class="card bg-base-200 shadow"><div class="card-body p-3">
          <h3 class="card-title text-sm">🚀 모멘텀 TOP</h3>
          <table class="table table-zebra table-sm"><tbody>${momRows}</tbody></table>
        </div></div>
        <div class="card bg-base-200 shadow"><div class="card-body p-3">
          <h3 class="card-title text-sm">💸 자금유입 TOP</h3>
          <table class="table table-zebra table-sm"><tbody>${flowRows}</tbody></table>
        </div></div>
      </div>`
    $('#scanBtn').onclick = runScan
  },
```

- [ ] **Step 2: 구문 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node -c public/app.js`
Expected: SYNTAX OK. (이 시점엔 아직 router가 home을 안 부르지만 구문은 통과해야 함.)

- [ ] **Step 3: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add public/app.js && git commit -m "feat: 🏠 종합 홈 라우트(3스캐너+포지션 한 화면)"
```

---

## Task 4: 📊 기록·검증 review() 라우트

**Files:** Modify `public/app.js` — `routes` 객체에 `review()` 추가, 기존 `verify()`의 렌더 본문을 내부 함수로 재사용.

- [ ] **Step 1: review() 작성 + verify 본문 재사용**

`routes` 객체의 기존 `async verify() { ... }` 메서드를 아래로 **교체**(verify 렌더 로직을 `renderVerify()` 내부 함수로 옮기고, 콤보분포·캔들·스파크라인을 추가). 기존 `async history() { ... }`는 **삭제**(review의 기록 뷰가 `renderDateView`/`renderCoinView`를 직접 호출).

```js
  async review() {
    setActiveTab('review')
    view.innerHTML = `<h2 class="text-2xl font-bold mb-4">📊 기록·검증</h2>
      <div class="join mb-4">
        <button class="btn btn-sm join-item btn-active" id="rSegVerify">📈 검증</button>
        <button class="btn btn-sm join-item" id="rSegHistory">📜 기록</button>
      </div>
      <div id="rBody"></div>`
    const showVerify = async () => {
      $('#rBody').innerHTML = '<span class="loading loading-spinner"></span>'
      const [v, ins, res, hist] = await Promise.all([
        api('/api/verify'), api('/api/insights'), api('/api/results'), api('/api/history'),
      ])
      const bar = (rate) => `<progress class="progress progress-success w-24 align-middle" value="${Math.round((rate || 0) * 100)}" max="100"></progress>`
      const retCell = (ar) => ar == null ? '-' : `<span class="${ar >= 0 ? 'text-success' : 'text-error'}">${ar >= 0 ? '+' : ''}${ar}%</span>`
      const statsRows = Object.entries(v.signalStats || {})
        .sort((a, b) => (b[1].hitRate) - (a[1].hitRate))
        .map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}% ${bar(s.hitRate)}</td><td>${retCell(s.avgReturn)}</td><td><span class="badge badge-ghost badge-sm">${(v.weights[k] ?? 1).toFixed(2)}</span></td></tr>`).join('')
      const timed = v.timedHitRates || {}
      const mom = v.momentum
      const momCard = !mom ? '' : `
        <div class="card bg-base-200 shadow mb-4"><div class="card-body p-4">
          <h3 class="card-title text-sm">🚀 모멘텀 스캐너 적중률</h3>
          <div class="stats stats-horizontal shadow-none w-full">
            <div class="stat p-2"><div class="stat-title text-xs">전체</div><div class="stat-value text-xl">${mom.overallHitRate != null ? Math.round(mom.overallHitRate * 100) + '%' : '-'}</div><div class="stat-desc">${mom.picks}건</div></div>
            <div class="stat p-2"><div class="stat-title text-xs">+1일</div><div class="stat-value text-xl">${mom.timedHitRates?.['+1일'] ? Math.round(mom.timedHitRates['+1일'].hitRate * 100) + '%' : '-'}</div></div>
            <div class="stat p-2"><div class="stat-title text-xs">+3일</div><div class="stat-value text-xl">${mom.timedHitRates?.['+3일'] ? Math.round(mom.timedHitRates['+3일'].hitRate * 100) + '%' : '-'}</div></div>
            <div class="stat p-2"><div class="stat-title text-xs">+7일</div><div class="stat-value text-xl">${mom.timedHitRates?.['+7일'] ? Math.round(mom.timedHitRates['+7일'].hitRate * 100) + '%' : '-'}</div></div>
          </div>
        </div></div>`
      const r = v.report
      const sigBadge = (s) => `<tr><td>${esc(s.key)}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}%</td><td><span class="badge badge-success badge-sm">${s.hits}</span></td></tr>`
      const wChange = (w) => `<tr><td>${esc(w.key)}</td><td>${w.old.toFixed(2)} → ${w.new.toFixed(2)}</td><td>${w.direction === 'up' ? '<span class="text-success">▲</span>' : '<span class="text-error">▼</span>'}</td><td class="opacity-70">${esc(w.reason)}</td></tr>`
      const coinBadge = (c) => `<span class="badge badge-success badge-outline gap-1">${esc(c.korean_name || c.market.replace('KRW-', ''))} <span class="opacity-60">${c.hits}/${c.total}</span></span>`
      const sigTable = (list, label) => `
        <div>
          <div class="text-xs opacity-60 mb-1">${label} <span class="opacity-50">(표본 3+ · 적중률순)</span></div>
          <table class="table table-sm"><thead><tr><th>신호</th><th>표본</th><th>적중률</th><th>적중</th></tr></thead>
            <tbody>${(list || []).map(sigBadge).join('') || '<tr><td colspan="4" class="opacity-60">없음</td></tr>'}</tbody></table>
        </div>`
      const reportCard = !r ? '' : `
        <div class="card bg-base-200 shadow mb-4"><div class="card-body p-4">
          <h3 class="card-title text-sm">📅 이번 주 요약</h3>
          <div class="grid md:grid-cols-2 gap-4">
            ${sigTable(r.topBuySignals, '🟢 매수 신호 TOP')}
            ${sigTable(r.topSellSignals, '🔴 매도 신호 TOP')}
          </div>
          <div class="text-xs opacity-60 mt-2 mb-1">가중치 변화</div>
          <div class="overflow-x-auto"><table class="table table-sm"><thead><tr><th>신호</th><th>변화</th><th></th><th>이유</th></tr></thead>
            <tbody>${(r.weightChanges || []).map(wChange).join('') || '<tr><td colspan="4" class="opacity-60">변화 없음</td></tr>'}</tbody></table></div>
          <div class="text-xs opacity-60 mt-2 mb-1">적중 코인</div>
          <div class="flex flex-wrap gap-1">${(r.hitCoins || []).map(coinBadge).join('') || '<span class="opacity-60">없음</span>'}</div>
        </div></div>`
      // 홈에서 이동: 콤보분포·캔들요약·스파크라인
      const cd = res.comboDist || { rebound: 0, trap: 0, volume: 0, mtf: 0 }
      const cs = res.candleSummary || { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] }
      const buySpark = Charts.sparkline((hist || []).map((h) => h.buyCount), '#36d399')
      const sellSpark = Charts.sparkline((hist || []).map((h) => h.sellCount), '#f87272')
      const analyticsCard = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div class="card bg-base-200 shadow"><div class="card-body p-4">
            <h3 class="card-title text-sm opacity-70">콤보 분포</h3>
            <div class="flex flex-wrap gap-2 mt-1">
              <span class="badge badge-success gap-1">반등확인 ${cd.rebound}</span>
              <span class="badge badge-error gap-1">과매도함정 ${cd.trap}</span>
              <span class="badge badge-warning gap-1">거래량 ${cd.volume}</span>
              <span class="badge badge-info gap-1">MTF ${cd.mtf}</span>
            </div>
          </div></div>
          <div class="card bg-base-200 shadow"><div class="card-body p-4">
            <h3 class="card-title text-sm opacity-70">🕯️ 캔들 모양</h3>
            <div class="flex gap-4 mt-1">
              <div><span class="text-success font-bold text-lg">${cs.bullishCount}</span> <span class="opacity-60 text-xs">강세</span></div>
              <div><span class="text-error font-bold text-lg">${cs.bearishCount}</span> <span class="opacity-60 text-xs">약세</span></div>
            </div>
            <div class="text-xs opacity-60 mt-1">${cs.topBullish.map((p) => esc(p.name) + '×' + p.count).join(', ') || '-'}</div>
          </div></div>
          <div class="card bg-base-200 shadow"><div class="card-body p-4">
            <h3 class="card-title text-sm opacity-70">스캔 추이 (매수/매도)</h3>
            <div class="text-success">${buySpark}</div>
            <div class="text-error">${sellSpark}</div>
          </div></div>
        </div>`
      $('#rBody').innerHTML = `
        <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full mb-4">
          <div class="stat"><div class="stat-title">전체 적중률</div><div class="stat-value">${v.overallHitRate != null ? Math.round(v.overallHitRate * 100) + '%' : '-'}</div></div>
          <div class="stat"><div class="stat-title">+1일</div><div class="stat-value text-2xl">${timed['+1일'] ? Math.round(timed['+1일'].hitRate * 100) + '%' : '-'}</div></div>
          <div class="stat"><div class="stat-title">+3일</div><div class="stat-value text-2xl">${timed['+3일'] ? Math.round(timed['+3일'].hitRate * 100) + '%' : '-'}</div></div>
          <div class="stat"><div class="stat-title">+7일</div><div class="stat-value text-2xl">${timed['+7일'] ? Math.round(timed['+7일'].hitRate * 100) + '%' : '-'}</div></div>
        </div>
        ${analyticsCard}
        ${momCard}
        ${reportCard}
        <div class="card bg-base-200 shadow"><div class="card-body p-4">
          <h3 class="card-title text-sm">신호별 적중률 / 평균수익 / 가중치</h3>
          <div class="overflow-x-auto"><table class="table table-zebra table-sm">
            <thead><tr><th>신호</th><th>표본</th><th>적중률</th><th>평균수익</th><th>가중치</th></tr></thead>
            <tbody>${statsRows || '<tr><td colspan="5" class="opacity-60">데이터 없음 (주간 분석 필요)</td></tr>'}</tbody></table></div>
        </div></div>`
    }
    const showHistory = () => {
      $('#rBody').innerHTML = `<div class="join mb-4">
          <button class="btn btn-sm join-item btn-active" id="hSegDate">날짜별</button>
          <button class="btn btn-sm join-item" id="hSegCoin">종목별</button>
        </div><div id="hBody"></div>`
      $('#hSegDate').onclick = () => { $('#hSegDate').classList.add('btn-active'); $('#hSegCoin').classList.remove('btn-active'); renderDateView() }
      $('#hSegCoin').onclick = () => { $('#hSegCoin').classList.add('btn-active'); $('#hSegDate').classList.remove('btn-active'); renderCoinView() }
      renderDateView()
    }
    $('#rSegVerify').onclick = () => { $('#rSegVerify').classList.add('btn-active'); $('#rSegHistory').classList.remove('btn-active'); showVerify() }
    $('#rSegHistory').onclick = () => { $('#rSegHistory').classList.add('btn-active'); $('#rSegVerify').classList.remove('btn-active'); showHistory() }
    showVerify()
  },
```

NOTE: `renderDateView`/`renderCoinView`/`window.__scanDetail`/`histOffset`은 routes 객체 밖 모듈 레벨에 그대로 있으므로 `showHistory()`에서 직접 호출 가능. 단 기존 `history()`가 만들던 `#hBody` 컨테이너를 `showHistory()`가 동일하게 만들어 주므로 `renderDateView()`가 `$('#hBody')`를 찾을 수 있다.

- [ ] **Step 2: 구문 확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node -c public/app.js`
Expected: SYNTAX OK.

- [ ] **Step 3: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add public/app.js && git commit -m "feat: 📊 기록·검증 라우트(검증+기록 토글, 분석 통계 이동)"
```

---

## Task 5: 라우터 별칭 연결 + 구 라우트 제거 + 검증

**Files:** Modify `public/app.js` — 잔존 구 라우트 메서드 제거, router에 resolveRoute 연결, runScan 콜백 수정.

- [ ] **Step 1: 구 라우트 메서드 제거**

`routes` 객체에서 아래 메서드를 **삭제**(Task 3·4에서 dashboard→home, verify→review로 교체했고, history는 삭제했음. 남은 것 제거): `momentum()`, `flow()`, `positions()`, `recommend()`. → `routes` 객체에는 `home`, `analyze`, `review`만 남아야 한다.

확인: `cd /c/Users/toodo/workspace/upbit-dashboard && grep -nE 'async [a-z]+\(\) \{' public/app.js` → `home`, `analyze`, `review` 3개만 나와야 함.

- [ ] **Step 2: router를 resolveRoute로 연결**

`router()` 함수(현재 app.js 끝부분)를 수정:
```js
function router() {
  const hash = location.hash || '#/home'
  const name = resolveRoute(hash.slice(2).split('?')[0])
  routes[name]()
}
```
(`resolveRoute`는 routes.js 모듈이 `window`에 노출한 전역. classic script인 app.js에서 전역으로 접근 가능.)

- [ ] **Step 3: runScan 완료 콜백 수정**

runScan 내부(현재 약 478행)의 `routes.dashboard()`를 `routes.home()`으로 교체:
```js
      if (job.status === 'done') { clearInterval(timer); btn.disabled = false; routes.home() }
```

- [ ] **Step 4: 구문 + 전체 테스트 + 라이브 육안확인**

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node -c public/app.js && npm test 2>&1 | tail -3`
Expected: SYNTAX OK + 전체 PASS(기존 170 + routes 신규).

Run: `cd /c/Users/toodo/workspace/upbit-dashboard && node server/server.mjs` → 브라우저 `http://127.0.0.1:8787`:
- 🏠 종합 탭: 3열(반등·모멘텀·자금유입) + 포지션(있으면) 표시, 수동스캔 버튼 동작
- `#/recommend`·`#/verify` 등 옛 URL 직접 입력 → 깨지지 않고 home/review로 이동
- 📊 기록·검증 탭: 검증/기록 토글 전환, 기록 날짜별/종목별 동작
- 🔍 개별분석 탭: 기존대로 동작
확인 후 서버 종료.

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/toodo/workspace/upbit-dashboard && git add public/app.js && git commit -m "feat: 라우터 resolveRoute 연결 + 구 라우트 제거(3탭 완성)"
```

---

## 최종 검토 (전체 태스크 후)

- [ ] `npm test` 전체 통과 (routes.test 포함)
- [ ] 대시보드 3탭 육안확인: 종합 3열·옛 URL 별칭·기록검증 토글·개별분석
- [ ] superpowers:finishing-a-development-branch 로 브랜치 마무리
