import { describe, it, expect } from 'vitest'
import { topSignalsOfScan, bestHitRateSignal } from '../lib/insights.mjs'

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
  it('MIN_SAMPLES 이상 중 최고 적중률 신호', () => {
    const stats = {
      'RSI 과매도': { count: 5, hitRate: 0.2 },
      'Stoch 과매수 데드크로스': { count: 4, hitRate: 0.76 },
      'BB 상단 돌파': { count: 2, hitRate: 0.9 },
    }
    expect(bestHitRateSignal(stats)).toEqual({ key: 'Stoch 과매수 데드크로스', count: 4, hitRate: 0.76 })
  })
})
