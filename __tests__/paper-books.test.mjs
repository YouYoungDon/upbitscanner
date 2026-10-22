import { describe, it, expect } from 'vitest'
import { BOOKS, XL, limitsOf, matchCount, bookByKey } from '../lib/paper-books.mjs'
import { PAPER } from '../lib/paper.mjs'

describe('BOOKS — 장부 정의', () => {
  it('기존 3장부가 1단계, XL 3장부가 2단계(기존 장부를 먼저 처리)', () => {
    expect(BOOKS.map((b) => `${b.key}:${b.phase}`)).toEqual(['main:1', 'momentum:1', 'random:1', 'main_xl:2', 'momentum_xl:2', 'random_xl:2'])
  })
  it('XL은 1,000만 원·최대 200건·스캔당 200건, 건당 금액은 PAPER 그대로', () => {
    expect(XL).toEqual({ startCash: 10_000_000, maxOpen: 200, maxPerScan: 200 })
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
