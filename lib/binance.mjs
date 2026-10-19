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
// 실패 사유는 onFail({ catalogId, status?, contentType?, snippet?, error? })로 알린다 — 2026-10-19 바이낸스 공지가
// 10-08 이후 거의 매일 수 시간~40시간 끊겼는데 이유가 남지 않아 원인을 알 수 없었다. 카탈로그마다 따로 시도해
// 하나가 실패해도 나머지 공지는 살린다(예전엔 하나만 예외가 나도 전체가 null).
export async function fetchBinanceAnnouncements({ catalogIds = [161, 157], timeoutMs = 8000, fetchFn = fetch, onFail = () => {}, onOk = () => {} } = {}) {
  const out = []
  for (const cid of catalogIds) {
    try {
      const r = await fetchFn(`https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=${cid}&pageNo=1&pageSize=20`,
        { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'en', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      const contentType = r.headers?.get?.('content-type') ?? null
      const body = await r.text()
      if (!r.ok) { onFail({ catalogId: cid, status: r.status, contentType, snippet: body.slice(0, 160) }); continue }
      let d
      try { d = JSON.parse(body) } catch { onFail({ catalogId: cid, status: r.status, contentType, snippet: body.slice(0, 160) }); continue }
      const arts = d?.data?.articles || d?.data?.catalogs?.[0]?.articles || []
      if (!arts.length) onFail({ catalogId: cid, status: r.status, contentType, snippet: body.slice(0, 160) })
      else onOk(cid)
      for (const a of arts) {
        // 날짜 정규화 — 파싱 불가한 값에 new Date().toISOString()이 RangeError를 던지지 않게 NaN 방어로 null 폴백.
        const rawTs = a.releaseDate || a.publishDate
        let ts = null
        if (rawTs != null) { const dt = new Date(rawTs); if (!Number.isNaN(dt.getTime())) ts = dt.toISOString() }
        out.push({ id: `binance:${a.id}`, title: a.title, ts })
      }
    } catch (e) {
      onFail({ catalogId: cid, error: `${e?.name ?? 'Error'}: ${e?.message ?? e}` })
    }
  }
  return out.length ? out : null
}
