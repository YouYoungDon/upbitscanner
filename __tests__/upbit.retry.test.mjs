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
})
