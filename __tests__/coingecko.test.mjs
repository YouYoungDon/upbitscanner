import { describe, it, expect, vi } from 'vitest'
import { loadApiKey, fetchCgMarkets, fetchCgCoinsList } from '../lib/coingecko.mjs'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const err = (status) => ({ ok: false, status, json: async () => ({}) })

describe('loadApiKey', () => {
  it('환경변수 우선', async () => {
    const key = await loadApiKey(async () => ({ apiKey: 'file-key' }), { COINGECKO_API_KEY: 'env-key' })
    expect(key).toBe('env-key')
  })
  it('환경변수 없으면 파일', async () => {
    expect(await loadApiKey(async () => ({ apiKey: 'file-key' }), {})).toBe('file-key')
  })
  it('둘 다 없으면 null', async () => {
    expect(await loadApiKey(async () => null, {})).toBe(null)
  })
})

describe('fetchCgMarkets', () => {
  it('키 없거나 ids 비면 null', async () => {
    expect(await fetchCgMarkets(['bitcoin'], null)).toBe(null)
    expect(await fetchCgMarkets([], 'k')).toBe(null)
  })
  it('250개씩 분할 호출·합침', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `c${i}`)
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok([{ id: 'a' }])).mockResolvedValueOnce(ok([{ id: 'b' }]))
    const rows = await fetchCgMarkets(ids, 'k', { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }])
    // 요청 URL 검증: krw + 7d/30d 수익률 + demo 헤더
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('vs_currency=krw')
    expect(url).toContain('price_change_percentage=7d%2C30d')
    expect(init.headers['x-cg-demo-api-key']).toBe('k')
  })
  it('429는 재시도 후 성공', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(err(429)).mockResolvedValueOnce(ok([{ id: 'a' }]))
    const rows = await fetchCgMarkets(['a'], 'k', { fetchImpl, sleepMs: 1 })
    expect(rows).toEqual([{ id: 'a' }])
  })
  it('4xx(429 제외)는 즉시 null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(err(400))
    expect(await fetchCgMarkets(['a'], 'k', { fetchImpl, sleepMs: 1 })).toBe(null)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('재시도 소진 시 null (부분 성공분 있어도 전체 null — 오염 방지)', async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `c${i}`)
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok([{ id: 'a' }])).mockResolvedValue(err(500))
    const rows = await fetchCgMarkets(ids, 'k', { fetchImpl, retries: 1, sleepMs: 1 })
    expect(rows).toBe(null) // 1페이지는 확보했지만 2페이지 실패 → 계약상 전체 null
  })
  it('ok 응답이어도 json 파싱이 reject되면 재시도 경로를 탄다(우회 안 함)', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
      .mockResolvedValueOnce(ok([{ id: 'a' }]))
    const rows = await fetchCgMarkets(['a'], 'k', { fetchImpl, sleepMs: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(rows).toEqual([{ id: 'a' }])
  })
  it('fetch에 10s 타임아웃 signal을 전달한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ id: 'a' }]))
    await fetchCgMarkets(['a'], 'k', { fetchImpl })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('markets는 10s 타임아웃을 사용한다(수 MB 응답이 아니므로 짧아도 됨)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ id: 'a' }]))
    await fetchCgMarkets(['a'], 'k', { fetchImpl })
    expect(spy).toHaveBeenCalledWith(10_000)
    spy.mockRestore()
  })
})

describe('fetchCgCoinsList', () => {
  it('키 없으면 null', async () => { expect(await fetchCgCoinsList(null)).toBe(null) })
  it('정상 조회', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }]))
    expect(await fetchCgCoinsList('k', { fetchImpl })).toEqual([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }])
  })
  it('본문이 수 MB인 coins/list는 30s 타임아웃을 사용한다(느린 회선에서 abort 방지)', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const fetchImpl = vi.fn().mockResolvedValue(ok([]))
    await fetchCgCoinsList('k', { fetchImpl })
    expect(spy).toHaveBeenCalledWith(30_000)
    spy.mockRestore()
  })
})
