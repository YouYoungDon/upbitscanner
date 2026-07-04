import { describe, it, expect } from 'vitest'
import { candidatesBySymbol, resolveCollisions, isFresh, CACHE_TTL_MS, MAP_TTL_MS, toCacheEntry, ensureCgData } from '../lib/cg-data.mjs'

describe('candidatesBySymbol', () => {
  it('업비트 심볼과 코인게코 심볼 대소문자 무시 매칭', () => {
    const list = [
      { id: 'space-id', symbol: 'id' }, { id: 'other-id-coin', symbol: 'ID' },
      { id: 'bitcoin', symbol: 'btc' }, { id: 'unrelated', symbol: 'zzz' },
    ]
    expect(candidatesBySymbol(['KRW-ID', 'KRW-BTC', 'KRW-NEW'], list)).toEqual({
      id: ['space-id', 'other-id-coin'], btc: ['bitcoin'], new: [],
    })
  })
})

describe('resolveCollisions', () => {
  const rows = [
    { id: 'space-id', market_cap_rank: 969, market_cap: 23e9 },
    { id: 'other-id-coin', market_cap_rank: 4000, market_cap: 1e8 },
    { id: 'bitcoin', market_cap_rank: 1, market_cap: 1.9e15 },
  ]
  it('충돌 시 rank 최저(순위 최고) 승', () => {
    const map = resolveCollisions(['KRW-ID', 'KRW-BTC'], { id: ['space-id', 'other-id-coin'], btc: ['bitcoin'] }, rows)
    expect(map).toEqual({ 'KRW-ID': 'space-id', 'KRW-BTC': 'bitcoin' })
  })
  it('rank null은 후순위, 동률은 mcap 큰 쪽', () => {
    const r = [
      { id: 'a', market_cap_rank: null, market_cap: 9e9 },
      { id: 'b', market_cap_rank: 500, market_cap: 1e9 },
      { id: 'c', market_cap_rank: 500, market_cap: 2e9 },
    ]
    expect(resolveCollisions(['KRW-X'], { x: ['a', 'b', 'c'] }, r)).toEqual({ 'KRW-X': 'c' })
  })
  it('후보 없거나 rows에 없으면 null 기록 (재시도 억제)', () => {
    expect(resolveCollisions(['KRW-NEW'], { new: [] }, rows)).toEqual({ 'KRW-NEW': null })
    expect(resolveCollisions(['KRW-Y'], { y: ['ghost'] }, rows)).toEqual({ 'KRW-Y': null })
  })
})

describe('isFresh', () => {
  const now = Date.parse('2026-07-04T12:00:00Z')
  it('TTL 이내 fresh', () => {
    expect(isFresh({ fetchedAt: '2026-07-04T10:00:00Z' }, CACHE_TTL_MS, now)).toBe(true)
    expect(isFresh({ builtAt: '2026-07-01T12:00:00Z' }, MAP_TTL_MS, now)).toBe(true)
  })
  it('TTL 초과·필드 없음·깨진 날짜는 stale', () => {
    expect(isFresh({ fetchedAt: '2026-07-04T09:29:00Z' }, CACHE_TTL_MS, now)).toBe(false)
    expect(isFresh(null, CACHE_TTL_MS, now)).toBe(false)
    expect(isFresh({}, CACHE_TTL_MS, now)).toBe(false)
    expect(isFresh({ fetchedAt: 'garbage' }, CACHE_TTL_MS, now)).toBe(false)
  })
})

describe('toCacheEntry', () => {
  it('원본 행 → 캐시 엔트리 (circRatio = mcap/fdv)', () => {
    expect(toCacheEntry({
      total_volume: 64795357454, market_cap: 23052631548, market_cap_rank: 969,
      fully_diluted_valuation: 106914346271, ath_change_percentage: -97.807,
      price_change_percentage_7d_in_currency: -1.2, price_change_percentage_30d_in_currency: 8.4,
    })).toEqual({
      globalVolKrw: 64795357454, mcapKrw: 23052631548, rank: 969, fdvKrw: 106914346271,
      circRatio: 0.216, athChangePct: -97.807, ret7dPct: -1.2, ret30dPct: 8.4,
    })
  })
  it('FDV 없음/0 → circRatio null, 결측 필드는 null', () => {
    const e = toCacheEntry({ total_volume: 1e9 })
    expect(e).toEqual({
      globalVolKrw: 1e9, mcapKrw: null, rank: null, fdvKrw: null,
      circRatio: null, athChangePct: null, ret7dPct: null, ret30dPct: null,
    })
    expect(toCacheEntry({ market_cap: 1e9, fully_diluted_valuation: 0 }).circRatio).toBe(null)
  })
})

