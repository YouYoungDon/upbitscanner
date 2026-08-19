import { describe, it, expect } from 'vitest'
import { parseCommand, resolveSymbol, formatCoin, formatStatus, formatStrategy, formatPositions, formatScorecard, formatHelp, formatNotFound } from '../lib/bot-commands.mjs'

describe('parseCommand', () => {
  it('정식 명령·별칭 정규화', () => {
    expect(parseCommand('/scan')).toEqual({ cmd: 'scan', arg: '' })
    expect(parseCommand('/c SOPH')).toEqual({ cmd: 'coin', arg: 'SOPH' })
    expect(parseCommand('/코인 소폰')).toEqual({ cmd: 'coin', arg: '소폰' })
    expect(parseCommand('/s')).toEqual({ cmd: 'status', arg: '' })
    expect(parseCommand('/status')).toEqual({ cmd: 'status', arg: '' })
    expect(parseCommand('/전략')).toEqual({ cmd: 'strategy', arg: '' })
    expect(parseCommand('/포지션')).toEqual({ cmd: 'positions', arg: '' })
    expect(parseCommand('/스코어카드')).toEqual({ cmd: 'scorecard', arg: '' })
    expect(parseCommand('/help')).toEqual({ cmd: 'help', arg: '' })
  })
  it('@봇이름 접미사·앞뒤 공백 허용', () => {
    expect(parseCommand('  /scan@my_bot  ')).toEqual({ cmd: 'scan', arg: '' })
    expect(parseCommand('/코인@my_bot BTC')).toEqual({ cmd: 'coin', arg: 'BTC' })
  })
  it('미지 명령 → help로 안내', () => {
    expect(parseCommand('/xyz')).toEqual({ cmd: 'help', arg: '' })
  })
  it('슬래시 없는 일반 텍스트 → null(무시)', () => {
    expect(parseCommand('안녕')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
})

describe('resolveSymbol', () => {
  const markets = [
    { market: 'KRW-SOPH', korean_name: '소폰' },
    { market: 'KRW-BTC', korean_name: '비트코인' },
    { market: 'KRW-SONIC', korean_name: '소닉' },
  ]
  it('영문 심볼(대소문자 무시)', () => {
    expect(resolveSymbol('soph', markets)).toEqual({ market: 'KRW-SOPH', korean_name: '소폰' })
  })
  it('한글명', () => {
    expect(resolveSymbol('비트코인', markets)).toEqual({ market: 'KRW-BTC', korean_name: '비트코인' })
  })
  it('KRW- 프리픽스 그대로', () => {
    expect(resolveSymbol('KRW-BTC', markets)).toEqual({ market: 'KRW-BTC', korean_name: '비트코인' })
  })
  it('미존재 → 부분일치 후보 최대 3개', () => {
    const r = resolveSymbol('소', markets)
    expect(r.notFound).toBe(true)
    expect(r.suggestions).toEqual(expect.arrayContaining(['소폰(SOPH)', '소닉(SONIC)']))
  })
  it('완전 미매칭 → 빈 후보', () => {
    expect(resolveSymbol('zzzz', markets)).toEqual({ notFound: true, suggestions: [] })
  })
})

describe('formatCoin', () => {
  it('지표·90일위치·유의지정·시그니처 포함', () => {
    const out = formatCoin({
      korean_name: '소폰', market: 'KRW-SOPH',
      indicators: { price: 5.02, rsi: 22.6, stoch: { k: 5.6 }, macd: { hist: -0.06 }, volRatio: 0.34, ema20: 6.4, ema50: 7.4 },
      quietBottom: { rsi: 22.6, stochK: 5.6, volRatio: 0.34 },
      designation: { warning: false, cautions: [] },
      pos90: 2,
    })
    expect(out).toContain('소폰')
    expect(out).toContain('SOPH')
    expect(out).toContain('5.02')
    expect(out).toContain('22.6')
    expect(out).toContain('90일')
    expect(out).toContain('조용한바닥')
  })
  it('유의지정 있으면 경고 표기', () => {
    const out = formatCoin({
      korean_name: '테스트', market: 'KRW-TT',
      indicators: { price: 100, rsi: 50, stoch: { k: 50 }, macd: { hist: 0 }, volRatio: 1, ema20: 100, ema50: 100 },
      quietBottom: null, designation: { warning: true, cautions: ['거래량급등'] }, pos90: 50,
    })
    expect(out).toContain('유의')
  })
  it('price(실시간가) 있으면 확정 종가 대신 그걸 표시', () => {
    const out = formatCoin({
      korean_name: '소폰', market: 'KRW-SOPH', price: 5.55,
      indicators: { price: 5.02, rsi: 30, stoch: { k: 10 }, macd: { hist: -0.1 }, volRatio: 1, ema20: 6, ema50: 7 },
      quietBottom: null, designation: { warning: false, cautions: [] }, pos90: 5,
    })
    expect(out).toContain('5.55')     // 실시간가
    expect(out).not.toContain('5.02') // 확정 종가는 헤더에 안 나옴
  })
  it('MACD null이면 하락(▼) 대신 "-"', () => {
    const out = formatCoin({
      korean_name: '신규', market: 'KRW-NEW',
      indicators: { price: 10, rsi: null, stoch: null, macd: null, volRatio: null, ema20: 10, ema50: 10 },
      quietBottom: null, designation: { warning: false, cautions: [] }, pos90: 0,
    })
    expect(out).toContain('MACD -')
    expect(out).not.toContain('▼')
  })
})

describe('formatStatus', () => {
  it('시장심리·매수매도·상위매수 포함', () => {
    const out = formatStatus({ ratio: 0.08, trend: 'bear', buyCount: 8, sellCount: 106, topBuy: [{ korean_name: '엘프', market: 'KRW-ELF', score: 16.9 }] })
    expect(out).toContain('0.08')
    expect(out).toContain('8')
    expect(out).toContain('엘프')
  })
})

describe('formatStrategy', () => {
  it('승률·SL/TP·보유목록', () => {
    const out = formatStrategy({ n: 13, sl: 2, tp: 0, time: 5, open: 6, noData: 0, winRate: 0.143, avgRet: -0.045, openList: [{ korean_name: '칠리즈', market: 'KRW-CTZ', ret1: -0.005 }] })
    expect(out).toContain('13')
    expect(out).toContain('14%')
    expect(out).toContain('칠리즈')
  })
})

describe('formatPositions', () => {
  it('빈 목록 안내', () => {
    expect(formatPositions([])).toContain('보유 포지션 없음')
  })
  it('종목·손절근접도', () => {
    const out = formatPositions([{ market: 'KRW-SOPH', korean_name: '소폰', price: 5.02, stopLoss: 5.54, toSLPct: -9.4 }])
    expect(out).toContain('소폰')
    expect(out).toContain('5.54')
  })
})

describe('formatScorecard', () => {
  it('지평선별 승률', () => {
    const out = formatScorecard({ h1: { winRate: 0.42, avgRet: 0.01, n: 401 }, h3: { winRate: 0.26, avgRet: -0.01, n: 300 }, h7: { winRate: 0.16, avgRet: -0.02, n: 200 }, total: 936, pendingCount: 20 })
    expect(out).toContain('42%')
    expect(out).toContain('936')
  })
})

describe('formatHelp / formatNotFound', () => {
  it('help는 명령어 나열', () => {
    const h = formatHelp()
    expect(h).toContain('/scan')
    expect(h).toContain('/코인')
  })
  it('notFound는 후보 제시', () => {
    expect(formatNotFound('소', ['소폰(SOPH)', '소닉(SONIC)'])).toContain('소폰(SOPH)')
  })
})
