// lib/news/cycle.mjs
// news-watch 한 사이클: 주기 된 소스 수집 → 새 항목 → 매칭·분류 → 로그 → 공식 악재 반영 → 알림.
import { buildMatcher } from './match.mjs'
import { classifyItem } from './classify.mjs'
import { emptyState, pruneState, newItems, markSeen } from './store.mjs'
import { selectAlerts, formatNewsAlert } from './route.mjs'

export const SOURCE_EVERY_MS = { coinness: 60000, upbit: 60000, bithumb: 120000, binance: 300000 }
export const FAIL_NOTIFY_MS = 30 * 60000
export const PENDING_MS = 30 * 60000 // 전송 실패 알림 재시도 창
const SRC_KO = { coinness: '코인니스', upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }
const OFFICIAL = ['upbit', 'binance', 'bithumb']

// 소스별 "프라이밍"(첫 성공 수집은 seen만, 알림 없음). 예전 상태(initialized만 있음)는 전부 프라이밍된 것으로 본다.
function primedOf(state) {
  if (state.primed) return { ...state.primed }
  return state.initialized ? Object.fromEntries(Object.keys(SOURCE_EVERY_MS).map((s) => [s, true])) : {}
}

export async function runCycle({ state: raw, nowMs, deps }) {
  let state = { ...emptyState(), ...(raw || {}) }
  const primed = primedOf(state)
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
  const label = deps.whenLabel(nowMs)

  // 마켓 목록을 모르면 매칭이 전부 빈 결과가 돼 상장 공지 등을 잃는다 → seen 처리 없이 다음 사이클에 다시 판정.
  const markets = await deps.getMarkets()
  if (!markets || !markets.length) {
    if (notices.length) await deps.send(formatNewsAlert([], label, notices))
    return { state: { ...state, lastLoopAt: iso }, sent: 0, newCount: 0, notices }
  }

  const items = due.flatMap((s) => results[s] || [])
  const fresh = newItems(items, state)
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

  // 이번에 처음 성공한 소스의 항목은 알림 후보에서 뺀다(그 소스의 백로그 = 옛 공지).
  const alertable = recs.filter((r) => primed[r.item.source])
  for (const s of due) if (results[s] != null) primed[s] = true
  // 이번에 받은 모든 항목의 seen을 갱신 — 피드에 남아 있는 한 7일 가지치기로 "새 글"이 되지 않는다.
  state = { ...markSeen(state, items, nowMs), primed, initialized: true }

  const { alerts, keys } = selectAlerts(alertable, ctx, state, nowMs)
  const pendingOld = (state.pending || []).filter((p) => nowMs - Date.parse(p.at) < PENDING_MS)
  const all = []
  for (const p of [...pendingOld, ...alerts.map((a, i) => ({ ...a, key: keys[i], at: iso }))]) {
    if (!all.some((q) => q.key === p.key)) all.push(p)
  }

  let sent = 0, pending = []
  if (all.length || notices.length) {
    const ok = await deps.send(formatNewsAlert(all, label, notices))
    if (ok) {
      sent = all.length
      const alerted = { ...state.alerted }
      for (const p of all) alerted[p.key] = iso
      state = { ...state, alerted }
    } else {
      pending = all.map(({ rec, reasons, key, at }) => ({ rec, reasons, key, at })) // 30분 안에 다시 시도
    }
  }
  state = pruneState({ ...state, pending, lastLoopAt: iso }, nowMs)
  return { state, sent, newCount: fresh.length, notices }
}
