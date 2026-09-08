import { describe, it, expect } from 'vitest'
import {
  classifyAnnouncement, parseTickers, matchMarkets, eventRiskMult,
} from '../lib/exchange-events.mjs'

describe('classifyAnnouncement', () => {
  it('상폐 → delist(mult 0)', () => {
    expect(classifyAnnouncement('OO 거래지원 종료 안내')).toMatchObject({ type: 'delist', mult: 0 })
    expect(classifyAnnouncement('Binance Will Delist ABC')).toMatchObject({ type: 'delist' })
  })
  it('유의지정 → caution(×0.5)', () => {
    expect(classifyAnnouncement('샌드박스(SAND) 거래 유의 종목 지정 안내')).toMatchObject({ type: 'caution', mult: 0.5 })
  })
  it('입출금중단/마이그레이션 → halt(×0.7)', () => {
    expect(classifyAnnouncement('네트워크 전환에 따른 소폰(SOPH) 입출금 중단 안내')).toMatchObject({ type: 'halt', mult: 0.7 })
    expect(classifyAnnouncement('아르고(AERGO) 토큰 스왑 일정 안내')).toMatchObject({ type: 'halt' })
  })
  it('재개/해제 → resume — halt/caution 규칙보다 먼저 매칭', () => {
    expect(classifyAnnouncement('문빔(GLMR) 입출금 재개 안내')).toMatchObject({ type: 'resume' })
    expect(classifyAnnouncement('타이코(TAIKO) 거래 유의 종목 지정 해제 안내')).toMatchObject({ type: 'resume' })
  })
  it('신규상장 → listing(중립)', () => {
    expect(classifyAnnouncement('클러스터프로토콜(CP) 신규 거래지원 안내')).toMatchObject({ type: 'listing', mult: 1 })
  })
  it('무관 제목 → null', () => {
    expect(classifyAnnouncement('보이스피싱 예방 주간 안내')).toBeNull()
    expect(classifyAnnouncement(null)).toBeNull()
  })
})

describe('parseTickers', () => {
  it('괄호 안 단일/복수 티커', () => {
    expect(parseTickers('소폰(SOPH) 입출금 중단')).toEqual(['SOPH'])
    expect(parseTickers('아르고(AERGO), 알파쿼크(AQT) 토큰 스왑')).toEqual(['AERGO', 'AQT'])
  })
  it('마켓 표기 괄호는 오탐 안 함', () => {
    // "(KRW, BTC, USDT 마켓)"은 단일 대문자 토큰이 아니라 매칭 안 됨
    expect(parseTickers('클러스터프로토콜(CP) 신규 거래지원 안내 (KRW, BTC, USDT 마켓)')).toEqual(['CP'])
  })
  it('티커 없음 → 빈 배열', () => {
    expect(parseTickers('Binance Futures Will Launch USDs-Margined XYZ')).toEqual([])
    expect(parseTickers(null)).toEqual([])
  })
})

describe('matchMarkets', () => {
  const uni = new Set(['KRW-SOPH', 'KRW-AERGO', 'KRW-BTC'])
  it('유니버스에 있는 티커만 KRW- 마켓으로', () => {
    expect(matchMarkets(['SOPH', 'AQT'], uni)).toEqual(['KRW-SOPH'])
    expect(matchMarkets(['AERGO', 'BTC'], uni)).toEqual(['KRW-AERGO', 'KRW-BTC'])
  })
  it('매칭 없음 → 빈 배열', () => {
    expect(matchMarkets(['DOGE'], uni)).toEqual([])
  })
})

describe('eventRiskMult', () => {
  it('빈 이벤트 → mult 1, label null', () => {
    expect(eventRiskMult([])).toEqual({ mult: 1, label: null })
  })
  it('가장 강한(min) 배수 채택 + 라벨', () => {
    const r = eventRiskMult([
      { type: 'halt', exchange: 'upbit', mult: 0.7 },
      { type: 'caution', exchange: 'binance', mult: 0.5 },
    ])
    expect(r.mult).toBe(0.5)
    expect(r.label).toContain('유의지정')
    expect(r.label).toContain('바이낸스')
  })
  it('상폐(0)가 최우선', () => {
    expect(eventRiskMult([{ type: 'halt', exchange: 'upbit', mult: 0.7 }, { type: 'delist', exchange: 'upbit', mult: 0 }]).mult).toBe(0)
  })
})
