import { describe, it, expect, vi, afterEach } from 'vitest'
import { getMarkets } from '../lib/upbit.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('get 재시도/백오프', () => {
  it('5xx 두 번 후 성공이면 재시도해 결과 반환', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++
      if (n <= 2) return { ok: false, status: 500 }
      return { ok: true, json: async () => [{ market: 'KRW-BTC' }, { market: 'KRW-USDT' }] }
    }))
    const r = await getMarkets()
    expect(n).toBe(3)
    // USDT 스테이블 제외 + market_event 없으면 warning/caution false
    expect(r).toEqual([{ market: 'KRW-BTC', warning: false, caution: false }])
  })
  it('4xx는 즉시 포기(재시도 안 함)', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => { n++; return { ok: false, status: 400 } }))
    const r = await getMarkets()
    expect(n).toBe(1)
    expect(r).toEqual([])
  })
  it('ok 응답이어도 json 파싱이 reject되면 재시도 경로를 탄다(리턴된 프라미스가 우회하지 않음)', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++
      if (n <= 2) return { ok: true, json: async () => { throw new Error('bad json') } }
      return { ok: true, json: async () => [{ market: 'KRW-BTC' }] }
    }))
    const r = await getMarkets()
    expect(n).toBe(3)
    expect(r).toEqual([{ market: 'KRW-BTC', warning: false, caution: false }])
  })
  it('json 파싱이 재시도 소진까지 계속 reject되면 null(→ getMarkets는 [])', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json') } })))
    const r = await getMarkets()
    expect(r).toEqual([])
  })
  it('fetch에 10s 타임아웃 signal을 전달한다(소켓 행 방지)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }))
    vi.stubGlobal('fetch', fetchMock)
    await getMarkets()
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
