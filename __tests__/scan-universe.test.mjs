import { describe, it, expect } from 'vitest'
import { getScanUniverse, MIN_TRADE_PRICE_24H, liquidityMultiplier, liquidityPenalty, LOW_LIQUIDITY_24H, upbitDominancePenalty } from '../lib/scan-universe.mjs'

describe('getScanUniverse', () => {
  const markets = [
    { market: 'KRW-A', korean_name: '에이' },
    { market: 'KRW-B', korean_name: '비' },
    { market: 'KRW-C', korean_name: '씨' },
  ]
  it('거래대금 임계 이상만 targets, nameOf/total 구성', async () => {
    const tickers = [
      { market: 'KRW-A', acc_trade_price_24h: MIN_TRADE_PRICE_24H },       // 통과
      { market: 'KRW-B', acc_trade_price_24h: MIN_TRADE_PRICE_24H - 1 },   // 탈락
      { market: 'KRW-C', acc_trade_price_24h: MIN_TRADE_PRICE_24H * 2 },   // 통과
    ]
    const r = await getScanUniverse({
      getMarkets: async () => markets,
      getTicker: async (codes) => tickers.filter((t) => codes.includes(t.market)),
      delay: 0,
    })
    expect(r.targets).toEqual(['KRW-A', 'KRW-C'])
    expect(r.nameOf['KRW-C']).toBe('씨')
    expect(r.total).toBe(3)
    expect(r.tradePrice['KRW-C']).toBe(MIN_TRADE_PRICE_24H * 2)
  })
  it('마켓 없으면 빈 결과', async () => {
    const r = await getScanUniverse({ getMarkets: async () => [], getTicker: async () => [], delay: 0, marketRetryDelay: 0 })
    expect(r).toEqual({ targets: [], nameOf: {}, total: 0, warnOf: {} })
  })
  it('마켓 조회 일시 실패 시 재시도 후 성공 (다초 장애 흡수 → 스캔 공백 방지)', async () => {
    let calls = 0
    const r = await getScanUniverse({
      getMarkets: async () => { calls++; return calls <= 2 ? null : markets }, // 2회 실패 후 성공
      getTicker: async (codes) => markets.map((m) => ({ market: m.market, acc_trade_price_24h: MIN_TRADE_PRICE_24H * 2 })).filter((t) => codes.includes(t.market)),
      delay: 0,
      marketRetryDelay: 0,
    })
    expect(calls).toBe(3) // 1회차 + 재시도 2회
    expect(r.targets).toEqual(['KRW-A', 'KRW-B', 'KRW-C'])
  })
  it('유의종목 플래그를 warnOf에 매핑 (warning/caution만, 정상은 제외)', async () => {
    const warned = [
      { market: 'KRW-A', korean_name: '에이', warning: true },
      { market: 'KRW-B', korean_name: '비', caution: true },
      { market: 'KRW-C', korean_name: '씨' }, // 정상
    ]
    const tickers = warned.map((m) => ({ market: m.market, acc_trade_price_24h: MIN_TRADE_PRICE_24H * 2 }))
    const r = await getScanUniverse({
      getMarkets: async () => warned,
      getTicker: async (codes) => tickers.filter((t) => codes.includes(t.market)),
      delay: 0,
    })
    expect(r.warnOf['KRW-A']).toBe('warning')
    expect(r.warnOf['KRW-B']).toBe('caution')
    expect(r.warnOf['KRW-C']).toBeUndefined() // 정상 종목은 키 없음
  })
})

describe('liquidityMultiplier', () => {
  it('구간별 배수', () => {
    expect(liquidityMultiplier(60_0000_0000)).toBe(1.0)   // 60억
    expect(liquidityMultiplier(30_0000_0000)).toBe(0.9)   // 30억
    expect(liquidityMultiplier(10_0000_0000)).toBe(0.8)   // 10억
    expect(liquidityMultiplier(3_0000_0000)).toBe(0.6)    // 3억
  })
  it('경계: 50억=1.0, 20억=0.9, 5억=0.8', () => {
    expect(liquidityMultiplier(50_0000_0000)).toBe(1.0)
    expect(liquidityMultiplier(20_0000_0000)).toBe(0.9)
    expect(liquidityMultiplier(5_0000_0000)).toBe(0.8)
  })
  it('저유동성 기준선 5억', () => {
    expect(LOW_LIQUIDITY_24H).toBe(500_000_000)
  })
})

describe('liquidityPenalty', () => {
  it('50억+ → 감점·라벨 없음, lowLiq false', () => {
    expect(liquidityPenalty(60_0000_0000)).toEqual({ liqMult: 1.0, lowLiq: false, label: null })
  })
  it('5~20억 → ×0.8 라벨, lowLiq false (5억 이상)', () => {
    expect(liquidityPenalty(10_0000_0000)).toEqual({ liqMult: 0.8, lowLiq: false, label: '⚠️유동성 ×0.8' })
  })
  it('1~5억 → ×0.6 라벨, lowLiq true', () => {
    expect(liquidityPenalty(3_0000_0000)).toEqual({ liqMult: 0.6, lowLiq: true, label: '⚠️유동성 ×0.6' })
  })
  it('미상(undefined) → 0 취급 ×0.6·lowLiq true', () => {
    expect(liquidityPenalty(undefined)).toEqual({ liqMult: 0.6, lowLiq: true, label: '⚠️유동성 ×0.6' })
  })
})

describe('upbitDominancePenalty', () => {
  it('글로벌 데이터 없음/0/업비트 null → 중립', () => {
    expect(upbitDominancePenalty(1e9, null)).toEqual({ mult: 1.0, share: null, label: null })
    expect(upbitDominancePenalty(1e9, 0)).toEqual({ mult: 1.0, share: null, label: null })
    expect(upbitDominancePenalty(null, 1e9)).toEqual({ mult: 1.0, share: null, label: null })
  })
  it('비중 80%+ → ×0.8 + 업비트단독 라벨', () => {
    const r = upbitDominancePenalty(8e9, 1e10)
    expect(r.mult).toBe(0.8)
    expect(r.share).toBe(0.8)
    expect(r.label).toBe('⚠️업비트단독 80%')
  })
  it('비중 50%+ → ×0.9 + 업비트비중 라벨', () => {
    const r = upbitDominancePenalty(5e9, 1e10)
    expect(r.mult).toBe(0.9)
    expect(r.label).toBe('⚠️업비트비중 50%')
  })
  it('비중 50% 미만 → 감점 없음, share는 기록', () => {
    const r = upbitDominancePenalty(3e9, 1e10)
    expect(r).toEqual({ mult: 1.0, share: 0.3, label: null })
  })
  it('업비트가 글로벌보다 크면(집계 시차) share는 1로 캡', () => {
    const r = upbitDominancePenalty(2e10, 1e10)
    expect(r.share).toBe(1)
    expect(r.mult).toBe(0.8)
  })
  it('경계 반올림 일관성: 0.7995 → share 0.8 → tier ×0.8 + 80% 라벨', () => {
    expect(upbitDominancePenalty(7.995e9, 1e10)).toEqual({ mult: 0.8, share: 0.8, label: '⚠️업비트단독 80%' })
  })
})
