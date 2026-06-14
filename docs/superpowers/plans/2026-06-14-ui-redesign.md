# 대시보드 UI 리뉴얼 (Tailwind + DaisyUI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 프론트를 Tailwind+DaisyUI(CDN)로 리스타일하고, 대시보드 탭에 콤보 분포·캔들 요약·스캔 추이·TOP10을 추가한다.

**Architecture:** 집계는 서버(`server/api.mjs`)의 순수 함수로 계산해 `/api/results`·`/api/history` 응답에 포함하고, 프론트(`public/`)는 DaisyUI 컴포넌트로 렌더만 한다. 빌드 도구 없이 CDN 태그만 추가한다.

**Tech Stack:** Tailwind Play CDN, DaisyUI 4 CDN(테마 business), 기존 zero-dep Node http 서버, lightweight-charts, SVG 스파크라인, Vitest.

---

## Task 1: 서버 집계 함수 (comboDistribution / candleSummary / buildHistory)

**Files:**
- Modify: `server/api.mjs`
- Test: `__tests__/api.test.mjs`

콤보 분포·캔들 요약·스캔 추이를 순수 함수로 만들고, `buildResults`가 분포/요약을 응답에 포함하게 한다.

- [ ] **Step 1: 실패하는 테스트 추가 (`__tests__/api.test.mjs` 끝에 append)**

```javascript
import { comboDistribution, candleSummary, buildHistory } from '../server/api.mjs'

describe('comboDistribution', () => {
  it('매수 종목 신호에서 콤보/MTF 종목 수 집계', () => {
    const buy = [
      { signals: ['Stoch 과매도 골든크로스 (5)', '[콤보] 반등확인 보너스', '[MTF] 4시간봉 Stoch GC 확인'] },
      { signals: ['BB 하단 지지', '[콤보] 과매도 함정 페널티'] },
      { signals: ['거래량 급증 (2.5x)', '[콤보] 거래량확인 보너스', '[콤보] 반등확인 보너스'] },
    ]
    const r = comboDistribution(buy)
    expect(r.rebound).toBe(2)   // 반등확인
    expect(r.trap).toBe(1)      // 과매도 함정
    expect(r.volume).toBe(1)    // 거래량확인
    expect(r.mtf).toBe(1)       // MTF
  })
})

describe('candleSummary', () => {
  it('매수 강세형/매도 약세형 종목 수와 대표 패턴', () => {
    const scan = {
      buy: [
        { signals: ['캔들 강세형 (망치형,상승장악형)'] },
        { signals: ['캔들 강세형 (망치형)'] },
      ],
      sell: [{ signals: ['캔들 약세형 (유성형)'] }],
    }
    const r = candleSummary(scan)
    expect(r.bullishCount).toBe(2)
    expect(r.bearishCount).toBe(1)
    expect(r.topBullish[0]).toEqual({ name: '망치형', count: 2 })
  })
})

describe('buildHistory', () => {
  it('최근 스캔별 매수/매도 개수 (limit 적용)', () => {
    const log = { scans: [
      { timestamp: 't1', buy: [{}], sell: [{}, {}] },
      { timestamp: 't2', buy: [{}, {}], sell: [] },
      { timestamp: 't3', buy: [], sell: [{}] },
    ] }
    const r = buildHistory(log, 2)
    expect(r).toEqual([
      { timestamp: 't2', buyCount: 2, sellCount: 0 },
      { timestamp: 't3', buyCount: 0, sellCount: 1 },
    ])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: FAIL — `comboDistribution is not exported` 등

- [ ] **Step 3: `server/api.mjs`에 함수 추가 + buildResults 확장**

`server/api.mjs` 상단 import 유지하고 아래 함수들을 추가, 그리고 `buildResults`를 수정:

```javascript
// 매수 종목 신호 태그에서 콤보/MTF 종목 수 집계
export function comboDistribution(buyList = []) {
  const has = (item, kw) => (item.signals || []).some((s) => s.includes(kw))
  let rebound = 0, trap = 0, volume = 0, mtf = 0
  for (const item of buyList) {
    if (has(item, '반등확인')) rebound++
    if (has(item, '과매도 함정')) trap++
    if (has(item, '거래량확인')) volume++
    if (has(item, '[MTF]')) mtf++
  }
  return { rebound, trap, volume, mtf }
}

