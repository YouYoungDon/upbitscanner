// __tests__/news-health.test.mjs
import { describe, it, expect } from 'vitest'
import { newsDaemonStale } from '../lib/news/health.mjs'

const NOW = Date.parse('2026-10-07T13:41:00Z')
describe('newsDaemonStale', () => {
  it('상태 없음(미설치) → 경고 안 함', () => {
    expect(newsDaemonStale(null, {}, NOW).warn).toBe(false)
  })
  it('10분 이내 → 정상', () => {
    expect(newsDaemonStale({ lastLoopAt: new Date(NOW - 5 * 60000).toISOString() }, {}, NOW).warn).toBe(false)
  })
  it('10분 초과 → 경고, 같은 KST 날짜엔 1회만', () => {
    const st = { lastLoopAt: new Date(NOW - 11 * 60000).toISOString() }
    const r1 = newsDaemonStale(st, {}, NOW)
    expect(r1.warn).toBe(true)
    expect(newsDaemonStale(st, r1.health, NOW + 3600000).warn).toBe(false)
  })
})
