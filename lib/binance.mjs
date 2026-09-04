// 바이낸스 공개 API — 현물 시세(USDT 페어). 키 불필요. 실패 시 null(스캔 무중단).
const BASE = process.env.BINANCE_API_BASE || 'https://api.binance.com'

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
