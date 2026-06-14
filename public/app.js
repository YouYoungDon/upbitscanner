const view = document.getElementById('view')
const $ = (sel, el = document) => el.querySelector(sel)
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'))
// API/외부 문자열을 innerHTML에 넣기 전 이스케이프 (XSS 방지)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function api(path, opts) {
  const r = await fetch(path, opts)
  if (!r.ok) return r.json().catch(() => ({ error: r.statusText }))
  return r.json()
}

let marketsList = null // 전체 KRW 마켓 목록 캐시 (개별분석 탭 코인 리스트용)

function setActiveTab(tab) {
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab))
}

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

const routes = {
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

  async recommend() {
    setActiveTab('recommend')
    view.innerHTML = '<h2>추천</h2><p class="muted">불러오는 중…</p>'
    const res = await api('/api/results')
    let side = 'buy'
    const render = (q = '') => {
      const list = (res[side] || []).filter((x) => !q || x.korean_name.includes(q) || x.market.includes(q.toUpperCase()))
      $('#recBody').innerHTML = `<table>
        <thead><tr><th>종목</th><th>마켓</th><th>점수</th><th>현재가</th><th>신호</th></tr></thead>
        <tbody>${list.map((x) => `<tr class="clickable" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
          <td>${esc(x.korean_name)}</td><td>${esc(x.market.replace('KRW-', ''))}</td><td>${x.score}</td>
          <td>${fmt(x.price)}</td><td>${signalTags(x.signals)} <span class="muted">${x.signals.length}개</span></td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">없음</td></tr>'}</tbody></table>`
    }
    view.innerHTML = `<h2>추천</h2>
      <div class="controls">
        <span class="seg active" id="segBuy">매수</span>
        <span class="seg" id="segSell">매도</span>
        <input id="recSearch" placeholder="🔎 종목 검색" style="flex:1">
      </div>
      <div class="panel" id="recBody"></div>`
    const sw = (s) => { side = s; $('#segBuy').classList.toggle('active', s === 'buy'); $('#segSell').classList.toggle('active', s === 'sell'); render($('#recSearch').value) }
    $('#segBuy').onclick = () => sw('buy')
    $('#segSell').onclick = () => sw('sell')
    $('#recSearch').oninput = (e) => render(e.target.value)
    render()
  },

  async analyze() {
    setActiveTab('analyze')
    let selected = new URLSearchParams((location.hash.split('?')[1] || '')).get('market') || ''
    view.innerHTML = `<h2>개별 분석</h2>
      <div class="controls">
        <input id="search" placeholder="🔎 비트코인 또는 KRW-BTC" style="flex:1;min-width:200px">
        <span class="seg active" data-tf="day">일봉</span>
        <span class="seg" data-tf="4h">4시간</span>
        <span class="seg" data-tf="1h">1시간</span>
        <span class="seg active" data-ct="candle">캔들</span>
        <span class="seg" data-ct="line">라인</span>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div class="panel" style="width:240px">
          <h3>코인 <span id="coinCount" class="muted"></span></h3>
          <div id="coinlist" class="coinlist muted">불러오는 중…</div>
        </div>
        <div style="flex:1;min-width:300px">
          <div class="panel"><div id="title" class="muted" style="margin-bottom:8px">왼쪽에서 코인을 선택하세요</div><div id="chart"></div></div>
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <div class="panel" style="flex:1;min-width:240px"><h3>지표</h3><div id="ind" class="muted">-</div></div>
            <div class="panel" style="flex:1;min-width:240px"><h3>🕯️ 캔들 모양분석</h3><div id="cp" class="muted">-</div></div>
          </div>
          <div class="panel"><h3>종합 신호</h3><div id="sig" class="muted">-</div></div>
        </div>
      </div>`
    let tf = 'day', ct = 'candle', cache = null
    if (!marketsList) { try { marketsList = await api('/api/markets') } catch { marketsList = [] } }
    const nameOf = Object.fromEntries((marketsList || []).map((m) => [m.market, m.korean_name]))
    const renderList = (q = '') => {
      const qq = q.trim(), up = qq.toUpperCase()
      const list = (marketsList || []).filter((m) => !qq || m.korean_name.includes(qq) || m.market.includes(up) || m.market.replace('KRW-', '').includes(up))
      $('#coinCount').textContent = `(${list.length})`
      $('#coinlist').innerHTML = list.map((m) =>
        `<div class="coin-row${m.market === selected ? ' active' : ''}" data-market="${m.market}">${esc(m.korean_name)} <span class="muted">${esc(m.market.replace('KRW-', ''))}</span></div>`,
      ).join('') || '<span class="muted">결과 없음</span>'
      $('#coinlist').querySelectorAll('.coin-row').forEach((row) => { row.onclick = () => { selected = row.dataset.market; renderList($('#search').value); load() } })
    }
    const draw = () => {
      if (!cache) return
      if (ct === 'candle') Charts.candle($('#chart'), cache.ohlcv)
      else Charts.line($('#chart'), cache.ohlcv.map((c) => c.close))
    }
    const load = async () => {
      if (!selected) return
      $('#title').innerHTML = `<b>${esc(nameOf[selected] || '')}</b> <span class="muted">${esc(selected)}</span>`
      $('#ind').textContent = '불러오는 중…'
      const r = await api(`/api/analyze?market=${encodeURIComponent(selected)}&tf=${tf}`)
      if (r.error) { $('#ind').textContent = '조회 실패: ' + esc(r.error); return }
      cache = r; draw()
      const ind = r.indicators
      $('#ind').innerHTML = `현재가 <b>${fmt(ind.price)}</b><br>
        RSI ${ind.rsi?.toFixed(1) ?? '-'} · Stoch K ${ind.stoch?.k.toFixed(1) ?? '-'} D ${ind.stoch?.d.toFixed(1) ?? '-'}<br>
        MACD hist ${ind.macd?.hist.toFixed(2) ?? '-'} · WR ${ind.wr?.toFixed(1) ?? '-'}<br>
        EMA20 ${fmt(ind.ema20?.toFixed(2))} / EMA50 ${fmt(ind.ema50?.toFixed(2))} · Vol ${ind.volRatio?.toFixed(2) ?? '-'}x`
      const cp = r.candlePatterns
      $('#cp').innerHTML = [
        ...cp.bullish.map((p) => `<div class="tag good">▲ ${esc(p)}</div>`),
        ...cp.bearish.map((p) => `<div class="tag warn">▼ ${esc(p)}</div>`),
        ...cp.neutral.map((p) => `<div class="tag">· ${esc(p)}</div>`),
      ].join(' ') || '<span class="muted">감지된 패턴 없음</span>'
      $('#sig').innerHTML = `매수: ${esc(r.buy.join(', ')) || '없음'} <b>(${r.buyScore.toFixed(1)})</b><br>매도: ${esc(r.sell.join(', ')) || '없음'} <b>(${r.sellScore.toFixed(1)})</b>`
    }
    view.querySelectorAll('[data-tf]').forEach((el) => el.onclick = () => {
      tf = el.dataset.tf; view.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('active', x === el)); load()
    })
    view.querySelectorAll('[data-ct]').forEach((el) => el.onclick = () => {
      ct = el.dataset.ct; view.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('active', x === el)); draw()
    })
    const search = $('#search')
    search.oninput = (e) => renderList(e.target.value)
    search.onkeydown = (e) => { // Enter → 첫 검색 결과 선택
      if (e.key !== 'Enter') return
      const first = $('#coinlist .coin-row')
      if (first) { selected = first.dataset.market; renderList(search.value); load() }
    }
    renderList()
    if (selected) load()
  },

  async verify() {
    setActiveTab('verify')
    view.innerHTML = '<h2>신호 검증</h2><p class="muted">불러오는 중…</p>'
    const v = await api('/api/verify')
    const bar = (rate) => `<div class="bar" style="width:120px;display:inline-block"><div style="width:${Math.round((rate || 0) * 100)}%"></div></div>`
    const statsRows = Object.entries(v.signalStats || {})
      .sort((a, b) => (b[1].hitRate) - (a[1].hitRate))
      .map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}% ${bar(s.hitRate)}</td><td>${(v.weights[k] ?? 1).toFixed(2)}</td></tr>`).join('')
    const timed = v.timedHitRates || {}
    view.innerHTML = `<h2>신호 검증</h2>
      <div class="kpis">
        <div class="kpi"><div class="label">전체 적중률</div><div class="val">${v.overallHitRate != null ? Math.round(v.overallHitRate * 100) + '%' : '-'}</div></div>
        <div class="kpi"><div class="label">+1일</div><div class="val">${timed['+1일'] ? Math.round(timed['+1일'].hitRate * 100) + '%' : '-'}</div></div>
        <div class="kpi"><div class="label">+3일</div><div class="val">${timed['+3일'] ? Math.round(timed['+3일'].hitRate * 100) + '%' : '-'}</div></div>
        <div class="kpi"><div class="label">+7일</div><div class="val">${timed['+7일'] ? Math.round(timed['+7일'].hitRate * 100) + '%' : '-'}</div></div>
      </div>
      <div class="panel"><h3>신호별 적중률 / 가중치</h3>
        <table><thead><tr><th>신호</th><th>표본</th><th>적중률</th><th>가중치</th></tr></thead>
        <tbody>${statsRows || '<tr><td colspan="4" class="muted">데이터 없음 (주간 분석 필요)</td></tr>'}</tbody></table>
      </div>`
  },
}

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

async function runScan() {
  const btn = $('#scanBtn'); const prog = $('#scanProgress')
  btn.disabled = true
  const { jobId, error } = await api('/api/scan', { method: 'POST' })
  if (!jobId) { btn.disabled = false; prog.innerHTML = `<p class="muted">스캔 시작 실패${error ? ': ' + esc(error) : ''}</p>`; return }
  prog.innerHTML = '<progress class="progress progress-primary w-full" value="5" max="100"></progress><p class="opacity-60 text-sm">스캔 중…</p>'
  const deadline = Date.now() + 5 * 60 * 1000 // 5분 한도
  const stop = (msg) => { clearInterval(timer); btn.disabled = false; if (msg) prog.innerHTML = `<p class="muted">${esc(msg)}</p>` }
  const timer = setInterval(async () => {
    try {
      const job = await api('/api/scan/' + jobId)
      const pb = $('progress', prog)
      if (pb) pb.value = job.progress || 0
      if (job.status === 'done') { clearInterval(timer); btn.disabled = false; routes.dashboard() }
      else if (job.status === 'error') stop('스캔 실패')
      else if (Date.now() > deadline) stop('스캔 시간 초과')
    } catch {
      stop('스캔 상태 조회 실패 (네트워크)')
    }
  }, 1500)
}

function router() {
  const hash = location.hash || '#/dashboard'
  const name = hash.slice(2).split('?')[0]
  ;(routes[name] || routes.dashboard)()
}
window.addEventListener('hashchange', router)
window.addEventListener('DOMContentLoaded', router)
