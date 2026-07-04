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
