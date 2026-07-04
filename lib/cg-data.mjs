import { readJson, writeJson, withLock } from './store.mjs'
import { loadApiKey, fetchCgMarkets, fetchCgCoinsList } from './coingecko.mjs'

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

// /coins/markets 원본 행 → 캐시 엔트리. circRatio = 유통량 비율(mcap/FDV, 언락 오버행 프록시).
export function toCacheEntry(row) {
  const mcap = row.market_cap ?? null
  const fdv = row.fully_diluted_valuation ?? null
  return {
    globalVolKrw: row.total_volume ?? null,
    mcapKrw: mcap,
    rank: row.market_cap_rank ?? null,
    fdvKrw: fdv,
    circRatio: mcap != null && fdv > 0 ? +(mcap / fdv).toFixed(3) : null,
    athChangePct: row.ath_change_percentage ?? null,
    ret7dPct: row.price_change_percentage_7d_in_currency ?? null,
    ret30dPct: row.price_change_percentage_30d_in_currency ?? null,
  }
}

// 매핑 재구축: coins/list(수 MB) + 후보 markets fetch는 락 밖에서 실행(코인게코 열화 시에도
// 임계구역이 ms 단위를 유지하도록 — 락 보유 중 네트워크 대기는 30s deadline/120s stale 탈취를
// 넘겨 탈취 연쇄·중복 다운로드·429 증폭을 유발한다). 실패 시 기존 맵 유지.
// 락 안에서는 fresh 재확인(double-check)만 하며, 그 사이 다른 스캐너가 이미 재구축했다면
// 자신의 fetch 결과는 버리고(write 생략) 승자의 맵을 그대로 반환한다.
async function rebuildMap(markets, oldMap, d, now) {
  const list = await d.fetchCgCoinsList(d.apiKey)
  if (!list) return oldMap
  const candidates = candidatesBySymbol(markets, list)
  const allIds = [...new Set(Object.values(candidates).flat())]
  const rows = allIds.length ? await d.fetchCgMarkets(allIds, d.apiKey) : []
  if (!rows && allIds.length) return oldMap
  return d.withLock('coingecko-map', async () => {
    const cur = await d.readJson('coingecko-map.json', null)
    const stillMissing = markets.some((m) => !(m in (cur?.byMarket || {})))
    if (isFresh(cur, MAP_TTL_MS, now) && !stillMissing) return cur // 다른 스캐너가 방금 재구축함 — 내 결과는 버림
    const byMarket = { ...(cur?.byMarket || oldMap?.byMarket || {}), ...resolveCollisions(markets, candidates, rows || []) }
    const next = { builtAt: new Date(now).toISOString(), byMarket }
    await d.writeJson('coingecko-map.json', next)
    return next
  })
}

// 캐시 갱신: 매핑된 id 일괄 조회(fetchCgMarkets)는 락 밖에서 실행(임계구역 ms 단위 유지 — 위 설명과 동일 이유).
// 실패 시 null. 락 안에서는 fresh 재확인(double-check)만 하며, 그 사이 다른 스캐너가 이미 갱신했다면
// 자신의 fetch 결과는 버리고(write 생략) 승자의 캐시를 그대로 반환한다.
async function refreshCache(markets, map, d, now) {
  const idOf = {}
  for (const m of markets) { const id = map.byMarket?.[m]; if (id) idOf[m] = id }
  const ids = [...new Set(Object.values(idOf))]
  if (!ids.length) return null
  const rows = await d.fetchCgMarkets(ids, d.apiKey)
  if (!rows) return null
  const entryOf = Object.fromEntries(rows.map((r) => [r.id, toCacheEntry(r)]))
  const byMarket = {}
  for (const [m, id] of Object.entries(idOf)) { if (entryOf[id]) byMarket[m] = entryOf[id] }
  const mine = { fetchedAt: new Date(now).toISOString(), byMarket }
  return d.withLock('coingecko-cache', async () => {
    const cur = await d.readJson('coingecko-cache.json', null)
    if (isFresh(cur, CACHE_TTL_MS, now)) return cur // 다른 스캐너가 방금 갱신함 — 내 결과는 버림
    await d.writeJson('coingecko-cache.json', mine)
    return mine
  })
}

// 스캐너 진입점. 어떤 실패에도 { byMarket: {}, coverage: 0, reason } — 스캔 불사침.
// reason: 'no-key' | 'no-map' | 'stale-cache' | 'error' (정상일 땐 필드 없음)
export async function ensureCgData(markets, { allowFetch = true, now = Date.now(), deps = {} } = {}) {
  const neutral = (reason) => ({ byMarket: {}, coverage: 0, reason })
  try {
    const d = { readJson, writeJson, withLock, loadApiKey, fetchCgMarkets, fetchCgCoinsList, env: process.env, ...deps }
    d.apiKey = await d.loadApiKey(d.readJson, d.env)
    if (!d.apiKey) return neutral('no-key')

    let map = await d.readJson('coingecko-map.json', null)
    const missing = markets.some((m) => !(m in (map?.byMarket || {})))
    if (allowFetch && (!isFresh(map, MAP_TTL_MS, now) || missing)) map = await rebuildMap(markets, map, d, now)
    if (!map?.byMarket) return neutral('no-map')

    let cache = await d.readJson('coingecko-cache.json', null)
    if (allowFetch && !isFresh(cache, CACHE_TTL_MS, now)) {
      cache = await refreshCache(markets, map, d, now)
      // 자기 fetch 실패(공유 키 429 등)여도 동시 승자가 그 사이 fresh 캐시를 써놨을 수 있다 — 재읽기 폴백
      if (!isFresh(cache, CACHE_TTL_MS, now)) cache = await d.readJson('coingecko-cache.json', null)
    }
    if (!isFresh(cache, CACHE_TTL_MS, now)) return neutral('stale-cache') // stale 캐시로 감점하지 않는다

    const byMarket = {}
    let covered = 0
    for (const m of markets) { const e = cache.byMarket?.[m]; if (e) { byMarket[m] = e; covered++ } }
    // fetchedAt(캐시 시점)을 함께 반환 — subsystem B가 도미넌스 판정 시점의 글로벌 데이터 신선도를 통제할 수 있게.
    return { byMarket, coverage: markets.length ? +(covered / markets.length).toFixed(2) : 0, fetchedAt: cache.fetchedAt }
  } catch {
    return neutral('error')
  }
}
