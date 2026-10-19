// lib/news/sources/exchanges.mjs
// 기존 업비트·바이낸스 공지 페처({id,title,ts}[] | null)를 NewsItem으로 감싼다.
import { fetchUpbitAnnouncements } from '../../exchange-events.mjs'
import { fetchBinanceAnnouncements } from '../../binance.mjs'

const isoOrNull = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }
// 바이낸스 선물 상장 제목은 'SOPHUSDT Perpetual'처럼 티커가 USDT에 붙어 있어 매처가 못 잡는다 → 코드로 추출.
const usdtPairCodes = (title) => [...new Set([...String(title).matchAll(/(?<![A-Za-z0-9])([A-Z0-9]{2,15})USDT(?![A-Za-z0-9])/g)].map((m) => m[1]))]
const wrap = (source) => (list) => list.map((a) => ({
  id: a.id, source, title: String(a.title ?? ''), body: null, ts: isoOrNull(a.ts), url: null, important: false,
  codes: source === 'binance' ? usdtPairCodes(a.title) : [],
}))

export async function fetchUpbitNews({ fetchAnn = () => fetchUpbitAnnouncements({ pages: 1 }) } = {}) {
  try { const l = await fetchAnn(); return l ? wrap('upbit')(l) : null } catch { return null }
}

// 바이낸스 공지 실패 사유를 데몬 로그(UpbitNewsWatch.log)에 남긴다 — 카탈로그마다 같은 사유는 장애 한 번에 한 줄.
// 그 카탈로그가 다시 성공하면 기억을 지워, 다음 장애 때 다시 남긴다(2026-10-19 리뷰: 키 하나만 기억해 161/157/48이
// 같은 사유로 실패하면 5분마다 3줄씩 쌓였다).
const lastFail = new Map()
export const clearBinanceFail = (catalogId) => lastFail.delete(catalogId)
export const resetBinanceFailLog = () => lastFail.clear()
export function logBinanceFail(f, { log = console.log, now = () => new Date().toISOString() } = {}) {
  const reason = f.error ?? `status ${f.status} ${f.contentType ?? '-'} ${String(f.snippet ?? '').replace(/\s+/g, ' ').slice(0, 120)}`
  if (lastFail.get(f.catalogId) === reason) return false
  lastFail.set(f.catalogId, reason)
  log(`${now()} 바이낸스 공지 실패 catalog ${f.catalogId}: ${reason}`)
  return true
}

// 48 = 신규 상장(New Cryptocurrency Listing) 카탈로그. 161/157은 기존 상폐·입출금중단.
export async function fetchBinanceNews({ fetchAnn = () => fetchBinanceAnnouncements({ catalogIds: [161, 157, 48], onFail: (f) => logBinanceFail(f), onOk: clearBinanceFail }) } = {}) {
  try { const l = await fetchAnn(); return l ? wrap('binance')(l) : null } catch { return null }
}