// 캔들 강세/약세형 종목 수 + 대표 패턴 (라벨 '캔들 강세형 (망치형,...)'에서 추출)
export function candleSummary(scan = {}) {
  const names = (signals, key) => {
    const label = (signals || []).find((s) => s.startsWith(key))
    if (!label) return []
    const m = label.match(/\(([^)]*)\)/)
    return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : []
  }
  let bullishCount = 0, bearishCount = 0
  const bullCounts = {}, bearCounts = {}
  for (const item of scan.buy || []) {
    const ns = names(item.signals, '캔들 강세형')
    if (ns.length) bullishCount++
    for (const n of ns) bullCounts[n] = (bullCounts[n] || 0) + 1
  }
  for (const item of scan.sell || []) {
    const ns = names(item.signals, '캔들 약세형')
    if (ns.length) bearishCount++
    for (const n of ns) bearCounts[n] = (bearCounts[n] || 0) + 1
  }
  const top = (counts) => Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3)
  return { bullishCount, bearishCount, topBullish: top(bullCounts), topBearish: top(bearCounts) }
}

// 최근 스캔별 매수/매도 개수 추이
export function buildHistory(log, limit = 14) {
  const scans = (log?.scans || []).slice(-limit)
  return scans.map((s) => ({ timestamp: s.timestamp, buyCount: (s.buy || []).length, sellCount: (s.sell || []).length }))
}
```

그리고 기존 `buildResults`의 non-empty 반환 객체에 두 필드를 추가:
```javascript
export function buildResults(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { buyCount: 0, sellCount: 0, totalScans: log?.totalScans || 0 }, buy: [], sell: [], comboDist: { rebound: 0, trap: 0, volume: 0, mtf: 0 }, candleSummary: { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] } }
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { buyCount: scan.buy.length, sellCount: scan.sell.length, totalScans: log.totalScans || 0 },
    buy: scan.buy,
    sell: scan.sell,
    comboDist: comboDistribution(scan.buy),
    candleSummary: candleSummary(scan),
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: PASS (기존 + 신규)

- [ ] **Step 5: Commit**

```bash
git add server/api.mjs __tests__/api.test.mjs
git commit -m "feat: add combo/candle/history aggregation for dashboard"
```

---

## Task 2: `/api/history` 라우트

**Files:**
- Modify: `server/server.mjs`

- [ ] **Step 1: import + 라우트 추가**

`server/server.mjs`에서 api.mjs import에 `buildHistory` 추가:
```javascript
import { buildResults, buildInsights, buildVerify, buildHistory } from './api.mjs'
```

`/api/weights` 라우트 블록 **아래**에 추가:
```javascript
    if (p === '/api/history') {
      return sendJson(res, 200, buildHistory(await readJson('monitor-log.json', { scans: [] })))
    }
```

- [ ] **Step 2: 서버 기동 + 스모크 테스트**

서버 백그라운드 실행(Bash run_in_background): `node server/server.mjs`. 2초 대기 후:
```bash
curl -s http://127.0.0.1:8787/api/history | head -c 200
curl -s http://127.0.0.1:8787/api/results | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log('comboDist',JSON.stringify(d.comboDist),'candle',JSON.stringify(d.candleSummary).slice(0,80))"
```
Expected: history는 `[{timestamp,buyCount,sellCount},...]`, results에 `comboDist`/`candleSummary` 포함. 서버 종료.

- [ ] **Step 3: Commit**

```bash
git add server/server.mjs
git commit -m "feat: add /api/history route"
```

---

## Task 3: CDN 통합 + 사이드바 셸 (index.html, styles.css)

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`

- [ ] **Step 1: public/index.html 교체**

```html
<!DOCTYPE html>
<html lang="ko" data-theme="business">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>업비트 스캐너</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body class="min-h-screen bg-base-100 text-base-content">
  <div class="flex min-h-screen">
    <aside class="w-56 bg-base-200 border-r border-base-300 shrink-0">
      <div class="px-4 py-4 text-lg font-bold">🪙 업비트 스캐너</div>
      <ul class="menu px-2 gap-1">
        <li><a href="#/dashboard" data-tab="dashboard">📊 대시보드</a></li>
        <li><a href="#/recommend" data-tab="recommend">🟢 추천</a></li>
        <li><a href="#/analyze" data-tab="analyze">🔍 개별분석</a></li>
        <li><a href="#/verify" data-tab="verify">✅ 신호검증</a></li>
      </ul>
    </aside>
    <main id="view" class="flex-1 p-6 overflow-x-hidden"></main>
  </div>
  <script src="/charts.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: public/styles.css 교체 (DaisyUI와 충돌하는 커스텀 제거, 오버라이드만)**

