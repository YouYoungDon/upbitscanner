// lib/news/sources/exchanges.mjs
// 기존 업비트·바이낸스 공지 페처({id,title,ts}[] | null)를 NewsItem으로 감싼다.
import { fetchUpbitAnnouncements } from '../../exchange-events.mjs'
import { fetchBinanceAnnouncements } from '../../binance.mjs'

const isoOrNull = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }
const wrap = (source) => (list) => list.map((a) => ({
  id: a.id, source, title: String(a.title ?? ''), body: null, ts: isoOrNull(a.ts), url: null, important: false, codes: [],
}))

export async function fetchUpbitNews({ fetchAnn = () => fetchUpbitAnnouncements({ pages: 1 }) } = {}) {
  try { const l = await fetchAnn(); return l ? wrap('upbit')(l) : null } catch { return null }
}

// 48 = 신규 상장(New Cryptocurrency Listing) 카탈로그. 161/157은 기존 상폐·입출금중단.
export async function fetchBinanceNews({ fetchAnn = () => fetchBinanceAnnouncements({ catalogIds: [161, 157, 48] }) } = {}) {
  try { const l = await fetchAnn(); return l ? wrap('binance')(l) : null } catch { return null }
}
