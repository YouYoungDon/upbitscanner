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
