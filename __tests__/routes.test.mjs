import { describe, it, expect } from 'vitest'
import { resolveRoute } from '../public/routes.js'

describe('resolveRoute', () => {
  it('구 신호 탭 별칭 → home', () => {
    for (const a of ['dashboard', 'recommend', 'momentum', 'flow', 'positions']) {
      expect(resolveRoute(a)).toBe('home')
    }
  })
  it('검증/기록 별칭 → review', () => {
    expect(resolveRoute('verify')).toBe('review')
    expect(resolveRoute('history')).toBe('review')
  })
  it('정식 라우트는 그대로', () => {
    expect(resolveRoute('home')).toBe('home')
    expect(resolveRoute('analyze')).toBe('analyze')
    expect(resolveRoute('review')).toBe('review')
  })
  it('미지/빈 값 → home', () => {
    expect(resolveRoute('nonsense')).toBe('home')
    expect(resolveRoute('')).toBe('home')
  })
})
