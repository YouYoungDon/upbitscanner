import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { SIGNAL_KEYS } from '../lib/signals.mjs'

// public/signal-dict.js는 브라우저 전역 스크립트 — vm 컨텍스트에서 실행해 전역을 꺼낸다.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'signal-dict.js'), 'utf8')
const ctx = vm.createContext({})
vm.runInContext(src, ctx)
const { signalInfo, signalBadge, SIGNAL_GROUPS } = ctx

// 현재 코드가 실제로 만드는 라벨(스캔 로그에서 수집한 모양 그대로).
const LIVE_LABELS = [
  ...SIGNAL_KEYS,
  'RSI 과매도 (24)', 'Stoch 과매도 골든크로스 (12)', 'Stoch 과매도 (9)', 'Williams %R 과매도 (-92)',
  '캔들 강세형 (상승장악형,샛별)', '캔들 약세형 (석별)', '거래량 급증 (3.4x)',
  '[콤보] 과매도 함정 페널티', '[콤보] 반등확인 보너스', '[MTF] 4시간봉 Stoch GC 확인',
  '[필터] 떨어지는칼(하락배열 속 GC)', '[레짐] BTC 약세 감점',
  '유동성 스윕 (깊이 1.2%)', '유동성 스윕 고점 (깊이 0.8%)', '🎯V-Bottom (RSI18·꼬리62%)', '🎯전략',
  '🔥지속 매수권 (3일+)', '지속 매수권 (2일)',
  '⚠️유동성 ×0.8', '⚠️업비트단독 85%', '⚠️업비트비중 62%',
  '⚡펀딩 과열', '⚡펀딩 경계', '⚡펀딩 스퀴즈연료(강)', '⚡펀딩 스퀴즈연료',
  '⚠️구조리스크(언락오버행(유통 20%)·거래소 주의)', '⚠️거래소이벤트(입출금중단·업비트)', '⚠️추격주의',
  'EMA 완전정배열 (20>50>200)', 'EMA 정배열 (20>50)', '연속양봉 4봉', 'EMA20 상승기울기',
  '200봉 신고가 갱신', '200봉 신고가 근접', 'MACD 3연속↑ + RSI 골디락스', 'MACD 히스토 3연속↑',
  'RSI 골디락스 (50~75)', 'OBV 매집 (선행)', 'OBV 추세확인', 'BB 스퀴즈 발산',
  'RSI 하락 다이버전스 (-4)', 'OBV 약화 (-2)',
]

describe('signalInfo', () => {
  it.each(LIVE_LABELS)('%s → 설명 있음', (label) => {
    const info = signalInfo(label)
    expect(info, label).toBeTruthy()
    expect(info.tip.length).toBeGreaterThan(10)
  })

  it('가장 긴 접두어가 이긴다', () => {
    expect(signalInfo('Stoch 과매도 골든크로스 (12)').key).toBe('Stoch 과매도 골든크로스')
    expect(signalInfo('MACD 하락전환').key).toBe('MACD 하락전환')
    expect(signalInfo('유동성 스윕 고점 (깊이 1%)').key).toBe('유동성 스윕 고점')
    expect(signalInfo('⚡펀딩 스퀴즈연료(강)').key).toBe('⚡펀딩 스퀴즈연료(강)')
  })

  it('옛 기록의 제거된 신호는 retired 그룹', () => {
    expect(signalInfo('쌍봉 패턴').group).toBe('retired')
    expect(signalInfo('[익절] Stoch DC — 매도 타이밍').group).toBe('retired')
    expect(signalInfo('Stoch 과매수 데드크로스 (88)').group).toBe('retired')
  })

  it('모르는 라벨은 null', () => {
    expect(signalInfo('완전히 새로운 신호')).toBeNull()
  })

  it('모든 항목의 그룹이 SIGNAL_GROUPS에 있다', () => {
    const ids = SIGNAL_GROUPS.map((g) => g.id)
    for (const l of LIVE_LABELS) expect(ids).toContain(signalInfo(l).group)
  })
})

describe('signalBadge', () => {
  it('원문+설명을 title로 달고 숫자를 짧은 이름에 남긴다', () => {
    const html = signalBadge('RSI 과매도 (24)')
    expect(html).toContain('title="RSI 과매도 (24)')
    expect(html).toContain('RSI(14)')
    expect(html).toContain('>RSI과매도 24<')
  })

  it('모르는 라벨도 원문 배지로 보여 준다(이스케이프)', () => {
    const html = signalBadge('새 <신호>')
    expect(html).toContain('새 &lt;신호&gt;')
    expect(html).toContain('badge-ghost')
  })
})
