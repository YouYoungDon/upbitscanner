import { describe, it, expect } from 'vitest'
import { buildTrendEntry } from '../lib/trend.mjs'

describe('buildTrendEntry', () => {
  const scans = [
    { timestamp: '2026-06-17T00:00:00Z', buy: [{ korean_name: '에이', score: 5 }], sell: [{}, {}, {}, {}] },
    {
      timestamp: '2026-06-17T12:00:00Z',
      buy: [
        { korean_name: '자마', score: 15.8, signals: ['거래량 급증 (3x)'] },
        { korean_name: '시커', score: 14.1, signals: [] },
      ],
      sell: [{}, {}],
    },
  ]
  it('최신 스캔 기준 수치 엔트리 + 마커', () => {
    const e = buildTrendEntry(scans)
    expect(e.scanTs).toBe('2026-06-17T12:00:00Z')
    expect(e.marker).toBe('<!-- scan:2026-06-17T12:00:00Z -->')
    expect(e.markdown).toContain('21:00')          // 12:00Z → 21:00 KST
    expect(e.markdown).toContain('시장심리 1')      // 2/2
    expect(e.markdown).toContain('자마(15.8)')
    expect(e.markdown).toContain('거래량 급증: 자마')
  })
  it('빈 배열 → null', () => {
    expect(buildTrendEntry([])).toBeNull()
  })
})
