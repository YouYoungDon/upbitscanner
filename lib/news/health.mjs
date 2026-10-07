// lib/news/health.mjs
// monitor가 정시 스캔 때 news-watch 데몬 생존을 점검(하루 1회 경고).
const STALE_MS = 10 * 60000
const kstDay = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10)

export function newsDaemonStale(newsState, health = {}, nowMs) {
  const last = Date.parse(newsState?.lastLoopAt ?? '')
  if (!Number.isFinite(last) || nowMs - last <= STALE_MS) return { warn: false, health }
  if (health?.warnedDay === kstDay(nowMs)) return { warn: false, health }
  return { warn: true, health: { ...health, warnedDay: kstDay(nowMs) } }
}
