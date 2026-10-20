import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// public/app.js는 브라우저 전역 스크립트라 import 불가 — 소스에서 순수 함수를 추출해 검증한다(scorecard-sort.test.mjs와 같은 방식).
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'), 'utf8').replace(/\r\n/g, '\n')
const pick = (name) => {
  const m = src.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`))
  if (!m) throw new Error(`${name} 추출 실패`)
  return m[0]
}
const { nextSort, sortTh, sortCoins } = (0, eval)(`(() => { const esc = (s) => String(s); ${pick('nextSort')}; ${pick('sortArrow')}; ${pick('sortTh')}; ${pick('sortCoins')}; return { nextSort, sortTh, sortCoins } })()`)

describe('nextSort — 표 정렬 버튼 순환', () => {
  it('새 열 → 내림차순 → 오름차순 → 해제', () => {
    const s = { key: null, dir: null }
    expect(nextSort(s, 'ret')).toEqual({ key: 'ret', dir: 'desc' })
    expect(nextSort(s, 'ret')).toEqual({ key: 'ret', dir: 'asc' })
    expect(nextSort(s, 'ret')).toEqual({ key: null, dir: null })
  })
  it('다른 열을 누르면 그 열 내림차순부터', () => {
    const s = { key: 'ret', dir: 'asc' }
    expect(nextSort(s, 'toStop')).toEqual({ key: 'toStop', dir: 'desc' })
  })
})

describe('sortTh — 열 머리 버튼', () => {
  it('표마다 다른 클래스(접두어)와 현재 방향 화살표', () => {
    const html = sortTh('po', { key: 'ret', dir: 'desc' }, 'ret', '수익률')
    expect(html).toContain('class="po-sort')
    expect(html).toContain('data-key="ret"')
    expect(html).toContain('▼')
    expect(sortTh('po', { key: 'ret', dir: 'desc' }, 'toStop', '손절선까지')).toContain('⇅')
  })
})

describe('보유 중 표 정렬 — sortCoins 재사용', () => {
  // 기본 순서(해제)는 호출부가 넘긴 순서 = 손절선에 가까운 순
  const rows = [{ name: 'A', toStop: -0.01, ret: -0.1 }, { name: 'B', toStop: null, ret: null }, { name: 'C', toStop: -0.2, ret: 0.05 }]
  it('현재가가 없는 줄(null)은 방향과 무관하게 맨 아래', () => {
    expect(sortCoins(rows, 'ret', 'desc').map((r) => r.name)).toEqual(['C', 'A', 'B'])
    expect(sortCoins(rows, 'ret', 'asc').map((r) => r.name)).toEqual(['A', 'C', 'B'])
  })
  it('해제면 기본 순서 그대로', () => {
    expect(sortCoins(rows, null, null).map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })
})