function makeDeps(files, { key = 'k', coinsList, marketRows } = {}) {
  const calls = { marketsFetches: 0, listFetches: 0 }
  return {
    deps: {
      readJson: async (name, fb) => files[name] ?? fb,
      writeJson: async (name, data) => { files[name] = data },
      withLock: async (_name, fn) => fn(),
      loadApiKey: async () => key,
      fetchCgCoinsList: async () => { calls.listFetches++; return coinsList ?? null },
      fetchCgMarkets: async () => { calls.marketsFetches++; return marketRows ?? null },
      env: {},
    },
    calls, files,
  }
}
const NOW = Date.parse('2026-07-04T12:00:00Z')
const ROW = { id: 'space-id', total_volume: 6e10, market_cap: 2.3e10, market_cap_rank: 969 }

describe('ensureCgData', () => {
  it('맵·캐시 신선하면 fetch 없이 캐시 반환, coverage 계산', async () => {
    const { deps, calls } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id', 'KRW-NEW': null } },
      'coingecko-cache.json': { fetchedAt: '2026-07-04T11:00:00Z', byMarket: { 'KRW-ID': { globalVolKrw: 6e10 } } },
    })
    const r = await ensureCgData(['KRW-ID', 'KRW-NEW'], { now: NOW, deps })
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
    expect(r.coverage).toBe(0.5)
    expect(calls.marketsFetches + calls.listFetches).toBe(0)
  })
  it('캐시 stale + allowFetch → 재조회·파일 갱신', async () => {
    const { deps, files } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
      'coingecko-cache.json': { fetchedAt: '2026-07-04T08:00:00Z', byMarket: {} },
    }, { marketRows: [ROW] })
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
    expect(files['coingecko-cache.json'].fetchedAt).toBe(new Date(NOW).toISOString())
  })
  it('캐시 stale + allowFetch=false → 중립', async () => {
    const { deps } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
      'coingecko-cache.json': { fetchedAt: '2026-07-04T08:00:00Z', byMarket: { 'KRW-ID': { globalVolKrw: 6e10 } } },
    })
    const r = await ensureCgData(['KRW-ID'], { allowFetch: false, now: NOW, deps })
    expect(r).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('맵 없음 → coins/list + markets로 재구축 후 캐시까지 채움', async () => {
    const { deps, files } = makeDeps({}, {
      coinsList: [{ id: 'space-id', symbol: 'id' }, { id: 'other-id-coin', symbol: 'id' }],
      marketRows: [ROW, { id: 'other-id-coin', total_volume: 1, market_cap: 1, market_cap_rank: 4000 }],
    })
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(files['coingecko-map.json'].byMarket['KRW-ID']).toBe('space-id')
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
  })
  it('키 없음 → 중립', async () => {
    const { deps } = makeDeps({}, { key: null })
    expect(await ensureCgData(['KRW-ID'], { now: NOW, deps })).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('fetch 전부 실패 → 중립 (throw 없음)', async () => {
    const { deps } = makeDeps({}) // coinsList/marketRows = null
    expect(await ensureCgData(['KRW-ID'], { now: NOW, deps })).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('락 안 재확인: 다른 스캐너가 방금 갱신했으면 fetch·쓰기 생략(double-check)', async () => {
    const staleCache = { fetchedAt: '2026-07-04T08:00:00Z', byMarket: {} }
    const freshCache = { fetchedAt: new Date(NOW - 60000).toISOString(), byMarket: { 'KRW-ID': { globalVolKrw: 7e10 } } }
    const files = {
      'coingecko-map.json': { builtAt: '2026-07-03T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
    }
    const { deps, calls } = makeDeps(files, { marketRows: [ROW] })
    let cacheReads = 0
    const cacheWrites = []
    deps.readJson = async (name, fb) => {
      if (name === 'coingecko-cache.json') {
        cacheReads++
        return cacheReads === 1 ? staleCache : freshCache // 락 밖: stale → 락 안: 다른 스캐너가 방금 씀
      }
      return files[name] ?? fb
    }
    deps.writeJson = async (name, data) => {
      if (name === 'coingecko-cache.json') cacheWrites.push(data)
      files[name] = data
    }
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(7e10) // fresh 캐시의 엔트리
    expect(calls.marketsFetches).toBe(0)                  // fetch 생략
    expect(cacheWrites).toEqual([])                       // 캐시 파일 덮어쓰기 없음
  })
  it('맵 없음 + coinsList 정상 + markets 실패(null) → 맵 오염 없이 기존 상태 유지, 재시도 가능', async () => {
    const { deps, files } = makeDeps({}, {
      coinsList: [{ id: 'space-id', symbol: 'id' }],
      marketRows: null, // fetchCgMarkets 실패 시뮬 (신 계약: 페이지 실패 시 전체 null)
    })
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(files['coingecko-map.json']).toBeUndefined() // 맵 파일 안 씀 → null 오염 없음
    expect(r).toEqual({ byMarket: {}, coverage: 0 })
    // 재시도 가능: 맵이 여전히 null이므로 다음 호출도 rebuildMap을 다시 시도한다
    const r2 = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(r2).toEqual({ byMarket: {}, coverage: 0 })
  })
  it('맵 재구축 락 안 재확인: 다른 스캐너가 방금 재구축했으면 fetch·쓰기 생략(double-check)', async () => {
    const staleMap = { builtAt: '2026-06-20T00:00:00Z', byMarket: {} } // stale & KRW-ID 없음(missing)
    const freshMap = { builtAt: new Date(NOW - 60000).toISOString(), byMarket: { 'KRW-ID': 'space-id' } }
    const files = {
      'coingecko-cache.json': { fetchedAt: new Date(NOW - 60000).toISOString(), byMarket: { 'KRW-ID': { globalVolKrw: 6e10 } } },
    }
    const { deps, calls } = makeDeps(files, { coinsList: [{ id: 'space-id', symbol: 'id' }], marketRows: [ROW] })
    let mapReads = 0
    const mapWrites = []
    deps.readJson = async (name, fb) => {
      if (name === 'coingecko-map.json') {
        mapReads++
        return mapReads === 1 ? staleMap : freshMap // 락 밖: stale+missing → 락 안: 다른 스캐너가 방금 재구축함
      }
      return files[name] ?? fb
    }
    deps.writeJson = async (name, data) => {
      if (name === 'coingecko-map.json') mapWrites.push(data)
      files[name] = data
    }
    const r = await ensureCgData(['KRW-ID'], { now: NOW, deps })
    expect(r.byMarket['KRW-ID'].globalVolKrw).toBe(6e10)
    expect(calls.listFetches).toBe(0)     // coins/list(수 MB) 재다운로드 생략
    expect(calls.marketsFetches).toBe(0)  // markets 재조회 생략
    expect(mapWrites).toEqual([])         // 맵 파일 덮어쓰기 없음
  })
  it('맵 fresh지만 새 심볼 등장 → allowFetch면 재구축', async () => {
    const { deps, files } = makeDeps({
      'coingecko-map.json': { builtAt: '2026-07-04T00:00:00Z', byMarket: { 'KRW-ID': 'space-id' } },
    }, {
      coinsList: [{ id: 'space-id', symbol: 'id' }, { id: 'newcoin', symbol: 'new' }],
      marketRows: [ROW, { id: 'newcoin', total_volume: 5, market_cap: 5, market_cap_rank: 100 }],
    })
    await ensureCgData(['KRW-ID', 'KRW-NEW'], { now: NOW, deps })
    expect(files['coingecko-map.json'].byMarket['KRW-NEW']).toBe('newcoin')
  })
})
