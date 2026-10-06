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

// 청산 성과 카드 — 규칙 행만 노출하면 읽는 사람이 엣지로 오독한다(실측에서 규칙은 평균을
// 7일 단순보유에 내준다). 기준선 행이 조용히 사라지거나 제목이 다시 하드코딩되는 것을 막는다.
// const 화살표 함수라 extractFn(함수 선언 전용)을 쓸 수 없어 블록을 잘라 eval한다.
describe('청산 성과 카드 렌더', () => {
  const block = src.match(/const exitRow = [\s\S]*?\n(?=    const rows = \(list\))/)[0]
  globalThis.pctCell = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
  // 추출 블록의 const는 eval 스코프에 갇히므로 같은 eval 안에서 전역으로 꺼낸다.
  indirectEval(`${block}\n;globalThis.exitStatsCard = exitStatsCard;`)
  const { exitStatsCard } = globalThis
  const stats = (over = {}) => ({
    live: { n: 0, winRate: null, meanRet: null, medianRet: null, reasons: {}, params: null, hold7: { n: 0 } },
    backfill: {
      n: 1582, winRate: 0.5436, meanRet: 0.0203, medianRet: 0.0225,
      reasons: { tp: 657, time: 613, sl: 312 },
      params: { slPct: 12, tpPct: 12, holdMax: 7, mixed: false },
      hold7: { n: 1582, winRate: 0.4956, meanRet: 0.0246, medianRet: 0, reasons: { hold7: 1582 } },
    },
    ...over,
  })

  it('규칙 행 바로 아래 7일단순보유 기준선 행을 같은 n으로 렌더', () => {
    const html = exitStatsCard(stats())
    expect(html).toContain('7일 단순보유(규칙 없음)')
    expect(html).toContain('동일 에피소드 n=1582')
    // 기준선 평균(+2.5%)이 규칙 평균(+2.0%)보다 높다는 사실이 표에 실제로 보여야 한다
    expect(html).toContain('+2.0%')
    expect(html).toContain('+2.5%')
    expect(html.indexOf('소급 계산')).toBeLessThan(html.indexOf('7일 단순보유'))
  })
  it('제목은 저장된 파라미터에서 생성 (하드코딩 금지)', () => {
    expect(exitStatsCard(stats())).toContain('SL 12% · TP 12% · 최대 7일 보유')
    const other = stats({ backfill: { ...stats().backfill, params: { slPct: 10, tpPct: 18, holdMax: 5, mixed: false } } })
    expect(exitStatsCard(other)).toContain('SL 10% · TP 18% · 최대 5일 보유')
  })
  it('파라미터 세대가 섞이면 제목에 경고', () => {
    const mixed = stats({ backfill: { ...stats().backfill, params: { slPct: 12, tpPct: 12, holdMax: 7, mixed: true } } })
    expect(exitStatsCard(mixed)).toContain('파라미터 세대 혼재')
  })
  it('기준선 표본이 없으면 기준선 행을 붙이지 않는다', () => {
    const none = stats({ backfill: { ...stats().backfill, hold7: { n: 0 } } })
    expect(exitStatsCard(none)).not.toContain('7일 단순보유(규칙 없음)')
  })
  it('한계 주석: 하락장 비율·홀드아웃 손실·표본기간·에피소드 중첩을 모두 명시', () => {
    const html = exitStatsCard(stats())
    expect(html).toContain('99.8%')
    expect(html).not.toContain('97.8%')
    expect(html).toContain('3.31%p')
    expect(html).toContain('3.5개월')
    expect(html).toContain('중첩')
  })
})
