import { describe, it, expect } from 'vitest'
import registry from '../../lib/scoring/features/index.mjs'
import relativeVolume from '../../lib/scoring/features/relativeVolume.mjs'

const ctx = (volumes) => ({ coin: { ohlcvDaily: volumes.map((v) => ({ volume: v, close: 10, high: 11, low: 9, open: 10, tradeValue: v * 10 })) } })

describe('feature contract', () => {
  it('registry는 배열이고 각 항목이 name/defaultGroup/normalizer/compute를 가진다', () => {
    expect(Array.isArray(registry)).toBe(true)
    for (const f of registry) {
      expect(typeof f.name).toBe('string')
      expect(['early', 'confirm']).toContain(f.defaultGroup)
      expect(typeof f.compute).toBe('function')
    }
  })
})

describe('relativeVolume', () => {
  it('오늘 거래량 / 20일 평균 (volRatio) 반환', () => {
    const vols = Array.from({ length: 20 }, () => 10).concat([30]) // 21봉, 마지막 3x
    const raw = relativeVolume.compute(ctx(vols))
    expect(raw).toBeCloseTo(3, 1)
  })
  it('캔들 부족(<21) → null', () => {
    expect(relativeVolume.compute(ctx([10, 10, 10]))).toBe(null)
  })
})
