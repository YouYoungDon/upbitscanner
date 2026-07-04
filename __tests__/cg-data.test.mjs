import { describe, it, expect } from 'vitest'
import { candidatesBySymbol, resolveCollisions, isFresh, CACHE_TTL_MS, MAP_TTL_MS } from '../lib/cg-data.mjs'

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
