const view = document.getElementById('view')
const $ = (sel, el = document) => el.querySelector(sel)
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('ko-KR'))

async function api(path, opts) {
  const r = await fetch(path, opts)
  return r.json()
}

function setActiveTab(tab) {
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab))
}

function signalTags(signals) {
  return signals.map((s) => {
    if (s.includes('골든크로스')) return '<span class="tag good">GC</span>'
    if (s.includes('[MTF]')) return '<span class="tag">MTF</span>'
    if (s.includes('함정')) return '<span class="tag warn">함정</span>'
    if (s.includes('데드크로스')) return '<span class="tag warn">DC</span>'
    return ''
  }).join('') || ''
}

const routes = {
  async dashboard() {
    setActiveTab('dashboard')
    view.innerHTML = '<h2>대시보드</h2><p class="muted">불러오는 중…</p>'
    const [res, ins] = await Promise.all([api('/api/results'), api('/api/insights')])
    const kpi = res.kpi || {}
    view.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>대시보드</h2>
        <button id="scanBtn">🔄 수동 스캔</button>
      </div>
      <p class="muted">마지막 스캔: ${res.timestamp ? new Date(res.timestamp).toLocaleString('ko-KR') : '없음'}</p>
      <div id="scanProgress"></div>
      <div class="kpis">
        <div class="kpi"><div class="label">매수</div><div class="val">${kpi.buyCount ?? 0}</div></div>
        <div class="kpi"><div class="label">매도</div><div class="val">${kpi.sellCount ?? 0}</div></div>
        <div class="kpi"><div class="label">누적 스캔</div><div class="val">${kpi.totalScans ?? 0}</div></div>
        <div class="kpi"><div class="label">최다 신호</div><div class="val" style="font-size:15px">${ins.topSignal?.key ?? '-'}</div></div>
        <div class="kpi"><div class="label">적중률 1위</div><div class="val" style="font-size:15px">${ins.bestHitRate ? ins.bestHitRate.key + ' ' + Math.round(ins.bestHitRate.hitRate * 100) + '%' : '-'}</div></div>
      </div>
      <div class="panel"><h3>🟢 매수 TOP 5</h3>${topTable(res.buy)}</div>
      <div class="panel"><h3>🔴 매도 TOP 5</h3>${topTable(res.sell)}</div>`
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
        <tbody>${list.map((x) => `<tr class="clickable" onclick="location.hash='#/analyze?market=${x.market}'">
          <td>${x.korean_name}</td><td>${x.market.replace('KRW-', '')}</td><td>${x.score}</td>
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
    const market = new URLSearchParams((location.hash.split('?')[1] || '')).get('market') || ''
    view.innerHTML = `<h2>개별 분석</h2>
      <div class="controls">
        <input id="mkt" placeholder="KRW-BTC" value="${market}" style="width:160px">
        <button id="goBtn">분석</button>
        <span class="seg active" data-tf="day">일봉</span>
        <span class="seg" data-tf="4h">4시간</span>
        <span class="seg" data-tf="1h">1시간</span>
        <span class="seg active" data-ct="candle">캔들</span>
        <span class="seg" data-ct="line">라인</span>
      </div>
      <div class="panel"><div id="chart"></div></div>
      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div class="panel" style="flex:1;min-width:260px"><h3>지표</h3><div id="ind" class="muted">종목을 입력하세요</div></div>
        <div class="panel" style="flex:1;min-width:260px"><h3>🕯️ 캔들 모양분석</h3><div id="cp" class="muted">-</div></div>
      </div>
      <div class="panel"><h3>종합 신호</h3><div id="sig" class="muted">-</div></div>`
    let tf = 'day', ct = 'candle', cache = null
    const draw = () => {
      if (!cache) return
      if (ct === 'candle') Charts.candle($('#chart'), cache.ohlcv)
      else Charts.line($('#chart'), cache.ohlcv.map((c) => c.close))
    }
    const load = async () => {
      const mkt = $('#mkt').value.trim().toUpperCase()
      if (!/^KRW-[A-Z0-9]+$/.test(mkt)) { $('#ind').textContent = '잘못된 마켓 코드'; return }
      $('#ind').textContent = '불러오는 중…'
      const r = await api(`/api/analyze?market=${mkt}&tf=${tf}`)
      if (r.error) { $('#ind').textContent = '조회 실패: ' + r.error; return }
      cache = r; draw()
      const ind = r.indicators
      $('#ind').innerHTML = `현재가 <b>${fmt(ind.price)}</b><br>
        RSI ${ind.rsi?.toFixed(1) ?? '-'} · Stoch K ${ind.stoch?.k.toFixed(1) ?? '-'} D ${ind.stoch?.d.toFixed(1) ?? '-'}<br>
        MACD hist ${ind.macd?.hist.toFixed(2) ?? '-'} · WR ${ind.wr?.toFixed(1) ?? '-'}<br>
        EMA20 ${fmt(ind.ema20?.toFixed(2))} / EMA50 ${fmt(ind.ema50?.toFixed(2))} · Vol ${ind.volRatio?.toFixed(2) ?? '-'}x`
      const cp = r.candlePatterns
      $('#cp').innerHTML = [
        ...cp.bullish.map((p) => `<div class="tag good">▲ ${p}</div>`),
        ...cp.bearish.map((p) => `<div class="tag warn">▼ ${p}</div>`),
        ...cp.neutral.map((p) => `<div class="tag">· ${p}</div>`),
      ].join(' ') || '<span class="muted">감지된 패턴 없음</span>'
      $('#sig').innerHTML = `매수: ${r.buy.join(', ') || '없음'} <b>(${r.buyScore.toFixed(1)})</b><br>매도: ${r.sell.join(', ') || '없음'} <b>(${r.sellScore.toFixed(1)})</b>`
    }
    view.querySelectorAll('[data-tf]').forEach((el) => el.onclick = () => {
      tf = el.dataset.tf; view.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('active', x === el)); load()
    })
    view.querySelectorAll('[data-ct]').forEach((el) => el.onclick = () => {
      ct = el.dataset.ct; view.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('active', x === el)); draw()
    })
    $('#goBtn').onclick = load
    if (market) load()
  },
}

function topTable(list = []) {
  if (!list.length) return '<p class="muted">없음</p>'
  return `<table><tbody>${list.slice(0, 5).map((x) => `
    <tr class="clickable" onclick="location.hash='#/analyze?market=${x.market}'">
      <td>${x.korean_name}</td><td>${x.market.replace('KRW-', '')}</td>
      <td>${x.score}</td><td>${signalTags(x.signals)}</td>
    </tr>`).join('')}</tbody></table>`
}

async function runScan() {
  const btn = $('#scanBtn'); const prog = $('#scanProgress')
  btn.disabled = true
  const { jobId } = await api('/api/scan', { method: 'POST' })
  prog.innerHTML = '<div class="bar"><div style="width:5%"></div></div><p class="muted">스캔 중…</p>'
  const timer = setInterval(async () => {
    const job = await api('/api/scan/' + jobId)
    $('.bar > div', prog).style.width = (job.progress || 0) + '%'
    if (job.status === 'done') { clearInterval(timer); btn.disabled = false; routes.dashboard() }
    if (job.status === 'error') { clearInterval(timer); btn.disabled = false; prog.innerHTML = '<p class="muted">스캔 실패</p>' }
  }, 1500)
}

function router() {
  const hash = location.hash || '#/dashboard'
  const name = hash.slice(2).split('?')[0]
  ;(routes[name] || routes.dashboard)()
}
window.addEventListener('hashchange', router)
window.addEventListener('DOMContentLoaded', router)
