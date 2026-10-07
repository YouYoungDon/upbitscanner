// lib/news/store.mjs
// news-watch 상태(순수 갱신)와 측정용 jsonl 로그.
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from '../store.mjs'

const DAY = 86400000, H = 3600000

export function emptyState() {
  return { initialized: false, seen: {}, alerted: {}, sourceFail: {}, lastFetchAt: {}, lastLoopAt: null }
}

const keepNewer = (obj, cutoff) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => Date.parse(v) >= cutoff))

export function pruneState(state, nowMs) {
  return { ...state, seen: keepNewer(state.seen, nowMs - 7 * DAY), alerted: keepNewer(state.alerted, nowMs - 6 * H) }
}

export function newItems(items, state) {
  const out = [], ids = new Set()
  for (const it of items) {
    if (state.seen?.[it.id] || ids.has(it.id)) continue
    ids.add(it.id); out.push(it)
  }
  return out
}

export function markSeen(state, items, nowMs) {
  const iso = new Date(nowMs).toISOString()
  const seen = { ...state.seen }
  for (const it of items) seen[it.id] = iso // 마지막으로 피드에서 본 시각(가지치기 기준)
  return { ...state, seen }
}

export async function appendNewsLog(records, { dir = DATA_DIR } = {}) {
  if (!records.length) return
  await mkdir(dir, { recursive: true })
  await appendFile(join(dir, 'news-log.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}