`.css` 파일이므로 `<style>` 태그 없이 아래 내용만 저장:
```css
/* DaisyUI/Tailwind 위 최소 오버라이드 */
.menu a.active { background-color: hsl(var(--p) / 0.15); color: hsl(var(--p)); }
#chart { height: 300px; }
.coinlist { max-height: 460px; overflow-y: auto; }
.coin-row { padding: 7px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.coin-row:hover { background: hsl(var(--b3)); }
.coin-row.active { background: hsl(var(--p) / 0.18); color: hsl(var(--p)); }
.spark { width: 100%; height: 40px; display: block; }
```

- [ ] **Step 3: 서버 기동 + 셸 로드 확인**

서버 백그라운드 실행 후:
```bash
curl -s http://127.0.0.1:8787/ | grep -o 'data-theme="business"'
curl -s http://127.0.0.1:8787/ | grep -c "cdn.tailwindcss.com"
```
Expected: `data-theme="business"` 출력, tailwind CDN 1회. 서버 종료.
(브라우저에서 시각 확인은 Task 6 이후 일괄)

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat: integrate Tailwind+DaisyUI CDN and restyle shell"
```

---

## Task 4: 스파크라인 헬퍼 (charts.js)

**Files:**
- Modify: `public/charts.js`

작은 추이 표시는 lightweight-charts 대신 인라인 SVG 스파크라인으로 그린다.

- [ ] **Step 1: charts.js의 `window.Charts` 객체에 sparkline 메서드 추가**

`window.Charts = { ... }`의 `line(...)` 메서드 뒤(닫는 `},` 다음, 객체 닫기 `}` 전)에 추가:
```javascript
  // 작은 추이 스파크라인 (SVG path 반환). values: number[]
  sparkline(values, color) {
    const w = 240, h = 40, pad = 2
    if (!values || values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`
    const max = Math.max(...values), min = Math.min(...values)
    const span = max - min || 1
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`
  },
```

- [ ] **Step 2: 문법 확인**

Run: `node --check public/charts.js`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add public/charts.js
git commit -m "feat: add svg sparkline helper"
```

---

## Task 5: 대시보드 탭 리스타일 + 정보 확장 (app.js)

**Files:**
- Modify: `public/app.js`

`signalTags`를 DaisyUI badge로 바꾸고, `dashboard` 라우트를 stats + 카드 + 스파크라인 + TOP10으로 재작성, `topTable`을 badge 테이블로 교체.

- [ ] **Step 1: `signalTags`를 DaisyUI badge로 교체**

기존 `signalTags` 함수 본문을 아래로 교체:
```javascript
function signalTags(signals) {
  return (signals || []).map((s) => {
    if (s.includes('골든크로스')) return '<span class="badge badge-success badge-sm">GC</span>'
    if (s.includes('[MTF]')) return '<span class="badge badge-info badge-sm">MTF</span>'
    if (s.includes('함정')) return '<span class="badge badge-error badge-sm">함정</span>'
    if (s.includes('데드크로스')) return '<span class="badge badge-error badge-sm">DC</span>'
    if (s.includes('거래량')) return '<span class="badge badge-warning badge-sm">VOL</span>'
    if (s.includes('캔들 강세')) return '<span class="badge badge-success badge-sm">🕯강세</span>'
    if (s.includes('캔들 약세')) return '<span class="badge badge-error badge-sm">🕯약세</span>'
    return ''
  }).join(' ')
}
```

- [ ] **Step 2: `topTable`을 badge 테이블 + TOP N(기본 10)로 교체**

기존 `topTable` 함수를 아래로 교체:
```javascript
function topTable(list = [], n = 10) {
  if (!list.length) return '<p class="opacity-60 text-sm">없음</p>'
  return `<div class="overflow-x-auto"><table class="table table-zebra table-sm">
    <thead><tr><th>종목</th><th>점수</th><th>현재가</th><th>신호</th></tr></thead>
    <tbody>${list.slice(0, n).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td><span class="font-medium">${esc(x.korean_name)}</span> <span class="opacity-50 text-xs">${esc(x.market.replace('KRW-', ''))}</span></td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td>${fmt(x.price)}</td>
        <td>${signalTags(x.signals)}</td>
      </tr>`).join('')}</tbody></table></div>`
}
```

- [ ] **Step 3: `dashboard` 라우트 재작성**

`routes.dashboard`를 아래로 교체:
```javascript
  async dashboard() {
    setActiveTab('dashboard')
    view.innerHTML = '<span class="loading loading-spinner"></span>'
    let res, ins, hist
    try {
      [res, ins, hist] = await Promise.all([api('/api/results'), api('/api/insights'), api('/api/history')])
    } catch {
      view.innerHTML = '<div class="alert alert-error">데이터 조회 실패 — 서버 연결을 확인하세요.</div>'
      return
    }
    const kpi = res.kpi || {}
    const cd = res.comboDist || { rebound: 0, trap: 0, volume: 0, mtf: 0 }
    const cs = res.candleSummary || { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] }
    const buySpark = Charts.sparkline((hist || []).map((h) => h.buyCount), '#36d399')
    const sellSpark = Charts.sparkline((hist || []).map((h) => h.sellCount), '#f87272')
    const best = ins.bestHitRate
    view.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-2xl font-bold">대시보드</h2>
        <button id="scanBtn" class="btn btn-primary btn-sm">🔄 수동 스캔</button>
      </div>
      <p class="opacity-60 text-sm mb-3">마지막 스캔: ${res.timestamp ? new Date(res.timestamp).toLocaleString('ko-KR') : '없음'}</p>
      <div id="scanProgress" class="mb-4"></div>
      <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full mb-4">
        <div class="stat"><div class="stat-title">매수</div><div class="stat-value text-success">${kpi.buyCount ?? 0}</div></div>
        <div class="stat"><div class="stat-title">매도</div><div class="stat-value text-error">${kpi.sellCount ?? 0}</div></div>
        <div class="stat"><div class="stat-title">누적 스캔</div><div class="stat-value">${kpi.totalScans ?? 0}</div></div>
        <div class="stat"><div class="stat-title">최다 신호</div><div class="stat-desc text-base mt-2">${esc(ins.topSignal?.key) || '-'}</div></div>
        <div class="stat"><div class="stat-title">적중률 1위</div><div class="stat-desc text-base mt-2">${best ? esc(best.key) + ' ' + Math.round(best.hitRate * 100) + '%' : '-'}</div></div>
      </div>
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
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="card bg-base-200 shadow"><div class="card-body p-4"><h3 class="card-title text-sm">🟢 매수 TOP 10</h3>${topTable(res.buy, 10)}</div></div>
        <div class="card bg-base-200 shadow"><div class="card-body p-4"><h3 class="card-title text-sm">🔴 매도 TOP 10</h3>${topTable(res.sell, 10)}</div></div>
      </div>`
    $('#scanBtn').onclick = runScan
  },
```

- [ ] **Step 4: `runScan`의 진행률 마크업을 DaisyUI progress로 교체**

`runScan` 함수에서 `prog.innerHTML = '<div class="bar">...'` 줄을 아래로 교체:
```javascript
  prog.innerHTML = '<progress class="progress progress-primary w-full" value="5" max="100"></progress><p class="opacity-60 text-sm">스캔 중…</p>'
```
그리고 진행률 갱신 줄 `const fill = $('.bar > div', prog); if (fill) fill.style.width = ...`를 아래로 교체:
```javascript
      const pb = $('progress', prog)
      if (pb) pb.value = job.progress || 0
```

- [ ] **Step 5: 문법 확인 + 서버 기동 확인**

Run: `node --check public/app.js`
Expected: exit 0
그 후 서버 백그라운드 실행 → `curl -s http://127.0.0.1:8787/app.js | grep -c "stats stats-vertical"` ≥ 1. 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: redesign dashboard tab with DaisyUI + combo/candle/spark/top10"
```

---

## Task 6: 추천·개별분석·검증 탭 리스타일 (app.js)

**Files:**
- Modify: `public/app.js`

로직은 유지하고 마크업 클래스만 DaisyUI로 교체한다.

- [ ] **Step 1: `recommend` 라우트 마크업 교체**

`routes.recommend` 안의 `view.innerHTML = ...`(컨트롤+패널)과 `render` 내부 테이블을 아래로 교체:
```javascript
    view.innerHTML = `<h2 class="text-2xl font-bold mb-4">추천</h2>
      <div class="flex flex-wrap gap-2 items-center mb-3">
        <div class="join">
          <button class="btn btn-sm join-item btn-active" id="segBuy">매수</button>
          <button class="btn btn-sm join-item" id="segSell">매도</button>
        </div>
        <input id="recSearch" class="input input-bordered input-sm flex-1 min-w-48" placeholder="🔎 종목 검색">
      </div>
      <div class="card bg-base-200 shadow"><div class="card-body p-3" id="recBody"></div></div>`
```
그리고 `render` 내부의 `$('#recBody').innerHTML = ...`를 아래로 교체:
```javascript
      $('#recBody').innerHTML = `<div class="overflow-x-auto"><table class="table table-zebra table-sm">
        <thead><tr><th>종목</th><th>점수</th><th>현재가</th><th>신호</th></tr></thead>
        <tbody>${list.map((x) => `<tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
          <td><span class="font-medium">${esc(x.korean_name)}</span> <span class="opacity-50 text-xs">${esc(x.market.replace('KRW-', ''))}</span></td>
          <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
          <td>${fmt(x.price)}</td><td>${signalTags(x.signals)}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="opacity-60">없음</td></tr>'}</tbody></table></div>`
```
그리고 세그 토글 핸들러의 active 클래스 토글을 `btn-active` 기준으로 교체:
```javascript
    const sw = (s) => { side = s; $('#segBuy').classList.toggle('btn-active', s === 'buy'); $('#segSell').classList.toggle('btn-active', s === 'sell'); render($('#recSearch').value) }
```

- [ ] **Step 2: `analyze` 라우트 마크업 교체**

`routes.analyze`의 `view.innerHTML = ...` 전체를 아래로 교체(핸들러/변수명은 동일 유지: `#search`,`#coinlist`,`#coinCount`,`#title`,`#chart`,`#ind`,`#cp`,`#sig`, `data-tf`,`data-ct`):
```javascript
    view.innerHTML = `<h2 class="text-2xl font-bold mb-4">개별 분석</h2>
      <div class="flex flex-wrap gap-2 items-center mb-3">
        <input id="search" class="input input-bordered input-sm flex-1 min-w-52" placeholder="🔎 비트코인 또는 KRW-BTC">
        <div class="join">
          <button class="btn btn-sm join-item btn-active" data-tf="day">일봉</button>
          <button class="btn btn-sm join-item" data-tf="4h">4시간</button>
          <button class="btn btn-sm join-item" data-tf="1h">1시간</button>
        </div>
        <div class="join">
          <button class="btn btn-sm join-item btn-active" data-ct="candle">캔들</button>
          <button class="btn btn-sm join-item" data-ct="line">라인</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-4 items-start">
        <div class="card bg-base-200 shadow w-60 shrink-0"><div class="card-body p-3">
          <h3 class="card-title text-sm">코인 <span id="coinCount" class="opacity-50 text-xs"></span></h3>
          <div id="coinlist" class="coinlist">불러오는 중…</div>
        </div></div>
        <div class="flex-1 min-w-72 flex flex-col gap-4">
          <div class="card bg-base-200 shadow"><div class="card-body p-4">
            <div id="title" class="opacity-60 mb-2">왼쪽에서 코인을 선택하세요</div><div id="chart"></div>
          </div></div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="card bg-base-200 shadow"><div class="card-body p-4"><h3 class="card-title text-sm">지표</h3><div id="ind" class="opacity-60 text-sm">-</div></div></div>
            <div class="card bg-base-200 shadow"><div class="card-body p-4"><h3 class="card-title text-sm">🕯️ 캔들 모양분석</h3><div id="cp" class="opacity-60 text-sm">-</div></div></div>
          </div>
          <div class="card bg-base-200 shadow"><div class="card-body p-4"><h3 class="card-title text-sm">종합 신호</h3><div id="sig" class="opacity-60 text-sm">-</div></div></div>
        </div>
      </div>`
```
그리고 세그먼트 토글 핸들러의 `classList.toggle('active', ...)`를 `classList.toggle('btn-active', ...)`로 교체(`data-tf`, `data-ct` 둘 다). 캔들 패턴 badge 출력은 기존 `.tag` 대신 DaisyUI badge로:
```javascript
      $('#cp').innerHTML = [
        ...cp.bullish.map((p) => `<span class="badge badge-success gap-1 m-0.5">▲ ${esc(p)}</span>`),
        ...cp.bearish.map((p) => `<span class="badge badge-error gap-1 m-0.5">▼ ${esc(p)}</span>`),
        ...cp.neutral.map((p) => `<span class="badge badge-ghost gap-1 m-0.5">· ${esc(p)}</span>`),
      ].join(' ') || '<span class="opacity-60">감지된 패턴 없음</span>'
```

- [ ] **Step 3: `verify` 라우트 마크업 교체**

`routes.verify` 안의 `bar`, `statsRows`, `view.innerHTML`을 아래로 교체:
```javascript
    const bar = (rate) => `<progress class="progress progress-success w-24 align-middle" value="${Math.round((rate || 0) * 100)}" max="100"></progress>`
    const statsRows = Object.entries(v.signalStats || {})
      .sort((a, b) => (b[1].hitRate) - (a[1].hitRate))
      .map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}% ${bar(s.hitRate)}</td><td><span class="badge badge-ghost badge-sm">${(v.weights[k] ?? 1).toFixed(2)}</span></td></tr>`).join('')
    const timed = v.timedHitRates || {}
    view.innerHTML = `<h2 class="text-2xl font-bold mb-4">신호 검증</h2>
      <div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full mb-4">
        <div class="stat"><div class="stat-title">전체 적중률</div><div class="stat-value">${v.overallHitRate != null ? Math.round(v.overallHitRate * 100) + '%' : '-'}</div></div>
        <div class="stat"><div class="stat-title">+1일</div><div class="stat-value text-2xl">${timed['+1일'] ? Math.round(timed['+1일'].hitRate * 100) + '%' : '-'}</div></div>
        <div class="stat"><div class="stat-title">+3일</div><div class="stat-value text-2xl">${timed['+3일'] ? Math.round(timed['+3일'].hitRate * 100) + '%' : '-'}</div></div>
        <div class="stat"><div class="stat-title">+7일</div><div class="stat-value text-2xl">${timed['+7일'] ? Math.round(timed['+7일'].hitRate * 100) + '%' : '-'}</div></div>
      </div>
      <div class="card bg-base-200 shadow"><div class="card-body p-4">
        <h3 class="card-title text-sm">신호별 적중률 / 가중치</h3>
        <div class="overflow-x-auto"><table class="table table-zebra table-sm">
          <thead><tr><th>신호</th><th>표본</th><th>적중률</th><th>가중치</th></tr></thead>
          <tbody>${statsRows || '<tr><td colspan="4" class="opacity-60">데이터 없음 (주간 분석 필요)</td></tr>'}</tbody></table></div>
      </div></div>`
