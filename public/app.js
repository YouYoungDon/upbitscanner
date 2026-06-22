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
  document.querySelectorAll('.menu a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab))
}

// 투자유의 배지: warning(경고)·caution(주의). 종목명 옆에 표기.
function warnBadge(x) {
  if (!x || !x.warn) return ''
  return x.warn === 'warning'
    ? '<span class="badge badge-error badge-xs gap-0.5" title="투자유의 경고(상폐심사급)">⚠️경고</span>'
    : '<span class="badge badge-warning badge-xs gap-0.5" title="투자주의(가격/거래량 이상)">⚠️유의</span>'
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
  async home() {
    setActiveTab('home')
    view.innerHTML = '<span class="loading loading-spinner"></span>'
    let res, mom, flow, pos, ins
    try {
      [res, mom, flow, pos, ins] = await Promise.all([
        api('/api/results'), api('/api/momentum'), api('/api/flow'), api('/api/positions'), api('/api/insights'),
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

    // KPI 한 줄 (매수/매도/누적스캔) + 인사이트(최다신호·적중률1위)
    const kpi = res.kpi || {}
    const kpiLine = `매수 <b class="text-success">${kpi.buyCount ?? 0}</b> · 매도 <b class="text-error">${kpi.sellCount ?? 0}</b> · 누적 <b>${fmt(kpi.totalScans ?? 0)}</b>스캔`
    const insLine = [
      ins?.topSignal ? `최다신호 <span class="badge badge-ghost badge-sm">${esc(ins.topSignal.key || ins.topSignal)}${ins.topSignal.count ? ' ×' + ins.topSignal.count : ''}</span>` : '',
      ins?.bestHitRate ? `적중률1위 <span class="badge badge-success badge-sm">${esc(ins.bestHitRate.key)} ${Math.round((ins.bestHitRate.hitRate || 0) * 100)}%</span>` : '',
    ].filter(Boolean).join(' · ')

    const positions = pos.positions || []
    const posBar = !positions.length ? '' : `
      <div class="card bg-base-200 shadow mb-3"><div class="card-body p-3">
        <h3 class="card-title text-sm">💼 포지션</h3>
        <div class="flex flex-wrap gap-3">${positions.map((p) => {
          const pl = p.plPct == null ? '-' : `<span class="${p.plPct >= 0 ? 'text-success' : 'text-error'}">${p.plPct >= 0 ? '+' : ''}${p.plPct}%</span>`
          const st = p.hitSL ? '<span class="badge badge-error badge-sm">SL도달</span>' : p.hitTP ? '<span class="badge badge-success badge-sm">TP도달</span>' : `<span class="opacity-60 text-xs">SL까지 ${p.toSLPct == null ? '-' : p.toSLPct + '%'}</span>`
          const levels = `<span class="opacity-50 text-xs">진입 ${fmt(p.entry)}${p.stopLoss != null ? ' · SL ' + fmt(p.stopLoss) : ''}${p.takeProfit != null ? ' · TP ' + fmt(p.takeProfit) : ''}</span>`
          return `<div class="cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(p.market)}'"><span class="font-medium">${esc(p.korean_name || p.market)}</span> ${fmt(p.price)} ${pl} ${st}<br>${levels}</div>`
        }).join('')}</div>
      </div></div>`

    const momRows = (mom.picks || []).slice(0, 8).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td><span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)}</td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td>${signalTags(x.signals)}</td>
      </tr>`).join('') || '<tr><td colspan="3" class="opacity-60 text-xs">스캔 대기</td></tr>'

    const flowEmoji = { strong: '🔴', attention: '🟠', watch: '🟡' }
    const pct = (v) => v == null ? '' : `<span class="${v >= 0 ? 'text-success' : 'text-error'}">${v >= 0 ? '+' : ''}${v}%</span>`
    const flowRows = (flow.picks || []).slice(0, 8).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td>${flowEmoji[x.level] || ''} <span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)} ${x.breakout ? '<span class="badge badge-warning badge-xs">돌파</span>' : ''}</td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td class="text-xs opacity-70">${x.ratio == null ? '' : x.ratio + 'x'}</td>
        <td class="text-xs">${pct(x.ch1m)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="opacity-60 text-xs">스캔 대기</td></tr>'
    const flowDetail = (flow.picks || []).length
      ? `<details class="mt-1"><summary class="text-xs opacity-60 cursor-pointer">📊 상세 지표 ${flow.picks.length}개</summary>${flowDetailTable(flow.picks)}</details>`
      : ''

    const lowLiq = res.buyLowLiq || []
    const sell = res.sell || []
    const buyAll = res.buy || []

    view.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-2xl font-bold">🏠 종합</h2>
        <button id="scanBtn" class="btn btn-primary btn-sm">🔄 수동 스캔</button>
      </div>
      <p class="opacity-70 text-sm">${kpiLine} ${regime} ${stale ? '<span class="badge badge-warning badge-sm">⏰ 스캔지연</span>' : ''}</p>
      <p class="opacity-60 text-xs mb-1">${lastScans}${insLine ? ' · ' + insLine : ''}</p>
      <div id="scanProgress" class="mb-3"></div>
      ${posBar}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="card bg-base-200 shadow"><div class="card-body p-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="card-title text-sm">🟢 반등 TOP</h3>
            <input id="reboundSearch" class="input input-bordered input-xs w-28" placeholder="🔎 종목">
          </div>
          <div id="reboundBody">${topTable(buyAll.slice(0, 8), 8)}</div>
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
          ${flowDetail}
        </div></div>
      </div>`
    $('#scanBtn').onclick = runScan
    // 반등 카드 실시간 필터 (종목명·티커). 빈 검색이면 TOP8.
    const rs = $('#reboundSearch')
    rs.oninput = () => {
      const q = rs.value.trim(), up = q.toUpperCase()
      const list = !q ? buyAll.slice(0, 8)
        : buyAll.filter((x) => (x.korean_name || '').includes(q) || (x.market || '').includes(up) || (x.market || '').replace('KRW-', '').includes(up))
      $('#reboundBody').innerHTML = topTable(list, 99)
    }
  },

  async analyze() {
    setActiveTab('analyze')
    let selected = new URLSearchParams((location.hash.split('?')[1] || '')).get('market') || ''
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
    let tf = 'day', ct = 'candle', cache = null
    if (!marketsList) { try { marketsList = await api('/api/markets') } catch { marketsList = [] } }
    const nameOf = Object.fromEntries((marketsList || []).map((m) => [m.market, m.korean_name]))
    const renderList = (q = '') => {
      const qq = q.trim(), up = qq.toUpperCase()
      const list = (marketsList || []).filter((m) => !qq || m.korean_name.includes(qq) || m.market.includes(up) || m.market.replace('KRW-', '').includes(up))
      $('#coinCount').textContent = `(${list.length})`
      $('#coinlist').innerHTML = list.map((m) =>
        `<div class="coin-row${m.market === selected ? ' active' : ''}" data-market="${m.market}">${esc(m.korean_name)} <span class="opacity-60 text-xs">${esc(m.market.replace('KRW-', ''))}</span></div>`,
      ).join('') || '<span class="opacity-60 text-xs">결과 없음</span>'
      $('#coinlist').querySelectorAll('.coin-row').forEach((row) => { row.onclick = () => { selected = row.dataset.market; renderList($('#search').value); load() } })
    }
    const draw = () => {
      if (!cache) return
      if (ct === 'candle') Charts.candle($('#chart'), cache.ohlcv)
      else Charts.line($('#chart'), cache.ohlcv.map((c) => c.close))
    }
    const load = async () => {
      if (!selected) return
      $('#title').innerHTML = `<b>${esc(nameOf[selected] || '')}</b> <span class="opacity-60 text-xs">${esc(selected)}</span>`
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
        ...cp.bullish.map((p) => `<span class="badge badge-success gap-1 m-0.5">▲ ${esc(p)}</span>`),
        ...cp.bearish.map((p) => `<span class="badge badge-error gap-1 m-0.5">▼ ${esc(p)}</span>`),
        ...cp.neutral.map((p) => `<span class="badge badge-ghost gap-1 m-0.5">· ${esc(p)}</span>`),
      ].join(' ') || '<span class="opacity-60">감지된 패턴 없음</span>'
      $('#sig').innerHTML = scoreBreakdownHtml(r)
    }
    view.querySelectorAll('[data-tf]').forEach((el) => el.onclick = () => {
      tf = el.dataset.tf; view.querySelectorAll('[data-tf]').forEach((x) => x.classList.toggle('btn-active', x === el)); load()
    })
    view.querySelectorAll('[data-ct]').forEach((el) => el.onclick = () => {
      ct = el.dataset.ct; view.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('btn-active', x === el)); draw()
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
      const [v, res, hist] = await Promise.all([
        api('/api/verify'), api('/api/results'), api('/api/history'),
      ])
      if (!$('#rSegVerify')?.classList.contains('btn-active')) return // 그새 기록 탭으로 전환됐으면 중단(레이스 방지)
      const bar = (rate) => `<progress class="progress progress-success w-24 align-middle" value="${Math.round((rate || 0) * 100)}" max="100"></progress>`
      const retCell = (ar) => ar == null ? '-' : `<span class="${ar >= 0 ? 'text-success' : 'text-error'}">${ar >= 0 ? '+' : ''}${ar}%</span>`
      const statsRows = Object.entries(v.signalStats || {})
        .sort((a, b) => (b[1].hitRate) - (a[1].hitRate))
        .map(([k, s]) => `<tr><td>${esc(k)}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}% ${bar(s.hitRate)}</td><td>${retCell(s.avgReturn)}</td><td><span class="badge badge-ghost badge-sm">${(v.weights?.[k] ?? 1).toFixed(2)}</span></td></tr>`).join('')
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
      const cd = res.comboDist || { rebound: 0, trap: 0, volume: 0, mtf: 0 }
      const cs = res.candleSummary || { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] }
      const histArr = Array.isArray(hist) ? hist : []
      const buySpark = Charts.sparkline(histArr.map((h) => h.buyCount), '#36d399')
      const sellSpark = Charts.sparkline(histArr.map((h) => h.sellCount), '#f87272')
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
}

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

function topTable(list = [], n = 10) {
  if (!list.length) return '<p class="opacity-60 text-sm">없음</p>'
  return `<div class="overflow-x-auto"><table class="table table-zebra table-sm">
    <thead><tr><th>종목</th><th>점수</th><th>현재가</th><th>신호</th></tr></thead>
    <tbody>${list.slice(0, n).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td><span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)} <span class="opacity-50 text-xs">${esc(x.market.replace('KRW-', ''))}</span></td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td>${fmt(x.price)}</td>
        <td>${signalTags(x.signals)}</td>
      </tr>`).join('')}</tbody></table></div>`
}

// 개별분석 점수 합산 내역 (기본점수 × 가중치 → 소계 → 콤보 배수 → 합계)
function scoreBreakdownHtml(r) {
  const bd = r.scoreBreakdown
  if (!bd) { // 구버전 응답 호환
    return `매수: ${esc(r.buy.join(', ')) || '없음'} <b>(${r.buyScore.toFixed(1)})</b><br>매도: ${esc(r.sell.join(', ')) || '없음'} <b>(${r.sellScore.toFixed(1)})</b>`
  }
  const side = (b, fullLabels, color, title) => {
    // 점수 없는 정보 라벨([익절]/[콤보] 등 항목·콤보에 안 잡힌 것) 보존
    const shown = new Set([...b.items.map((x) => x.label), ...b.combos.map((c) => c.label)])
    const extras = (fullLabels || []).filter((l) => !shown.has(l))
    if (!b.items.length && !b.combos.length && !extras.length) return `<div class="text-xs opacity-60">${title}: 없음</div>`
    const rows = b.items.map((it) => `
      <tr><td>${esc(it.label)}</td>
        <td class="text-right opacity-70">${(+it.base).toFixed(0)}</td>
        <td class="text-center opacity-70">×${(+it.weight).toFixed(2)}</td>
        <td class="text-right font-medium">${(+it.score).toFixed(2)}</td></tr>`).join('')
    const subtotalRow = b.combos.length ? `
      <tr class="border-t border-base-300"><td class="opacity-60 text-xs" colspan="3">소계</td>
        <td class="text-right opacity-70">${b.subtotal.toFixed(2)}</td></tr>` : ''
    const comboRows = b.combos.map((c) => `
      <tr><td class="${c.mult >= 1 ? 'text-success' : 'text-error'}">${esc(c.label)}</td>
        <td colspan="2" class="text-center opacity-70">×${c.mult.toFixed(2)}</td>
        <td></td></tr>`).join('')
    const table = !b.items.length && !b.combos.length ? '' : `
      <table class="table table-xs">
        <thead><tr><th>신호</th><th class="text-right">기본</th><th class="text-center">가중</th><th class="text-right">점수</th></tr></thead>
        <tbody>${rows}${subtotalRow}${comboRows}</tbody>
        <tfoot><tr class="border-t-2 border-base-300"><td class="font-bold" colspan="3">합계</td>
          <td class="text-right font-bold ${color}">${b.total.toFixed(2)}</td></tr></tfoot>
      </table>`
    const extrasNote = extras.length ? `<div class="text-xs opacity-50 mt-1">ℹ️ ${extras.map(esc).join(' · ')}</div>` : ''
    return `
      <div class="font-semibold text-sm ${color} mb-1">${title} <span class="badge badge-sm ${color === 'text-success' ? 'badge-success' : 'badge-error'}">${b.total.toFixed(1)}</span></div>
      ${table}${extrasNote}`
  }
  return `<div class="flex flex-col gap-3">
    <div>${side(bd.buy, r.buy, 'text-success', '🟢 매수')}</div>
    <div>${side(bd.sell, r.sell, 'text-error', '🔴 매도')}</div>
  </div>`
}

// 자금유입 상세 지표 테이블 (구 자금유입 탭의 전체 컬럼)
function flowDetailTable(picks = []) {
  if (!picks.length) return '<p class="opacity-60 text-sm">없음</p>'
  const emoji = { strong: '🔴', attention: '🟠', watch: '🟡' }
  const pct = (v) => v == null ? '-' : `<span class="${v >= 0 ? 'text-success' : 'text-error'}">${v >= 0 ? '+' : ''}${v}%</span>`
  const yn = (b) => b ? '<span class="badge badge-success badge-xs">O</span>' : '<span class="opacity-30">·</span>'
  return `<div class="overflow-x-auto"><table class="table table-zebra table-xs">
    <thead><tr><th>종목</th><th>점수</th><th>머니</th><th>가속</th><th>5분대금</th><th>1분</th><th>5분</th><th>30분</th><th>24h</th><th>돌파</th><th>근접</th><th>EMA</th><th>RSI</th></tr></thead>
    <tbody>${picks.map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td>${emoji[x.level] || ''} <span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)}</td>
        <td><span class="badge badge-primary badge-xs">${x.score}</span></td>
        <td>${x.ratio == null ? '-' : x.ratio + 'x'}</td>
        <td>${x.accel == null ? '-' : x.accel + 'x'}</td>
        <td>${x.value5m == null ? '-' : fmt(Math.round(x.value5m / 1e6)) + 'M'}</td>
        <td>${pct(x.ch1m)}</td><td>${pct(x.ch5m)}</td><td>${pct(x.ch30m)}</td><td>${pct(x.ch24h)}</td>
        <td>${yn(x.breakout)}</td><td>${yn(x.near24h)}</td><td>${yn(x.emaOK)}</td><td>${yn(x.rsi)}</td>
      </tr>`).join('')}</tbody></table></div>`
}

