import { describe, it, expect } from 'vitest'
import { aggregateRecommendations } from '../lib/recommend.mjs'

const NOW = Date.parse('2026-07-12T12:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString()

function scan(ts, buy) {
  return { timestamp: ts, buy, sell: [] }
}

describe('aggregateRecommendations', () => {
  it('빈 입력 → 빈 배열', () => {
    expect(aggregateRecommendations([], { windowMs: 86400000, now: NOW })).toEqual([])
  })

  it('윈도우 밖 스캔 제외', () => {
    const scans = [
      scan(hoursAgo(30), [{ market: 'KRW-A', korean_name: '에이', score: 9 }]), // 24h 밖
      scan(hoursAgo(2), [{ market: 'KRW-B', korean_name: '비', score: 7 }]),
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    expect(r.map((x) => x.market)).toEqual(['KRW-B'])
  })

  it('빈도 × 평균점수로 랭킹 (반복 등장 우위)', () => {
    const scans = [
      scan(hoursAgo(6), [{ market: 'KRW-A', korean_name: '에이', score: 6 }]),
      scan(hoursAgo(4), [{ market: 'KRW-A', korean_name: '에이', score: 8 }]),
      scan(hoursAgo(2), [{ market: 'KRW-A', korean_name: '에이', score: 7 }]),
      scan(hoursAgo(1), [{ market: 'KRW-B', korean_name: '비', score: 12 }]), // 단발 고점
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    // A: 3회 × avg7 = 21, B: 1회 × 12 = 12 → A 우위
    expect(r[0].market).toBe('KRW-A')
    expect(r[0].appearances).toBe(3)
    expect(r[0].avgScore).toBe(7)
    expect(r[0].maxScore).toBe(8)
    expect(r[0].rankScore).toBe(21)
    expect(r[1].market).toBe('KRW-B')
  })

  it('동점 rankScore는 등장횟수 우선', () => {
    const scans = [
      scan(hoursAgo(5), [{ market: 'KRW-A', korean_name: '에이', score: 6 }]),
      scan(hoursAgo(4), [{ market: 'KRW-A', korean_name: '에이', score: 6 }]),
      scan(hoursAgo(3), [{ market: 'KRW-B', korean_name: '비', score: 12 }]), // 1회 ×12 = 12 = 2회×6
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    expect(r[0].market).toBe('KRW-A') // 동점이면 더 자주 등장한 A
  })

  it('저유동성 매수는 제외', () => {
    const scans = [
      scan(hoursAgo(2), [
        { market: 'KRW-A', korean_name: '에이', score: 8 },
        { market: 'KRW-LOW', korean_name: '로우', score: 9, lowLiquidity: true },
      ]),
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    expect(r.map((x) => x.market)).toEqual(['KRW-A'])
  })

  it('마지막 등장의 signals·dominance·cg·lastSeen 보존', () => {
    const scans = [
      scan(hoursAgo(5), [{ market: 'KRW-A', korean_name: '에이', score: 6, signals: ['오래된'] }]),
      scan(hoursAgo(1), [{ market: 'KRW-A', korean_name: '에이', score: 8, signals: ['최신', 'GC'], dominance: { share: 0.9, mult: 0.8 }, cg: { rank: 100 } }]),
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    expect(r[0].lastSignals).toEqual(['최신', 'GC'])
    expect(r[0].dominance).toEqual({ share: 0.9, mult: 0.8 })
    expect(r[0].cg).toEqual({ rank: 100 })
    expect(r[0].lastSeen).toBe(hoursAgo(1))
  })

  it('잘못된 타임스탬프·buy 결측 방어', () => {
    const scans = [
      { timestamp: 'garbage', buy: [{ market: 'KRW-X', korean_name: '엑스', score: 9 }] },
      { timestamp: hoursAgo(2) }, // buy 없음
      scan(hoursAgo(1), [{ market: 'KRW-A', korean_name: '에이', score: 5 }]),
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    expect(r.map((x) => x.market)).toEqual(['KRW-A'])
  })

  it('점수 없는 매수는 0점 취급하지 않고 스킵', () => {
    const scans = [
      scan(hoursAgo(2), [{ market: 'KRW-A', korean_name: '에이' }]), // score 없음
      scan(hoursAgo(1), [{ market: 'KRW-A', korean_name: '에이', score: 8 }]),
    ]
    const r = aggregateRecommendations(scans, { windowMs: 86400000, now: NOW })
    expect(r[0].appearances).toBe(1)
    expect(r[0].avgScore).toBe(8)
  })
})
