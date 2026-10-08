import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// public/app.js는 브라우저 전역 스크립트라 import 불가 — 소스에서 순수 함수를 추출해 검증한다.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'), 'utf8').replace(/\r\n/g, '\n')
const m = src.match(/function sortCoins\([^)]*\)\s*\{[\s\S]*?\n\}/)
if (!m) throw new Error('sortCoins 추출 실패')
const sortCoins = (0, eval)(`(${m[0]})`)

const coins = [
  { market: 'A', avg1: 0.02, lastEntry: '2026-10-03' },
  { market: 'B', avg1: null, lastEntry: '2026-10-08' },
  { market: 'C', avg1: -0.05, lastEntry: '2026-10-05' },
  { market: 'D', avg1: 0.1, lastEntry: '2026-10-01' },
]

describe('sortCoins', () => {
  it('내림차순, 값 없는 코인은 맨 아래', () => {
    expect(sortCoins(coins, 'avg1', 'desc').map((c) => c.market)).toEqual(['D', 'A', 'C', 'B'])
  })
  it('오름차순도 값 없는 코인은 맨 아래', () => {
    expect(sortCoins(coins, 'avg1', 'asc').map((c) => c.market)).toEqual(['C', 'A', 'D', 'B'])
  })
  it('정렬 없음이면 입력 순서 그대로, 입력은 바꾸지 않는다', () => {
    expect(sortCoins(coins, null, null).map((c) => c.market)).toEqual(['A', 'B', 'C', 'D'])
    sortCoins(coins, 'avg1', 'desc')
    expect(coins.map((c) => c.market)).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('sortCoins 문자열 열', () => {
  const cs = [
    { market: 'A', korean_name: '비트코인', lastEntry: '2026-10-03T00:00:00Z' },
    { market: 'B', korean_name: '가스', lastEntry: '2026-10-08T00:00:00Z' },
    { market: 'C', korean_name: '도지', lastEntry: null },
  ]
  it('이름은 가나다 순(오름차순)·역순(내림차순)', () => {
    expect(sortCoins(cs, 'korean_name', 'asc').map((c) => c.market)).toEqual(['B', 'C', 'A'])
    expect(sortCoins(cs, 'korean_name', 'desc').map((c) => c.market)).toEqual(['A', 'C', 'B'])
  })
  it('날짜 문자열 정렬, 값 없는 건 맨 아래', () => {
    expect(sortCoins(cs, 'lastEntry', 'desc').map((c) => c.market)).toEqual(['B', 'A', 'C'])
  })
})
