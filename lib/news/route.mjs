// lib/news/route.mjs
// 알림 대상 판정·중복 묶기·텔레그램 메시지. 상태는 읽기만 한다(전송 성공 후 호출부가 alerted 기록).
export const MAX_LINES = 20
const SIX_H = 6 * 3600000, NEWS_AFTER_OFFICIAL_MS = 30 * 60000
const SRC_KO = { coinness: '코인니스', upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }
const REASON_EMOJI = { listing: '🟢상장', risk: '🚨악재', important: '⭐중요', held: '💼보유', candidate: '🎯후보' }

export function alertReasons(rec, ctx) {
  const held = rec.markets.some((m) => ctx.held.has(m))
  const cand = !held && rec.markets.some((m) => ctx.candidates.has(m))
  const mine = held ? ['held'] : cand ? ['candidate'] : []
  switch (rec.kind) {
    case 'official-listing': return rec.markets.length ? ['listing'] : []
    case 'official-risk': return mine.length ? ['risk', ...mine] : []
    case 'official-clear': return mine
    case 'news': return rec.item.important ? ['important', ...mine] : mine
    default: return []
  }
}

export function alertKey(rec) {
  if (!rec.markets.length) return `id|${rec.item.id}`
  return `${rec.markets[0]}|${rec.kind === 'news' ? 'news' : rec.type}`
}

export function selectAlerts(recs, ctx, state, nowMs) {
  const recent = (key, ms) => { const t = Date.parse(state.alerted?.[key] ?? ''); return Number.isFinite(t) && nowMs - t < ms }
  const officialRecent = (market) => Object.entries(state.alerted || {}).some(([k, v]) =>
    k.startsWith(`${market}|`) && !k.endsWith('|news') && nowMs - Date.parse(v) < NEWS_AFTER_OFFICIAL_MS)
  // 공식 공지를 먼저 처리해야 같은 사이클의 뉴스를 그 코인에 대해 생략할 수 있다.
  const ordered = [...recs].sort((a, b) => (a.kind === 'news') - (b.kind === 'news'))
  const alerts = [], keys = [], officialNow = new Set()
  for (const rec of ordered) {
    const reasons = alertReasons(rec, ctx)
    if (!reasons.length) continue
    const key = alertKey(rec)
    if (keys.includes(key) || recent(key, SIX_H)) continue
    if (rec.kind === 'news' && rec.markets.some((m) => officialNow.has(m) || officialRecent(m))) continue
    if (rec.kind !== 'news') rec.markets.forEach((m) => officialNow.add(m))
    alerts.push({ rec, reasons }); keys.push(key)
  }
  return { alerts, keys }
}

export function formatNewsAlert(alerts, whenLabel, notices = []) {
  const line = ({ rec, reasons }) => {
    const tickers = rec.markets.map((m) => m.replace('KRW-', '')).join(',')
    const tag = rec.tags?.length ? ` [${rec.tags.join('·')}]` : ''
    const title = rec.item.title.length > 120 ? rec.item.title.slice(0, 117) + '…' : rec.item.title
    const showTickers = tickers && !rec.markets.every((m) => title.includes(`(${m.replace('KRW-', '')})`))
    return `${reasons.map((r) => REASON_EMOJI[r]).join('')} · ${SRC_KO[rec.item.source] || rec.item.source} · ${title}${showTickers ? ` (${tickers})` : ''}${tag}`
  }
  // 텔레그램 4096자 제한: 줄당 300자, 전체 3800자 안에서 들어가는 만큼만 싣고 나머지는 "외 N건".
  const head = [`📰 뉴스·공지 (${whenLabel})`], tail = notices.map((n) => n.slice(0, 300))
  let budget = 3800 - [...head, ...tail].join('\n').length
  const shown = []
  for (const a of alerts.slice(0, MAX_LINES)) {
    const l = line(a).slice(0, 300)
    if (l.length + 1 > budget - 20) break
    shown.push(l); budget -= l.length + 1
  }
  if (alerts.length > shown.length) shown.push(`… 외 ${alerts.length - shown.length}건`)
  return [...head, ...shown, ...tail].join('\n')
}
