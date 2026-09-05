import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 대시보드 배지 회귀 가드 — public/app.js는 모듈이 아니라(전역 브라우저 스크립트) import 불가.
// 소스에서 순수 배지 함수를 추출·평가해 실제 렌더를 검증하고, topTable(매수 렌더러) 배선을 확인한다.
// 배지가 엉뚱한 테이블(모멘텀)에 붙어 항상 '' 나던 버그(2026-09) 재발 차단.
const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8')

function extractFn(name) {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'))
  if (!m) throw new Error('함수 추출 실패: ' + name)
  return m[0]
}

globalThis.esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const indirectEval = eval // 전역 스코프 정의 (ESM strict eval 스코프 누수 회피)
indirectEval([extractFn('kimchiBadge'), extractFn('fundingBadge'), extractFn('structRiskBadge')].join('\n'))
const { kimchiBadge, fundingBadge, structRiskBadge } = globalThis

describe('대시보드 배지 렌더', () => {
  it('kimchiBadge: flag 있으면 HTML, 없으면 빈 문자', () => {
    expect(kimchiBadge({ kimchi: { premium: 0.05, flag: 'overheat' } })).toContain('🇰🇷')
    expect(kimchiBadge({ kimchi: { premium: 0.05, flag: 'discount' } })).toContain('🇰🇷')
    expect(kimchiBadge({ kimchi: { premium: 0.001 } })).toBe('') // flag 없음 → 미표시
    expect(kimchiBadge({})).toBe('')
  })
  it('fundingBadge: 점수 개입(mult≠1)이면 HTML', () => {
    expect(fundingBadge({ funding: { rate: -0.0012, mult: 1.06 } })).toContain('⚡')
    expect(fundingBadge({ funding: { rate: 0.0012, mult: 0.82 } })).toContain('⚡')
    expect(fundingBadge({ funding: { rate: 0.0001, mult: 1 } })).toBe('') // 무개입 → 미표시
    expect(fundingBadge({})).toBe('')
  })
  it('structRiskBadge: flags 있으면 HTML', () => {
    const out = structRiskBadge({ structuralRisk: { mult: 0.765, level: 'high', flags: ['언락오버행(유통 22%)', '거래소 주의'] } })
    expect(out).toContain('🏗️')
    expect(out).toContain('언락오버행')
    expect(structRiskBadge({})).toBe('')
  })
})

describe('배지 배선 (버그 재발 가드)', () => {
  const topTableSrc = src.match(/function topTable[\s\S]*?\n\}/)[0]
  const momRowsSrc = src.match(/const momRows = [\s\S]*?join\(''\)/)[0]

  it('topTable(매수 렌더러)에 3배지가 배선됨', () => {
    expect(topTableSrc).toContain('kimchiBadge(x)')
    expect(topTableSrc).toContain('fundingBadge(x)')
    expect(topTableSrc).toContain('structRiskBadge(x)')
  })
  it('모멘텀 테이블(momRows)엔 매수 전용 배지가 없음(오배선 방지)', () => {
    expect(momRowsSrc).not.toContain('kimchiBadge(x)')
    expect(momRowsSrc).not.toContain('fundingBadge(x)')
    expect(momRowsSrc).not.toContain('structRiskBadge(x)')
  })
})
