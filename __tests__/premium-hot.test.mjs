import { describe, it, expect } from 'vitest'
import { splitPremiumHot, premiumHotList, COIN_FLAG_PCT } from '../lib/kimchi.mjs'
import { selectPremiumAlerts, formatPremiumAlert, ALERT_COOLDOWN_MS } from '../lib/premium-alert.mjs'

const kimchi = {
  btcPremium: 0.01,
  byMarket: {
    'KRW-BTC': { premium: 0.01 },
    'KRW-AAA': { premium: 0.05 },   // BTC 대비 +4%p → 과열
    'KRW-BBB': { premium: 0.035 },  // +2.5%p → 정상
    'KRW-CCC': { premium: -0.03 },  // −4%p → 디스카운트(제외 대상 아님)
    'KRW-DDD': { premium: 0.09 },   // +8%p → 과열
    'KRW-USDT': { premium: 0.0 },
  },
}

describe('splitPremiumHot', () => {
  const items = [{ market: 'KRW-AAA', score: 9 }, { market: 'KRW-BBB', score: 8 }, { market: 'KRW-CCC', score: 7 }, { market: 'KRW-ZZZ', score: 6 }]
  it('BTC 대비 +3%p 이상만 분리하고, 모든 항목에 프리미엄·플래그를 붙인다', () => {
    const { keep, hot } = splitPremiumHot(items, kimchi)
    expect(COIN_FLAG_PCT).toBe(0.03)
    expect(hot.map((x) => x.market)).toEqual(['KRW-AAA'])
    expect(hot[0].kimchi).toMatchObject({ flag: 'overheat' })
    expect(hot[0].kimchi.rel).toBeCloseTo(0.04, 12)
    expect(keep.map((x) => x.market)).toEqual(['KRW-BBB', 'KRW-CCC', 'KRW-ZZZ'])
    expect(keep[1].kimchi.flag).toBe('discount')
    expect(keep[2].kimchi).toBeUndefined() // 바이낸스 미상장 → 판단 없음
  })
  it('프리미엄 조회 실패(BTC 프리미엄 없음)면 아무것도 빼지 않는다', () => {
    const { keep, hot } = splitPremiumHot(items, { btcPremium: null, byMarket: {} })
    expect(hot).toEqual([])
    expect(keep).toHaveLength(4)
  })
  it('입력 항목을 바꾸지 않는다', () => {
    const src = [{ market: 'KRW-AAA' }]
    splitPremiumHot(src, kimchi)
    expect(src[0].kimchi).toBeUndefined()
  })
})

describe('premiumHotList', () => {
  it('전 종목 중 과열만 BTC 대비 높은 순으로, BTC·USDT 제외', () => {
    const list = premiumHotList(kimchi, { 'KRW-AAA': '에이', 'KRW-DDD': '디' })
    expect(list.map((x) => x.market)).toEqual(['KRW-DDD', 'KRW-AAA'])
    expect(list[0]).toMatchObject({ korean_name: '디' })
    expect(list[0].rel).toBeCloseTo(0.08, 12)
  })
  it('limit 적용, 조회 실패면 빈 목록', () => {
    expect(premiumHotList(kimchi, {}, 1)).toHaveLength(1)
    expect(premiumHotList({ btcPremium: null, byMarket: {} }, {})).toEqual([])
  })
})

describe('selectPremiumAlerts', () => {
  const held = [{ market: 'KRW-AAA', korean_name: '에이' }, { market: 'KRW-BBB', korean_name: '비' }]
  const now = 1_000_000_000_000
  it('보유 코인 중 과열만, 24시간에 한 번', () => {
    const r1 = selectPremiumAlerts(held, kimchi, {}, now)
    expect(r1.fires.map((f) => f.market)).toEqual(['KRW-AAA'])
    expect(r1.state['KRW-AAA']).toBe(now)
    const r2 = selectPremiumAlerts(held, kimchi, r1.state, now + ALERT_COOLDOWN_MS - 1)
    expect(r2.fires).toEqual([])
    const r3 = selectPremiumAlerts(held, kimchi, r1.state, now + ALERT_COOLDOWN_MS)
    expect(r3.fires.map((f) => f.market)).toEqual(['KRW-AAA'])
  })
  it('보유가 없거나 조회 실패면 조용', () => {
    expect(selectPremiumAlerts([], kimchi, {}, now).fires).toEqual([])
    expect(selectPremiumAlerts(held, { btcPremium: null, byMarket: {} }, {}, now).fires).toEqual([])
  })
  it('알림 문구: 코인·BTC 대비 프리미엄·근거', () => {
    const msg = formatPremiumAlert([{ market: 'KRW-AAA', korean_name: '에이', premium: 0.05, rel: 0.04 }])
    expect(msg).toContain('에이(AAA)')
    expect(msg).toContain('BTC 대비 +4.0%p')
    expect(msg).toContain('매도 신호')
  })
})

describe('티커 충돌(다른 자산) 방어', () => {
  // 업비트와 바이낸스에서 같은 티커가 다른 코인인 경우(실측: PROS 17배, DATA 수백 배) 프리미엄이 수천 %로 나온다
  const k = { btcPremium: 0.0, byMarket: { 'KRW-BTC': { premium: 0 }, 'KRW-PROS': { premium: 16.8 }, 'KRW-ICX': { premium: 0.67 }, 'KRW-LOW': { premium: -0.9 } } }
  it('BTC 대비 ±100%p 이상은 판단하지 않는다(분리·목록·알림 모두 제외)', () => {
    const { keep, hot } = splitPremiumHot([{ market: 'KRW-PROS' }, { market: 'KRW-ICX' }, { market: 'KRW-LOW' }], k)
    expect(hot.map((x) => x.market)).toEqual(['KRW-ICX'])
    expect(keep.find((x) => x.market === 'KRW-PROS').kimchi).toEqual({ mismatch: true })
    expect(premiumHotList(k, {}).map((x) => x.market)).toEqual(['KRW-ICX'])
    expect(selectPremiumAlerts([{ market: 'KRW-PROS' }], k, {}, 0).fires).toEqual([])
  })
})
