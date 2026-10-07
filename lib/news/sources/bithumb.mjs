// lib/news/sources/bithumb.mjs
// 빗썸 공식 공지 API(2026-10-07 확인). published_at은 KST 'YYYY-MM-DD HH:mm:ss'.
const URL_NOTICES = 'https://api.bithumb.com/v1/notices?count=20'

function kstToIso(s) {
  const t = Date.parse(String(s ?? '').replace(' ', 'T') + '+09:00')
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function parseBithumbNotices(arr) {
  return arr.map((x) => {
    const num = String(x.pc_url ?? '').match(/(\d+)\/?$/)?.[1] ?? String(x.title ?? '')
    return {
      id: `bithumb:${num}`,
      source: 'bithumb',
      title: String(x.title ?? ''),
      body: null,
      ts: kstToIso(x.published_at),
      url: x.pc_url ?? null,
      important: false,
      codes: [],
      categories: Array.isArray(x.categories) ? x.categories : [],
    }
  })
}

export async function fetchBithumbNotices({ fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetchImpl(URL_NOTICES, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = await r.json()
    return Array.isArray(d) ? parseBithumbNotices(d) : null
  } catch { return null }
}
