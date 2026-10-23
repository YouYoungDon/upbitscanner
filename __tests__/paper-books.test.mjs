import { describe, it, expect } from 'vitest'
import { BOOKS, XL, limitsOf, matchCount, bookByKey, equityPoint } from '../lib/paper-books.mjs'
import { PAPER } from '../lib/paper.mjs'

describe('BOOKS — 장부 정의', () => {
  it('기존 3장부가 1단계, XL 3장부가 2단계(기존 장부를 먼저 처리)', () => {
    expect(BOOKS.map((b) => `${b.key}:${b.phase}`)).toEqual(['main:1', 'momentum:1', 'random:1', 'main_xl:2', 'momentum_xl:2', 'random_xl:2'])
  })
  it('XL은 1,000만 원·최대 199건·스캔당 199건, 건당 금액은 PAPER 그대로', () => {
    // 199건: 200건 × 5만 원 × (1+수수료) = 10,005,000원 > 1,000만 원이라 200건째는 늘 현금 부족이었다(10-23 독립 리뷰)
    expect(XL).toEqual({ startCash: 10_000_000, maxOpen: 199, maxPerScan: 199 })
    expect(bookByKey('main_xl')).toMatchObject(XL)
    expect(bookByKey('main_xl').rule).toBe('main') // 메인과 같은 청산 규칙(픽의 exit)
  })
  it('기존 장부엔 한도 필드가 없어 PAPER 값을 쓴다(동작 불변)', () => {
    for (const k of ['main', 'momentum', 'random']) {
      expect(bookByKey(k).startCash).toBeUndefined()
      expect(limitsOf(bookByKey(k))).toEqual({ startCash: PAPER.START_CASH, maxOpen: PAPER.MAX_OPEN, maxPerScan: PAPER.MAX_PER_SCAN })
    }
  })
})

describe('matchCount — random_xl은 같은 스캔에서 main_xl이 산 만큼만', () => {
  const S = 1_792_000_000_000
  const st = { books: { main_xl: { open: [{ scanAt: S }, { scanAt: S + 1 }], closed: [{ scanAt: S }] } } }
  it('보유+청산 중 같은 scanAt만 센다', () => {
    expect(matchCount(st, 'main_xl', S)).toBe(2)
  })
  it('짝 장부가 없으면 0', () => {
    expect(matchCount({ books: {} }, 'main_xl', S)).toBe(0)
  })
})

describe('equityPoint — 평가금(시세 실패·상폐 종목)', () => {
  const mk = () => ({ main: { cash: 100, open: [{ market: 'KRW-A', qty: 2, entryPrice: 10, lastPrice: 12 }, { market: 'KRW-B', qty: 1, entryPrice: 50 }] } })
  it('현재가가 있으면 현재가, 없으면 마지막으로 받은 가격, 그것도 없으면 진입가', () => {
    expect(equityPoint(mk(), { 'KRW-A': 15 }, 1).main).toBe(100 + 30 + 50)
    expect(equityPoint(mk(), {}, 1).main).toBe(100 + 24 + 50)
  })
  it('받은 현재가를 포지션의 lastPrice로 남긴다', () => {
    const books = mk()
    equityPoint(books, { 'KRW-B': 55 }, 1)
    expect(books.main.open[1].lastPrice).toBe(55)
  })
})