```

- [ ] **Step 4: `setActiveTab`의 active 클래스 확인**

`setActiveTab`은 `.sidebar a`를 찾는데, 새 마크업은 `.menu a`이다. 아래로 교체:
```javascript
function setActiveTab(tab) {
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab))
}
```

- [ ] **Step 5: 문법 확인**

Run: `node --check public/app.js`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: restyle recommend/analyze/verify tabs with DaisyUI"
```

---

## Task 7: 전체 검증 + README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run`
Expected: 모든 테스트 PASS (기존 50 + api combo/candle/history 신규)

- [ ] **Step 2: 서버 기동 + 엔드포인트/정적 스모크**

서버 백그라운드 실행 후:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/
curl -s http://127.0.0.1:8787/api/history | head -c 120
curl -s "http://127.0.0.1:8787/api/results" | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log('comboDist' in d, 'candleSummary' in d)"
```
Expected: 200, history 배열, `true true`. 서버 종료.

- [ ] **Step 3: README 대시보드 섹션에 한 줄 추가**

`## 대시보드` 섹션의 불릿 목록 맨 위에 추가:
```markdown
- **UI**: Tailwind CSS + DaisyUI(business 테마, CDN) 기반. 빌드 없이 동작.
```
그리고 대시보드 탭 불릿을 아래로 교체:
```markdown
- **대시보드 탭**: KPI stats + 콤보 분포 + 캔들 모양 요약 + 스캔 추이 스파크라인 + 매수/매도 TOP 10 + 수동 스캔
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note DaisyUI dashboard redesign"
```

---

## 완료 기준

- [ ] `npx vitest run` 전체 통과 (api combo/candle/history 포함)
- [ ] `/api/history` 동작, `/api/results`에 comboDist·candleSummary 포함
- [ ] 4탭 모두 DaisyUI(business) 스타일로 렌더
- [ ] 대시보드에 콤보 분포·캔들 요약·스캔 추이 스파크라인·TOP10 표시
- [ ] 수동 스캔 progress(DaisyUI) 동작
- [ ] README 갱신