async function runScan() {
  const btn = $('#scanBtn'); const prog = $('#scanProgress')
  btn.disabled = true
  const { jobId, error } = await api('/api/scan', { method: 'POST' })
  if (!jobId) { btn.disabled = false; prog.innerHTML = `<p class="opacity-60 text-xs">스캔 시작 실패${error ? ': ' + esc(error) : ''}</p>`; return }
  prog.innerHTML = '<progress class="progress progress-primary w-full" value="5" max="100"></progress><p class="opacity-60 text-sm">스캔 중…</p>'
  const deadline = Date.now() + 5 * 60 * 1000 // 5분 한도
  const stop = (msg) => { clearInterval(timer); btn.disabled = false; if (msg) prog.innerHTML = `<p class="opacity-60 text-xs">${esc(msg)}</p>` }
  const timer = setInterval(async () => {
    try {
      const job = await api('/api/scan/' + jobId)
      const pb = $('progress', prog)
      if (pb) pb.value = job.progress || 0
      if (job.status === 'done') { clearInterval(timer); btn.disabled = false; routes.home() }
      else if (job.status === 'error') stop('스캔 실패')
      else if (Date.now() > deadline) stop('스캔 시간 초과')
    } catch {
      stop('스캔 상태 조회 실패 (네트워크)')
    }
  }, 1500)
}

function router() {
  const hash = location.hash || '#/home'
  const name = resolveRoute(hash.slice(2).split('?')[0])
  routes[name]()
}
window.addEventListener('hashchange', router)
window.addEventListener('DOMContentLoaded', router)
