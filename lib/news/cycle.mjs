// lib/news/cycle.mjs
// news-watch 한 사이클: 주기 된 소스 수집 → 새 항목 → 매칭·분류 → 로그 → 공식 악재 반영 → 알림.
import { buildMatcher } from './match.mjs'
import { classifyItem } from './classify.mjs'
import { emptyState, pruneState, newItems, markSeen } from './store.mjs'
import { selectAlerts, formatNewsAlert } from './route.mjs'

export const SOURCE_EVERY_MS = { coinness: 60000, upbit: 60000, bithumb: 120000, binance: 300000 }
export const FAIL_NOTIFY_MS = 30 * 60000
const SRC_KO = { coinness: '코인니스', upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }
const OFFICIAL = ['upbit', 'binance', 'bithumb']

export async function runCycle({ state: raw, nowMs, deps }) {
  let state = { ...emptyState(), ...(raw || {}) }
  const due = Object.keys(SOURCE_EVERY_MS).filter((s) => {
    const last = Date.parse(state.lastFetchAt?.[s] ?? '')
    return !Number.isFinite(last) || nowMs - last >= SOURCE_EVERY_MS[s] - 5000
  })
  const results = {}
  await Promise.all(due.map(async (s) => { results[s] = await deps.fetchers[s]().catch(() => null) }))

  const iso = new Date(nowMs).toISOString()
  const lastFetchAt = { ...state.lastFetchAt }, sourceFail = { ...state.sourceFail }
  const notices = []
  for (const s of due) {
    lastFetchAt[s] = iso
    if (results[s] == null) {
      const f = sourceFail[s] || { since: iso, notified: false }
      if (!f.notified && nowMs - Date.parse(f.since) >= FAIL_NOTIFY_MS) { notices.push(`⚠️뉴스 소스 중단: ${SRC_KO[s]}`); sourceFail[s] = { ...f, notified: true } }
      else sourceFail[s] = f
    } else if (sourceFail[s]) {
      if (sourceFail[s].notified) notices.push(`✅ 뉴스 소스 회복: ${SRC_KO[s]}`)
      delete sourceFail[s]
    }
  }
  state = { ...state, lastFetchAt, sourceFail }

  const items = due.flatMap((s) => results[s] || [])
  const fresh = newItems(items, state)
  const markets = await deps.getMarkets()
  const match = buildMatcher(markets)
  const recs = fresh.map((item) => ({ item, ...match(item), ...classifyItem(item) }))
  await deps.appendLog(recs.map((r) => ({
    ts: r.item.ts, seenAt: iso, source: r.item.source, id: r.item.id, title: r.item.title, url: r.item.url,
    markets: r.markets, via: r.via, kind: r.kind, type: r.type, tags: r.tags, important: r.item.important,
  })))

  const ctx = await deps.readCtx()
  if (OFFICIAL.some((s) => results[s] != null)) {
    const asAnn = (s) => async () => (results[s] == null ? null : results[s].map((x) => ({ id: x.id, title: x.title, ts: x.ts })))
    await deps.ensureEvents(markets.map((m) => m.market), {
      positions: ctx.positions || [], alerting: false,
      deps: { fetchUpbitAnnouncements: asAnn('upbit'), fetchBinanceAnnouncements: asAnn('binance'), fetchBithumbAnnouncements: asAnn('bithumb') },
    }).catch(() => null)
  }

  let sent = 0
  if (!state.initialized) {
    state = { ...markSeen(state, fresh, nowMs), initialized: true }
  } else {
    const { alerts, keys } = selectAlerts(recs, ctx, state, nowMs)
    state = markSeen(state, fresh, nowMs)
    if (alerts.length || notices.length) {
      const ok = await deps.send(formatNewsAlert(alerts, deps.whenLabel(nowMs), notices))
      if (ok) {
        sent = alerts.length
        const alerted = { ...state.alerted }
        for (const k of keys) alerted[k] = iso
        state = { ...state, alerted }
      }
    }
  }
  state = pruneState({ ...state, lastLoopAt: iso }, nowMs)
  return { state, sent, newCount: fresh.length, notices }
}
