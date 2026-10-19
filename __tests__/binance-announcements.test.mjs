import { describe, it, expect } from 'vitest'
import { fetchBinanceAnnouncements } from '../lib/binance.mjs'

const ok = (articles) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ data: { articles } }) })
const art = (id) => ({ id, title: `Notice ${id}`, releaseDate: 1792000000000 })

describe('fetchBinanceAnnouncements', () => {
  it('keeps the catalogs that worked when another one fails, and reports why it failed', async () => {
    const fails = []
    const fetchFn = async (url) => {
      if (url.includes('catalogId=157')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      return ok([art(url.includes('161') ? 1 : 2)])
    }
    const r = await fetchBinanceAnnouncements({ catalogIds: [161, 157, 48], fetchFn, onFail: (f) => fails.push(f) })
    expect(r.map((a) => a.id)).toEqual(['binance:1', 'binance:2'])
    expect(fails).toHaveLength(1)
    expect(fails[0]).toMatchObject({ catalogId: 157, error: expect.stringContaining('TimeoutError') })
  })

  it('reports status, content type and a snippet when the body is not JSON (e.g. a bot challenge page)', async () => {
    const fails = []
    const fetchFn = async () => ({ ok: true, status: 202, headers: { get: () => 'text/html' }, text: async () => '<html><script>challenge()</script></html>' })
    const r = await fetchBinanceAnnouncements({ catalogIds: [161], fetchFn, onFail: (f) => fails.push(f) })
    expect(r).toBeNull()
    expect(fails[0]).toMatchObject({ catalogId: 161, status: 202, contentType: 'text/html' })
    expect(fails[0].snippet).toContain('challenge')
  })

  it('reports non-OK status', async () => {
    const fails = []
    const fetchFn = async () => ({ ok: false, status: 403, headers: { get: () => 'text/html' }, text: async () => 'Forbidden' })
    expect(await fetchBinanceAnnouncements({ catalogIds: [161], fetchFn, onFail: (f) => fails.push(f) })).toBeNull()
    expect(fails[0]).toMatchObject({ status: 403, snippet: 'Forbidden' })
  })
})

import { logBinanceFail } from '../lib/news/sources/exchanges.mjs'

describe('logBinanceFail', () => {
  it('logs one line per distinct reason, flattening whitespace in the snippet', () => {
    const lines = []
    const o = { log: (m) => lines.push(m), now: () => 'T' }
    expect(logBinanceFail({ catalogId: 161, status: 202, contentType: 'text/html', snippet: '<html>\n  <b>x</b>' }, o)).toBe(true)
    expect(logBinanceFail({ catalogId: 161, status: 202, contentType: 'text/html', snippet: '<html>\n  <b>x</b>' }, o)).toBe(false)
    expect(logBinanceFail({ catalogId: 157, error: 'TimeoutError: aborted' }, o)).toBe(true)
    expect(lines).toEqual(['T 바이낸스 공지 실패 catalog 161: status 202 text/html <html> <b>x</b>', 'T 바이낸스 공지 실패 catalog 157: TimeoutError: aborted'])
  })
})

import { resetBinanceFailLog, clearBinanceFail } from '../lib/news/sources/exchanges.mjs'

describe('logBinanceFail — per catalog', () => {
  it('logs each catalog once per outage even when all three fail with the same reason every cycle', () => {
    resetBinanceFailLog()
    const lines = []
    const o = { log: (m) => lines.push(m), now: () => 'T' }
    for (let cycle = 0; cycle < 3; cycle++) for (const c of [161, 157, 48]) logBinanceFail({ catalogId: c, error: 'TimeoutError: x' }, o)
    expect(lines).toHaveLength(3)
  })
  it('logs again after a catalog recovered and failed anew', () => {
    resetBinanceFailLog()
    const lines = []
    const o = { log: (m) => lines.push(m), now: () => 'T' }
    logBinanceFail({ catalogId: 161, error: 'TimeoutError: x' }, o)
    clearBinanceFail(161)
    logBinanceFail({ catalogId: 161, error: 'TimeoutError: x' }, o)
    expect(lines).toHaveLength(2)
  })
})

describe('fetchBinanceAnnouncements onOk', () => {
  it('reports which catalogs succeeded', async () => {
    const ok = []
    const fetchFn = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ data: { articles: [{ id: 1, title: 't' }] } }) })
    await fetchBinanceAnnouncements({ catalogIds: [161, 157], fetchFn, onOk: (c) => ok.push(c) })
    expect(ok).toEqual([161, 157])
  })
})
