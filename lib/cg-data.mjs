// 코인게코 심볼 매핑·시세 캐시 (파일: data/coingecko-map.json, data/coingecko-cache.json)
export const CACHE_TTL_MS = 150 * 60 * 1000     // 150분: 3시간 사이클 첫 스캐너만 갱신
export const MAP_TTL_MS = 7 * 24 * 3600 * 1000  // 매핑은 주 1회 재구축

// 업비트 심볼(소문자)별 코인게코 id 후보. 매칭 없으면 빈 배열(→ null 매핑으로 재시도 억제).
export function candidatesBySymbol(upbitMarkets, coinsList) {
  const bySym = {}
  for (const m of upbitMarkets) bySym[m.split('-')[1].toLowerCase()] = []
  for (const c of coinsList) {
    const s = (c.symbol || '').toLowerCase()
    if (s in bySym) bySym[s].push(c.id)
  }
  return bySym
}

// 동일 심볼 충돌: market_cap_rank 최저(순위 최고) 승, rank null 후순위, 동률은 mcap 큰 쪽.
export function resolveCollisions(upbitMarkets, candidates, marketRows) {
  const rowOf = Object.fromEntries((marketRows || []).map((r) => [r.id, r]))
  const out = {}
  for (const m of upbitMarkets) {
    const ids = (candidates[m.split('-')[1].toLowerCase()] || []).filter((id) => rowOf[id])
    ids.sort((a, b) => {
      const ra = rowOf[a].market_cap_rank ?? Infinity, rb = rowOf[b].market_cap_rank ?? Infinity
      return ra - rb || (rowOf[b].market_cap ?? 0) - (rowOf[a].market_cap ?? 0)
    })
    out[m] = ids[0] ?? null
  }
  return out
}

// fetchedAt/builtAt 기준 TTL 판정. 필드 없음·파싱 불가 → stale.
export function isFresh(obj, ttlMs, now = Date.now()) {
  const t = Date.parse(obj?.fetchedAt ?? obj?.builtAt ?? '')
  return Number.isFinite(t) && now - t < ttlMs
}
