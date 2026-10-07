// lib/news/sources/coinness.mjs
// 코인니스 속보(공개 JSON API, 2026-10-07 확인). v3는 limit=30 지원, 페이지 넘김 없이 최신 30건.
const URL_V3 = 'https://api.coinness.com/feed/v3/breaking-news?languageCode=ko&limit=30'

const isoOrNull = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }

export function parseCoinness(arr) {
  return arr.map((x) => ({
    id: `coinness:${x.id}`,
    source: 'coinness',
    title: String(x.title ?? ''),
    body: x.content ?? null,
    ts: isoOrNull(x.publishAt),
    url: x.link ?? null,
    important: x.isImportant === true,
    codes: (x.originCodes || []).map((c) => String(c).toUpperCase()),
  }))
}

export async function fetchCoinness({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetchImpl(URL_V3, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d) ? parseCoinness(d) : null
  } catch { return null }
}
