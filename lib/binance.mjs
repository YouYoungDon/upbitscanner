// 바이낸스 공개 API — 현물 시세(USDT 페어). 키 불필요. 실패 시 null(스캔 무중단).
const BASE = process.env.BINANCE_API_BASE || 'https://api.binance.com'
const FBASE = process.env.BINANCE_FAPI_BASE || 'https://fapi.binance.com' // 무기한선물(futures)

// 전체 심볼 현재가 1콜 → Map<symbol, price>. USDT 페어만 필터. 실패 시 null.
export async function fetchBinancePrices({ timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(`${BASE}/api/v3/ticker/price`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const rows = await r.json()
    if (!Array.isArray(rows)) return null
    const out = new Map()
    for (const row of rows) {
      const sym = row?.symbol
      const price = Number(row?.price)
      if (typeof sym === 'string' && sym.endsWith('USDT') && Number.isFinite(price)) {
        out.set(sym, price)
      }
    }
    return out
  } catch {
    return null
  }
}

// 무기한선물 펀딩비 1콜 → Map<symbol, {rate, markPrice}>. lastFundingRate=정산된 최근 8h. 실패 시 null.
export async function fetchFundingRates({ timeoutMs = 8000 } = {}) {
  try {
    const r = await fetch(`${FBASE}/fapi/v1/premiumIndex`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const rows = await r.json()
    if (!Array.isArray(rows)) return null
    const out = new Map()
    for (const row of rows) {
      const sym = row?.symbol
      const rate = Number(row?.lastFundingRate)
      if (typeof sym === 'string' && sym.endsWith('USDT') && Number.isFinite(rate)) {
        out.set(sym, { rate, markPrice: Number(row?.markPrice) })
      }
    }
    return out
  } catch {
    return null
  }
}

// 바이낸스 공지(비공식 bapi CMS) — 상폐/입출금중단·마이그레이션 카탈로그. 레이트리밋·포맷변경에 취약 → 실패 시 null(업비트만으로 degrade).
// catalogIds: Task2 Step1 프로브로 확정(2026-09-08, 레이트리밋 없이 실데이터 확인).
//   161 = 상폐(Delisting/거래쌍 제거), 157 = 입출금중단·마이그레이션(네트워크 지원 종료).
// 실API 응답은 `data.articles`(플랫 배열)이며 브리핑 예시의 `data.catalogs[0].articles`와 다름 — 두 경로 모두 방어적으로 시도.
// articles에 releaseDate/publishDate 필드가 채워지지 않는 경우가 흔해 ts는 null일 수 있다(오케스트레이터가 now로 폴백).
export async function fetchBinanceAnnouncements({ catalogIds = [161, 157], timeoutMs = 8000 } = {}) {
  try {
    const out = []
    for (const cid of catalogIds) {
      const r = await fetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=${cid}&pageNo=1&pageSize=20`,
        { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'en', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      if (!r.ok) continue
      const d = await r.json()
      const arts = d?.data?.articles || d?.data?.catalogs?.[0]?.articles || []
      for (const a of arts) {
        // 날짜 정규화 — 파싱 불가한 값(잘못된 형식 등)에 new Date().toISOString()이 RangeError를
        // 던져 outer catch로 빠지면 양 카탈로그 공지 전체가 소실된다. NaN 방어로 null 폴백.
        const rawTs = a.releaseDate || a.publishDate
        let ts = null
        if (rawTs != null) { const dt = new Date(rawTs); if (!Number.isNaN(dt.getTime())) ts = dt.toISOString() }
        out.push({ id: `binance:${a.id}`, title: a.title, ts })
      }
    }
    return out.length ? out : null
  } catch { return null }
}
