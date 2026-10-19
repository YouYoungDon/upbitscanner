import { describe, it, expect } from 'vitest'
import { obvDivergence, rsiBullDivergence, wBottom, baseBuilding, volumeClimax } from '../scripts/research/signal-ablation/company-signals.mjs'

const bar = (close, { open = close, high = Math.max(open, close) * 1.005, low = Math.min(open, close) * 0.995, volume = 100 } = {}) => ({ open, high, low, close, volume })
const flat = (n, p = 100, v = 100) => Array.from({ length: n }, () => bar(p, { volume: v }))

describe('company signals (research replay detectors)', () => {
  it('obvDivergence: price flat while up-volume dominates', () => {
    const w = flat(30)
    for (let i = 10; i < 30; i++) w[i] = bar(i % 2 ? 100.2 : 100, { volume: i % 2 ? 300 : 50 }) // 오를 때 거래량 큼
    w[29] = bar(100, { volume: 50 })
    expect(obvDivergence(w)).toBe(true)
    const up = w.map((c, i) => bar(100 + i, { volume: c.volume })) // 가격이 오르면 다이버전스 아님
    expect(obvDivergence(up)).toBe(false)
  })

  it('wBottom: two lows within 3% then close breaks the neckline today', () => {
    const w = flat(50, 110)
    const set = (i, low, close) => { w[i] = bar(close, { low, high: close * 1.01 }) }
    for (let i = 30; i < 50; i++) set(i, 104, 106)
    set(32, 100, 101) // 첫 저점
    for (let i = 35; i < 40; i++) set(i, 107, 109) // 네크라인 ~110
    set(42, 101, 102) // 둘째 저점 (1% 차이)
    set(48, 105, 109)
    set(49, 108, 112) // 오늘 돌파
    expect(wBottom(w)).toBe(true)
    w[48] = bar(111, { low: 108 }) // 어제 이미 위였으면 '오늘 돌파' 아님
    expect(wBottom(w)).toBe(false)
  })

  it('baseBuilding: tight range, shrinking volume, then a volume-backed up day', () => {
    const w = [...flat(16, 100, 200), ...flat(15, 101, 100)]
    w.push(bar(102, { open: 100.5, volume: 200 }))
    expect(baseBuilding(w)).toBe(true)
    w[w.length - 1] = bar(100, { open: 101, volume: 200 }) // 음봉이면 회복 아님
    expect(baseBuilding(w)).toBe(false)
  })

  it('volumeClimax: a 4x-volume down bar in the last 5 days, then +3% above its close', () => {
    const w = flat(30)
    w[27] = bar(90, { open: 100, volume: 500 })
    w[28] = bar(91)
    w.push(bar(93))
    expect(volumeClimax(w)).toBe(true)
    w[w.length - 1] = bar(92)
    expect(volumeClimax(w)).toBe(false)
  })

  it('rsiBullDivergence: lower price low with a higher RSI low under 45', () => {
    const closes = []
    for (let i = 0; i < 30; i++) closes.push(120 - i) // 긴 하락 → RSI 낮음
    for (let i = 0; i < 8; i++) closes.push(91 + i * 0.5) // 반등
    for (let i = 0; i < 6; i++) closes.push(94 - i * 0.6) // 완만한 재하락 → 더 낮은 저점, RSI는 덜 낮음
    closes.push(90.2, 90.6, 91.5, 92.4, 93)
    const w = closes.map((c) => bar(c))
    expect(typeof rsiBullDivergence(w)).toBe('boolean')
    expect(rsiBullDivergence(flat(60))).toBe(false)
  })
})
