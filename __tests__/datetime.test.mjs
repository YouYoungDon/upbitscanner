import { describe, it, expect } from 'vitest'
import { DAY_SECONDS, utcDay } from '../lib/datetime.mjs'

describe('utcDay', () => {
  it('ISO 타임스탬프 → UTC day 인덱스', () => {
    expect(utcDay('1970-01-01T00:00:00Z')).toBe(0)
    expect(utcDay('1970-01-02T00:00:00Z')).toBe(1)
    expect(utcDay('1970-01-02T23:59:59Z')).toBe(1) // 같은 UTC day
  })
  it('같은 날의 다른 시각은 같은 day', () => {
    expect(utcDay('2026-08-30T01:00:00Z')).toBe(utcDay('2026-08-30T23:00:00Z'))
  })
  it('파싱 실패 → NaN (산술 전파용)', () => {
    expect(Number.isNaN(utcDay('not-a-date'))).toBe(true)
    expect(Number.isNaN(utcDay(undefined))).toBe(true)
  })
  it('DAY_SECONDS = 86400', () => {
    expect(DAY_SECONDS).toBe(86400)
  })
})
