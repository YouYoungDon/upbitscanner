import { describe, it, expect } from 'vitest'
import { extractEpisodes } from '../lib/scorecard.mjs'

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
