import { describe, it, expect, vi } from 'vitest'
import {
  computePremium, mapToBinance, premiumBand, coinFlag, ensureKimchi,
  OVERHEAT_PCT, DISCOUNT_PCT, COIN_FLAG_PCT,
} from '../lib/kimchi.mjs'

describe('computePremium', () => {
  it('KRW / (USDT*환율) - 1', () => {
    // 1e8 / (70000 * 1400) - 1 = 0.020408...
    expect(computePremium(1e8, 70000, 1400)).toBeCloseTo(0.020408, 5)
  })
  it('디스카운트(음수) 케이스', () => {
    expect(computePremium(9.6e7, 70000, 1400)).toBeLessThan(0)
  })
  it('비유한/0/음수 입력 → null', () => {
    expect(computePremium(null, 70000, 1400)).toBeNull()
    expect(computePremium(1e8, 0, 1400)).toBeNull()
    expect(computePremium(1e8, 70000, NaN)).toBeNull()
    expect(computePremium(-1, 70000, 1400)).toBeNull()
  })
})

describe('mapToBinance', () => {
  it('KRW- 제거 + USDT', () => {
    expect(mapToBinance('KRW-BTC')).toBe('BTCUSDT')
    expect(mapToBinance('KRW-XRP')).toBe('XRPUSDT')
  })
})

describe('premiumBand', () => {
  it('과열/보통/디스카운트 경계', () => {
    expect(premiumBand(0.05)).toBe('overheat')
    expect(premiumBand(OVERHEAT_PCT)).toBe('overheat') // 경계 포함
    expect(premiumBand(0.01)).toBe('normal')
    expect(premiumBand(DISCOUNT_PCT)).toBe('discount') // 경계 포함
    expect(premiumBand(-0.05)).toBe('discount')
    expect(premiumBand(null)).toBeNull()
  })
})

describe('coinFlag (BTC 대비 상대)', () => {
  it('국내과열/디스카운트/무플래그', () => {
    expect(coinFlag(0.06, 0.02)).toBe('overheat')   // +4%p
    expect(coinFlag(0.02 + COIN_FLAG_PCT, 0.02)).toBe('overheat') // 경계
    expect(coinFlag(0.03, 0.02)).toBeNull()          // +1%p
    expect(coinFlag(-0.02, 0.02)).toBe('discount')   // -4%p
    expect(coinFlag(null, 0.02)).toBeNull()
    expect(coinFlag(0.06, null)).toBeNull()
  })
})

describe('ensureKimchi', () => {
  // monitor가 스캔 중 확보한 KRW 시세를 넘겨받음. 바이낸스는 매 스캔 신선 조회(캐시 없음).
  const krwPrices = { 'KRW-BTC': 1e8, 'KRW-XRP': 2900, 'KRW-NOTONBINANCE': 5 }
  const mkDeps = (over = {}) => ({
    fetchBinancePrices: vi.fn(async () => new Map([['BTCUSDT', 70000], ['XRPUSDT', 2.0]])),
    getTicker: vi.fn(async () => [{ market: 'KRW-USDT', trade_price: 1400 }]),
    ...over,
  })
  it('프리미엄 계산 + coverage + btcPremium + 환율', async () => {
    const r = await ensureKimchi(krwPrices, { now: 1_000_000, deps: mkDeps() })
    expect(r.usdtKrw).toBe(1400)
    expect(r.byMarket['KRW-BTC'].premium).toBeCloseTo(1e8 / (70000 * 1400) - 1, 6)
    expect(r.byMarket['KRW-XRP'].premium).toBeCloseTo(2900 / (2.0 * 1400) - 1, 6)
    expect(r.btcPremium).toBeCloseTo(r.byMarket['KRW-BTC'].premium, 10)
    expect(r.byMarket['KRW-NOTONBINANCE']).toBeUndefined() // 바이낸스 미존재
    expect(r.coverage).toBeCloseTo(2 / 3, 5)
  })
  it('KRW-USDT 환율 조회 실패 → 전부 null, 게이지 null', async () => {
    const r = await ensureKimchi(krwPrices, { now: 1_000_000, deps: mkDeps({ getTicker: vi.fn(async () => []) }) })
    expect(r.coverage).toBe(0)
    expect(r.btcPremium).toBeNull()
    expect(r.byMarket).toEqual({})
  })
  it('바이낸스 실패 → coverage 0, 스캔 무중단(neutral)', async () => {
    const r = await ensureKimchi(krwPrices, { now: 1_000_000, deps: mkDeps({ fetchBinancePrices: vi.fn(async () => null) }) })
    expect(r.coverage).toBe(0)
    expect(r.byMarket).toEqual({})
    expect(r.reason).toBeTruthy()
  })
  it('빈 입력 → neutral', async () => {
    const r = await ensureKimchi({}, { now: 1_000_000, deps: mkDeps() })
    expect(r.coverage).toBe(0)
  })
})
