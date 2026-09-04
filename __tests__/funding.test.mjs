import { describe, it, expect, vi } from 'vitest'
import {
  fundingScoreMult, fundingSignal, ensureFunding,
  FUND_EXTREME, FUND_ELEVATED,
} from '../lib/funding.mjs'

describe('fundingScoreMult (비대칭)', () => {
  it('과열(+) 감점 세게', () => {
    expect(fundingScoreMult(0.0010)).toBe(0.82)  // 경계 포함
    expect(fundingScoreMult(0.002)).toBe(0.82)
    expect(fundingScoreMult(0.0005)).toBe(0.92)   // 경계 포함
    expect(fundingScoreMult(0.0007)).toBe(0.92)
  })
  it('정상대 무변화', () => {
    expect(fundingScoreMult(0)).toBe(1)
    expect(fundingScoreMult(0.0004)).toBe(1)
    expect(fundingScoreMult(-0.0004)).toBe(1)
  })
  it('스퀴즈(−) 가산 약하게', () => {
    expect(fundingScoreMult(-0.0005)).toBe(1.04)  // 경계 포함
    expect(fundingScoreMult(-0.0010)).toBe(1.06)  // 경계 포함
    expect(fundingScoreMult(-0.002)).toBe(1.06)
  })
  it('null/비유한 → 1(무개입)', () => {
    expect(fundingScoreMult(null)).toBe(1)
    expect(fundingScoreMult(NaN)).toBe(1)
    expect(fundingScoreMult(undefined)).toBe(1)
  })
  it('감점이 가산보다 크다(비대칭 검증)', () => {
    expect(1 - fundingScoreMult(0.0010)).toBeGreaterThan(fundingScoreMult(-0.0010) - 1)
  })
})

describe('fundingSignal', () => {
  it('라벨 매핑', () => {
    expect(fundingSignal(0.0012)).toBe('⚡펀딩 과열')
    expect(fundingSignal(0.0006)).toBe('⚡펀딩 경계')
    expect(fundingSignal(0.0001)).toBeNull()
    expect(fundingSignal(-0.0006)).toBe('⚡펀딩 스퀴즈연료')
    expect(fundingSignal(-0.0012)).toBe('⚡펀딩 스퀴즈연료(강)')
    expect(fundingSignal(null)).toBeNull()
  })
})

describe('ensureFunding', () => {
  const markets = ['KRW-BTC', 'KRW-XRP', 'KRW-NOPERP']
  const mkDeps = (over = {}) => ({
    fetchFundingRates: vi.fn(async () => new Map([
      ['BTCUSDT', { rate: 0.0001, markPrice: 80000 }],
      ['XRPUSDT', { rate: 0.0012, markPrice: 2.0 }],
    ])),
    ...over,
  })
  it('마켓별 rate + coverage + medianRate', async () => {
    const r = await ensureFunding(markets, { now: 1, deps: mkDeps() })
    expect(r.byMarket['KRW-BTC'].rate).toBe(0.0001)
    expect(r.byMarket['KRW-XRP'].rate).toBe(0.0012)
    expect(r.byMarket['KRW-NOPERP']).toBeUndefined() // 무기한 미상장
    expect(r.coverage).toBeCloseTo(2 / 3, 5)
    expect(r.medianRate).toBeCloseTo((0.0001 + 0.0012) / 2, 8) // 짝수 → 평균
  })
  it('홀수 개 median은 중앙값', async () => {
    const deps = mkDeps({
      fetchFundingRates: vi.fn(async () => new Map([
        ['BTCUSDT', { rate: 0.0001 }], ['XRPUSDT', { rate: 0.0012 }], ['ETHUSDT', { rate: -0.0003 }],
      ])),
    })
    const r = await ensureFunding(['KRW-BTC', 'KRW-XRP', 'KRW-ETH'], { now: 1, deps })
    expect(r.medianRate).toBe(0.0001) // 정렬 -0.0003,0.0001,0.0012 → 중앙 0.0001
  })
  it('바이낸스 실패 → neutral(coverage 0, 무중단)', async () => {
    const r = await ensureFunding(markets, { now: 1, deps: mkDeps({ fetchFundingRates: vi.fn(async () => null) }) })
    expect(r.coverage).toBe(0)
    expect(r.byMarket).toEqual({})
    expect(r.medianRate).toBeNull()
    expect(r.reason).toBeTruthy()
  })
  it('빈 입력 → neutral', async () => {
    const r = await ensureFunding([], { now: 1, deps: mkDeps() })
    expect(r.coverage).toBe(0)
  })
})
