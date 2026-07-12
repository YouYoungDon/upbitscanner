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

// 코인게코 글로벌 배지: 업비트 거래 비중(dominance) + 글로벌 컨텍스트 툴팁
function cgBadge(x) {
  if (!x || !x.dominance || x.dominance.share == null) return ''
  const pct = Math.round(x.dominance.share * 100)
  const cls = x.dominance.share >= 0.8 ? 'badge-error' : x.dominance.share >= 0.5 ? 'badge-warning' : 'badge-ghost'
  const label = x.dominance.share >= 0.8 ? `🌐단독 ${pct}%` : x.dominance.share >= 0.5 ? `🌐비중 ${pct}%` : `🌐 ${pct}%`
  const cg = x.cg || {}
  const tip = [
    `글로벌 대비 업비트 거래 비중 ${pct}%`,
    cg.rank != null ? `시총 ${cg.rank}위` : '',
    cg.circRatio != null ? `유통 ${Math.round(cg.circRatio * 100)}%` : '',
    cg.athChangePct != null ? `ATH ${cg.athChangePct.toFixed(1)}%` : '',
  ].filter(Boolean).join(' · ')
  return `<span class="badge ${cls} badge-xs gap-0.5" title="${tip}">${label}</span>`
}

function signalTags(signals) {
  return (signals || []).map((s) => {
    if (s.includes('업비트단독')) return `<span class="badge badge-error badge-sm" title="글로벌 대비 업비트 거래 비중 — 국내 단독 점화 의심, 점수 ×0.8">${esc(s.replace('⚠️', ''))}</span>`
    if (s.includes('업비트비중')) return `<span class="badge badge-warning badge-sm" title="글로벌 대비 업비트 거래 비중 높음, 점수 ×0.9">${esc(s.replace('⚠️', ''))}</span>`
    if (s.includes('골든크로스')) return '<span class="badge badge-success badge-sm">GC</span>'
    if (s.includes('[MTF]')) return '<span class="badge badge-info badge-sm">MTF</span>'
    if (s.includes('함정')) return '<span class="badge badge-error badge-sm">함정</span>'
    if (s.includes('떨어지는칼')) return '<span class="badge badge-error badge-sm">🔪칼</span>'
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
    let res, mom, flow, pos, ins, rec
    try {
      [res, mom, flow, pos, ins, rec] = await Promise.all([
        api('/api/results'), api('/api/momentum'), api('/api/flow'), api('/api/positions'), api('/api/insights'), api('/api/recommend'),
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

    // KPI 스탯 타일 (매수/매도/누적/커버리지/레짐)
    const kpi = res.kpi || {}
    const cov = res.cgCoverage != null && res.cgCoverage > 0 ? Math.round(res.cgCoverage * 100) + '%' : null
    const regimeBadge = res.regime
      ? `<span class="badge badge-sm ${res.regime.label === '확장' ? 'badge-success' : res.regime.label === '수축' ? 'badge-error' : 'badge-warning'}">${res.regime.emoji} ${esc(res.regime.label)}</span>`
      : '-'
    const kpiTile = (label, val, cls = '') => `<div class="kpi-tile"><div class="kpi-label">${label}</div><div class="kpi-val ${cls}">${val}</div></div>`
    const kpiTiles = `<div class="kpi-row">
      ${kpiTile('매수', kpi.buyCount ?? 0, 'up')}
      ${kpiTile('매도', kpi.sellCount ?? 0, 'down')}
      ${kpiTile('누적 스캔', fmt(kpi.totalScans ?? 0))}
      ${cov ? kpiTile('🌐 커버리지', cov + (res.cgReason ? ' <span class="badge badge-warning badge-xs">' + esc(res.cgReason) + '</span>' : '')) : (res.cgReason ? kpiTile('🌐 글로벌', '<span class="text-base font-semibold">' + esc(res.cgReason) + '</span>') : '')}
      ${kpiTile('레짐', regimeBadge)}
      ${stale ? kpiTile('상태', '<span class="badge badge-warning badge-sm">⏰ 지연</span>') : ''}
    </div>`
    const insLine = [
      ins?.topSignal ? `최다신호 <span class="badge badge-ghost badge-sm">${esc(ins.topSignal.key || ins.topSignal)}${ins.topSignal.count ? ' ×' + ins.topSignal.count : ''}</span>` : '',
      ins?.bestHitRate ? `적중률1위 <span class="badge badge-success badge-sm">${esc(ins.bestHitRate.key)} ${Math.round((ins.bestHitRate.hitRate || 0) * 100)}%</span>` : '',
    ].filter(Boolean).join(' · ')

    const positions = pos.positions || []
    const clampPct = (v) => Math.max(0, Math.min(100, v))
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

    const momRows = (mom.picks || []).slice(0, 8).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td><span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)} ${cgBadge(x)}</td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td>${signalTags(x.signals)}</td>
      </tr>`).join('') || '<tr><td colspan="3" class="opacity-60 text-xs">스캔 대기</td></tr>'

    const flowEmoji = { strong: '🔴', attention: '🟠', watch: '🟡' }
    const pct = (v) => v == null ? '' : `<span class="${v >= 0 ? 'text-success' : 'text-error'}">${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%</span>`
    const flowRows = (flow.picks || []).slice(0, 8).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td>${flowEmoji[x.level] || ''} <span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)} ${x.domLabel ? `<span class="badge ${x.domLabel.includes('단독') ? 'badge-error' : 'badge-warning'} badge-xs" title="글로벌 대비 업비트 거래 비중">${esc(x.domLabel.replace('⚠️', '🌐'))}</span>` : cgBadge(x)} ${x.breakout ? '<span class="badge badge-warning badge-xs">돌파</span>' : ''}</td>
        <td><span class="badge badge-primary badge-sm">${x.score}</span></td>
        <td class="text-xs opacity-70">${x.ratio == null ? '' : x.ratio + 'x'}</td>
        <td class="text-xs">${pct(x.ch1m)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="opacity-60 text-xs">스캔 대기</td></tr>'
    const flowDetail = (flow.picks || []).length
      ? `<details class="mt-1"><summary class="text-xs opacity-60 cursor-pointer">📊 상세 지표 ${flow.picks.length}개</summary>${flowDetailTable(flow.picks)}</details>`
      : ''

    const recRows = (list) => (list || []).map((x) => `
      <tr class="hover cursor-pointer" onclick="location.hash='#/analyze?market=${encodeURIComponent(x.market)}'">
        <td><span class="font-medium">${esc(x.korean_name || x.market.replace('KRW-', ''))}</span> ${cgBadge(x)}</td>
        <td><span class="badge badge-neutral badge-sm" title="윈도우 내 매수 등장 횟수">${x.appearances}회</span></td>
        <td class="text-xs opacity-70" title="평균 점수(최고 ${x.maxScore})">avg ${x.avgScore}</td>
      </tr>`).join('') || `<tr><td colspan="3" class="opacity-60 text-xs">누적 데이터 부족 (스캔 ${rec?.totalScans ?? 0}회)</td></tr>`
    const recCard = (title, hint, list) => `
      <div class="card bg-base-200 shadow"><div class="card-body p-3">
        <h3 class="card-title text-sm">${title} <span class="text-xs font-normal opacity-50">${hint}</span></h3>
        <table class="table table-zebra table-sm"><tbody>${recRows(list)}</tbody></table>
      </div></div>`

    const lowLiq = res.buyLowLiq || []
    const sell = res.sell || []
    const buyAll = res.buy || []

    view.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <h2 class="text-2xl font-bold">🏠 종합</h2>
        <button id="scanBtn" class="btn btn-primary btn-sm">🔄 수동 스캔</button>
      </div>
      ${kpiTiles}
      <p class="opacity-70 text-xs mb-3 mt-2">${lastScans}${insLine ? ' · ' + insLine : ''}</p>
      <div id="scanProgress" class="mb-3"></div>
      ${posBar}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        ${recCard('📅 오늘의 추천', '24h 누적 · 등장×평균점수', rec?.daily)}
        ${recCard('📆 이번주 추천', '7일 누적 · 등장×평균점수', rec?.weekly)}
      </div>
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
        <td><span class="font-medium">${esc(x.korean_name)}</span> ${warnBadge(x)} ${cgBadge(x)} <span class="opacity-50 text-xs">${esc(x.market.replace('KRW-', ''))}</span></td>
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
  const pct = (v) => v == null ? '-' : `<span class="${v >= 0 ? 'text-success' : 'text-error'}">${v >= 0 ? '+' : ''}${Math.round(v * 10) / 10}%</span>`
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

window.addEventListener('hashchange', router)
window.addEventListener('DOMContentLoaded', router)
