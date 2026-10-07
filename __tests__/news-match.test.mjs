// __tests__/news-match.test.mjs
import { describe, it, expect } from 'vitest'
import { buildMatcher } from '../lib/news/match.mjs'

const markets = [
  { market: 'KRW-SOL', korean_name: '솔라나', english_name: 'Solana' },
  { market: 'KRW-ONE', korean_name: '하모니', english_name: 'Harmony' },
  { market: 'KRW-SOPH', korean_name: '소폰', english_name: 'Sophon' },
  { market: 'KRW-ETH', korean_name: '이더리움', english_name: 'Ethereum' },
  { market: 'KRW-NMR', korean_name: '뉴메레르', english_name: 'Numeraire' },
]
const item = (title, codes = []) => ({ id: 'x', source: 'coinness', title, body: null, ts: null, url: null, important: false, codes })
const m = buildMatcher(markets)

describe('buildMatcher', () => {
  it('소스 코드 우선', () => {
    expect(m(item('고래 매수', ['ETH']))).toEqual({ markets: ['KRW-ETH'], via: { 'KRW-ETH': 'code' } })
  })
  it('괄호 티커', () => {
    expect(m(item('뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가')).via['KRW-NMR']).toBe('paren') // 한글명도 있지만 괄호가 먼저 기록됨
  })
  it('한글명: 단독 단어만(더 긴 단어의 일부는 제외)', () => {
    expect(m(item('솔라나 9월 활성 프로그램 역대 최다')).markets).toEqual(['KRW-SOL'])
    expect(m(item('솔라나파이 프로젝트 출시')).markets).toEqual([])
  })
  it('2글자 이하 한글명은 매칭하지 않음(소폰)', () => {
    expect(m(item('소폰 생태계 업데이트')).markets).toEqual([])
  })
  it('영문 티커 단독 대문자(3자+), 모호 티커 제외', () => {
    expect(m(item('SOL ETF 승인 기대')).markets).toEqual(['KRW-SOL'])
    expect(m(item('ONE more thing')).markets).toEqual([])
    expect(m(item('SOLANA 업데이트')).markets).toEqual([])
  })
  it('코드가 유니버스에 없으면 무시', () => {
    expect(m(item('x', ['DOGE'])).markets).toEqual([])
  })
})
