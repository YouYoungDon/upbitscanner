import { describe, it, expect } from 'vitest'
import { extractEpisodes, scoreEpisode, neededCandleCount, mergeEpisodes } from '../lib/scorecard.mjs'

const scan = (ts, markets) => ({
  timestamp: ts,
  buy: markets.map((m) => ({ market: m, korean_name: m.slice(4), price: 100, score: 10, signals: ['RSI 과매도 (25)'] })),
  sell: [],
})

describe('extractEpisodes', () => {
  it('첫 스캔은 전원 신규 에피소드', () => {
    const eps = extractEpisodes([scan('t1', ['KRW-A', 'KRW-B'])])
    expect(eps.map((e) => e.id)).toEqual(['KRW-A@t1', 'KRW-B@t1'])
    expect(eps[0]).toMatchObject({
      market: 'KRW-A', entryTs: 't1', entryPrice: 100, score: 10,
      lowLiquidity: false, ret1: null, ret3: null, ret7: null,
      mfe1: null, mfe3: null, mfe7: null, status: 'pending', scoredAt: null,
    })
  })
  it('연속 등장은 중복 에피소드를 만들지 않는다', () => {
    const eps = extractEpisodes([scan('t1', ['KRW-A']), scan('t2', ['KRW-A'])])
    expect(eps.length).toBe(1)
  })
  it('이탈 후 재진입은 새 에피소드', () => {
    const eps = extractEpisodes([scan('t1', ['KRW-A']), scan('t2', []), scan('t3', ['KRW-A'])])
    expect(eps.map((e) => e.id)).toEqual(['KRW-A@t1', 'KRW-A@t3'])
  })
  it('lowLiquidity 플래그 보존', () => {
    const s = scan('t1', ['KRW-A'])
    s.buy[0].lowLiquidity = true
    expect(extractEpisodes([s])[0].lowLiquidity).toBe(true)
  })
  it('buy 없는 스캔·빈 배열 허용', () => {
    expect(extractEpisodes([{ timestamp: 't1' }, scan('t2', ['KRW-A'])]).length).toBe(1)
    expect(extractEpisodes([])).toEqual([])
  })
})

const DAY = 86400
// entryTs: 2026-07-01T03:00:00Z → D0 = 2026-07-01 (UTC일)
const ENTRY_MS = Date.parse('2026-07-01T03:00:00Z')
const D0_SEC = Math.floor(ENTRY_MS / 1000 / DAY) * DAY
const ep0 = () => ({
  id: 'KRW-A@e', market: 'KRW-A', korean_name: 'A',
  entryTs: '2026-07-01T03:00:00.000Z', entryPrice: 100, score: 10, signals: [],
  lowLiquidity: false, ret1: null, ret3: null, ret7: null,
  mfe1: null, mfe3: null, mfe7: null, status: 'pending', scoredAt: null,
})
// D0..D+n 확정봉 생성기
const candles = (n, close = (i) => 100 + i, high = (i) => 110 + i) =>
  Array.from({ length: n + 1 }, (_, i) => ({ time: D0_SEC + i * DAY, open: 100, close: close(i), high: high(i), low: 90, volume: 1 }))

describe('scoreEpisode', () => {
  it('D+1만 확정 → ret1/mfe1 채점, partial', () => {
    const r = scoreEpisode(ep0(), candles(1), Date.parse('2026-07-03T00:00:00Z'))
    expect(r.ret1).toBeCloseTo(101 / 100 - 1)
    expect(r.mfe1).toBeCloseTo(111 / 100 - 1)
    expect(r.ret3).toBeNull()
    expect(r.status).toBe('partial')
    expect(r.scoredAt).not.toBeNull()
  })
  it('D+7까지 확정 → 전부 채점, done. mfe는 D0 고가 제외', () => {
    // D0 고가만 999로 크게 — mfe에 반영되면 안 됨
    const cs = candles(7, (i) => 100 + i, (i) => (i === 0 ? 999 : 110 + i))
    const r = scoreEpisode(ep0(), cs, Date.parse('2026-07-10T00:00:00Z'))
    expect(r.ret7).toBeCloseTo(107 / 100 - 1)
    expect(r.mfe7).toBeCloseTo(117 / 100 - 1) // 999 아님
    expect(r.status).toBe('done')
  })
  it('이미 채점된 지평선은 다시 계산하지 않는다', () => {
    const pre = { ...ep0(), ret1: 0.5, mfe1: 0.6, status: 'partial' }
    const r = scoreEpisode(pre, candles(7), Date.parse('2026-07-10T00:00:00Z'))
    expect(r.ret1).toBe(0.5) // 보존
    expect(r.ret7).not.toBeNull()
  })
  it('진입 후 10 UTC일 경과 + 캔들 없음 → no-data', () => {
    const r = scoreEpisode(ep0(), [], Date.parse('2026-07-12T01:00:00Z'))
    expect(r.status).toBe('no-data')
  })
  it('10일 이내 + 캔들 없음 → pending 유지', () => {
    const r = scoreEpisode(ep0(), [], Date.parse('2026-07-05T00:00:00Z'))
    expect(r.status).toBe('pending')
  })
  it('entryPrice 0 이하 → no-data', () => {
    const r = scoreEpisode({ ...ep0(), entryPrice: 0 }, candles(7), Date.parse('2026-07-10T00:00:00Z'))
    expect(r.status).toBe('no-data')
  })
})

describe('neededCandleCount', () => {
  it('오늘−D0+3, clamp [10,200]', () => {
    const now = Date.parse('2026-07-20T00:00:00Z') // D0 + 19일
    expect(neededCandleCount(ENTRY_MS, now)).toBe(22)
    expect(neededCandleCount(now, now)).toBe(10) // 최소
    expect(neededCandleCount(Date.parse('2020-01-01T00:00:00Z'), now)).toBe(200) // cap
  })
})

describe('mergeEpisodes', () => {
  it('기존 채점값 보존 + 신규 추가', () => {
    const existing = [{ ...ep0(), ret1: 0.1, status: 'partial' }]
    const fresh = [ep0(), { ...ep0(), id: 'KRW-B@e', market: 'KRW-B' }]
    const merged = mergeEpisodes(existing, fresh)
    expect(merged.length).toBe(2)
    expect(merged.find((e) => e.id === 'KRW-A@e').ret1).toBe(0.1)
    expect(merged.find((e) => e.id === 'KRW-B@e').status).toBe('pending')
  })
  it('fresh에 없는 기존 에피소드도 유지 (방어적)', () => {
    const existing = [{ ...ep0(), id: 'KRW-OLD@x', market: 'KRW-OLD' }]
    const merged = mergeEpisodes(existing, [ep0()])
    expect(merged.length).toBe(2)
  })
})
