// __tests__/news-classify.test.mjs
import { describe, it, expect } from 'vitest'
import { classifyItem } from '../lib/news/classify.mjs'

const it_ = (source, title, extra = {}) => ({ id: 'x', source, title, body: null, ts: null, url: null, important: false, codes: [], ...extra })

describe('classifyItem — 공식 공지', () => {
  it('업비트 상폐·유의·중단·재개', () => {
    expect(classifyItem(it_('upbit', '아이콘(ICX) 거래지원 종료 안내 (10/19 15:00)'))).toMatchObject({ kind: 'official-risk', type: 'delist' })
    expect(classifyItem(it_('bithumb', '자이(XAI) 거래유의종목 지정'))).toMatchObject({ kind: 'official-risk', type: 'caution' })
    expect(classifyItem(it_('bithumb', '세이(SEI) 입출금 일시 중지 안내'))).toMatchObject({ kind: 'official-risk', type: 'halt' })
    expect(classifyItem(it_('bithumb', '헤미(HEMI) 거래유의종목 지정 해제'))).toMatchObject({ kind: 'official-clear', type: 'resume' })
  })
  it('공식 상장', () => {
    expect(classifyItem(it_('upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가'))).toMatchObject({ kind: 'official-listing', type: 'upbit-krw' })
    expect(classifyItem(it_('upbit', '돌핀(POD) 신규 거래지원 안내 (KRW, BTC, USDT 마켓)'))).toMatchObject({ kind: 'official-listing', type: 'upbit-krw' })
    expect(classifyItem(it_('binance', 'Binance Will List Sophon (SOPH)'))).toMatchObject({ kind: 'official-listing', type: 'binance-spot' })
    expect(classifyItem(it_('binance', 'Binance Futures Will Launch USDⓈ-Margined SOPHUSDT Perpetual Contract'))).toMatchObject({ kind: 'official-listing', type: 'binance-futures' })
    expect(classifyItem(it_('bithumb', '돌핀(POD) 원화 마켓 추가'))).toMatchObject({ kind: 'official-listing', type: 'bithumb-krw' })
  })
  it('KRW 없는 마켓 한정 상장·기타 공지 → official-other', () => {
    expect(classifyItem(it_('upbit', '렌조(REZ) 신규 거래지원 안내 (USDT 마켓)')).kind).toBe('official-other')
    expect(classifyItem(it_('upbit', 'API Maker 거래 수수료 0% 이벤트')).kind).toBe('official-other')
  })
})

describe('classifyItem — 코인니스 뉴스 태그', () => {
  it('태그 부여, 점수 영향 없음(kind=news)', () => {
    expect(classifyItem(it_('coinness', '2,500 BTC 이체... 익명 → 비트파이넥스'))).toEqual({ kind: 'news', type: null, tags: ['고래'] })
    expect(classifyItem(it_('coinness', 'XX 프로토콜 해킹, $3,000만 탈취')).tags).toContain('해킹')
    expect(classifyItem(it_('coinness', '테더, 카자흐 중앙은행과 MOU 체결')).tags).toContain('파트너십')
    expect(classifyItem(it_('coinness', '미 10년물 국채 수익률 5.35%')).tags).toEqual([])
  })
})

describe('실데이터 오분류 보정 (2026-10-07)', () => {
  it('바이낸스 선물 분기물 상장은 futures', () => {
    expect(classifyItem(it_('binance', 'Binance Futures Will List USDⓈ-M & COIN-M Quarterly 0326 Delivery Contracts'))).toMatchObject({ type: 'binance-futures' })
  })
  it('빗썸 상장 기념 이벤트 공지는 상장이 아님', () => {
    expect(classifyItem(it_('bithumb', '총 1억 3천만원 상당, 베드록(BR) 원화마켓 추가 기념 에어드랍 이벤트 (*거래 수수료 무료)')).kind).toBe('official-other')
  })
  it('중단 공지 (완료)는 해제', () => {
    expect(classifyItem(it_('upbit', '헤데라(HBAR) 입출금 일시 중단 안내 (완료)'))).toMatchObject({ kind: 'official-clear', type: 'resume' })
  })
})
