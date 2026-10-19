import { describe, it, expect } from 'vitest'
import { randomUniverse, randomPicks } from '../lib/paper-random.mjs'
import { selectEntries, newBook } from '../lib/paper.mjs'

describe('randomUniverse', () => {
  const tradePrice = { 'KRW-A': 6e8, 'KRW-B': 4e8, 'KRW-C': 9e8, 'KRW-D': 9e8 }
  it('5억 미만·경고 종목·국내 과열을 뺀다', () => {
    const kimchi = { btcPremium: 0.01, byMarket: { 'KRW-D': { premium: 0.05 }, 'KRW-A': { premium: 0.01 } } }
    const u = randomUniverse({ markets: ['KRW-A', 'KRW-B', 'KRW-C', 'KRW-D'], tradePrice, warnOf: { 'KRW-C': 'warning' }, kimchi })
    expect(u).toEqual(['KRW-A'])
  })
  it('김치프 조회 실패면 과열로 빼지 않는다', () => {
    const u = randomUniverse({ markets: ['KRW-A', 'KRW-D'], tradePrice, warnOf: {}, kimchi: { btcPremium: null, byMarket: {} } })
    expect(u).toEqual(['KRW-A', 'KRW-D'])
  })
  it('주의(caution)는 남긴다(메인과 같게)', () => {
    expect(randomUniverse({ markets: ['KRW-A'], tradePrice, warnOf: { 'KRW-A': 'caution' }, kimchi: null })).toEqual(['KRW-A'])
  })
})

describe('randomPicks', () => {
  const universe = Array.from({ length: 50 }, (_, i) => `KRW-X${i}`)
  it('같은 timestamp면 같은 순서(재현 가능)', () => {
    const s = { timestamp: '2026-10-20T00:00:30.000Z', universe }
    expect(randomPicks(s).map((p) => p.market)).toEqual(randomPicks(s).map((p) => p.market))
  })
  it('다른 timestamp면 순서가 다르고, 전 종목을 한 번씩 담는다', () => {
    const a = randomPicks({ timestamp: '2026-10-20T00:00:30.000Z', universe }).map((p) => p.market)
    const b = randomPicks({ timestamp: '2026-10-20T03:00:30.000Z', universe }).map((p) => p.market)
    expect(a).not.toEqual(b)
    expect([...a].sort()).toEqual([...universe].sort())
  })
  it('universe가 없으면 빈 목록(예전 스캔은 사지 않는다)', () => {
    expect(randomPicks({ timestamp: '2026-10-20T00:00:30.000Z' })).toEqual([])
    expect(randomPicks(null)).toEqual([])
  })
  it('selectEntries를 거치면 셔플 순서 유지 + 보유 종목 제외', () => {
    const picks = randomPicks({ timestamp: '2026-10-20T00:00:30.000Z', universe })
    const book = newBook()
    book.open.push({ market: picks[0].market })
    const want = selectEntries(book, picks)
    expect(want.map((p) => p.market)).toEqual([picks[1].market, picks[2].market, picks[3].market])
  })
})
