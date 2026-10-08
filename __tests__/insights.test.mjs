import { describe, it, expect } from 'vitest'
import { topSignalsOfScan, bestHitRateSignal, isActiveSignal, MIN_STAT_SAMPLES } from '../lib/insights.mjs'

describe('topSignalsOfScan', () => {
  it('스캔의 매수/매도 신호 라벨 빈도 집계 (콤보/태그 제외)', () => {
    const scan = {
      buy: [
        { signals: ['Stoch 과매도 골든크로스 (5)', '[콤보] 반등확인 보너스'] },
        { signals: ['Stoch 과매도 골든크로스 (7)', 'BB 하단 지지'] },
      ],
      sell: [{ signals: ['MACD 하락'] }],
    }
    const r = topSignalsOfScan(scan)
    expect(r[0]).toEqual({ key: 'Stoch 과매도 골든크로스', count: 2 })
  })
})

describe('bestHitRateSignal', () => {
  it('표본 30 이상·현재 쓰는 신호 중 최고 적중률 — 표본 부족·제거된 신호는 제외', () => {
    const stats = {
      'RSI 과매도': { count: 40, hitRate: 0.2 },
      'BB 하단 지지': { count: 35, hitRate: 0.6 },
      'BB 상단 돌파': { count: 29, hitRate: 0.9 }, // 표본 30 미만
      '하락깃발 패턴': { count: 300, hitRate: 0.97 }, // 2026-10-08 제거된 신호
    }
    expect(bestHitRateSignal(stats)).toEqual({ key: 'BB 하단 지지', count: 35, hitRate: 0.6 })
  })
  it('조건 맞는 신호가 없으면 null', () => {
    expect(bestHitRateSignal({ 'RSI 과매도': { count: 7, hitRate: 0.9 } })).toBe(null)
  })
  it('isActiveSignal: 현재 SIGNAL_KEYS에 있는 키만 true', () => {
    expect(MIN_STAT_SAMPLES).toBe(30)
    expect(isActiveSignal('RSI 과매도')).toBe(true)
    expect(isActiveSignal('거래량 선행 매집')).toBe(false)
    expect(isActiveSignal('Stoch 과매수 데드크로스')).toBe(false)
  })
})
