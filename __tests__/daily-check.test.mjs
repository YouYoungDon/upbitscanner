import { describe, it, expect } from 'vitest'
import { scanSlots, newsEvents, taskFlags, paperActivity } from '../lib/daily-check.mjs'

const H = 3600_000
const T = (iso) => Date.parse(iso)

describe('scanSlots — 3시간 정시 슬롯(KST 00·03·…·21시 = UTC 3의 배수 시)', () => {
  const now = T('2026-10-21T00:30:00Z') // KST 09:30
  it('지난 24시간 슬롯 8개 중 빠진 슬롯과 슬롯별 소요(분)', () => {
    const ts = ['2026-10-20T03:00:40Z', '2026-10-20T06:00:50Z', '2026-10-20T09:01:10Z', '2026-10-20T12:00:40Z',
      '2026-10-20T15:08:00Z', /* 18시 빠짐 */ '2026-10-20T21:00:45Z', '2026-10-21T00:00:42Z']
    const r = scanSlots(ts, { nowMs: now, slotMinute: 0 })
    expect(r.expected).toBe(8) // 10-20 03:00Z ~ 10-21 00:00Z (00:30Z 기준 완료된 슬롯)
    expect(r.missing).toEqual(['2026-10-20T18:00:00.000Z'])
    expect(r.maxMin).toBeCloseTo(8, 6)
  })
  it('모멘텀은 xx:02 시작이라 소요는 슬롯+2분부터 잰다', () => {
    const r = scanSlots(['2026-10-21T00:02:50Z'], { nowMs: now, slotMinute: 2 })
    expect(r.durations.at(-1)).toBeCloseTo(50 / 60, 6)
  })
  it('슬롯 시작 후 15분이 안 지난 슬롯은 아직 세지 않는다', () => {
    const r = scanSlots([], { nowMs: T('2026-10-21T00:10:00Z'), slotMinute: 0 })
    expect(r.missing).not.toContain('2026-10-21T00:00:00.000Z')
  })
})

describe('newsEvents — 뉴스 데몬 로그의 소스 중단/회복', () => {
  const lines = [
    '2026-10-19T01:09:34.756Z 새 0 · 알림 0 · ⚠️뉴스 소스 중단: 바이낸스',
    '2026-10-20T11:07:31.864Z 새 1 · 알림 0 · ✅ 뉴스 소스 회복: 바이낸스',
    '2026-10-20T11:08:00.000Z 새 2 · 알림 1',
    '타임스탬프 없는 줄',
  ]
  it('기간 안의 중단·회복만 시각·종류·소스로', () => {
    expect(newsEvents(lines, T('2026-10-20T00:00:00Z'))).toEqual([{ at: '2026-10-20T11:07:31.864Z', type: '회복', source: '바이낸스' }])
  })
})

describe('taskFlags — 작업 스케줄러 이상', () => {
  const now = T('2026-10-21T00:00:00Z')
  const ok = (name, extra) => ({ name, state: 'Ready', lastRun: '2026-10-20T23:00:00Z', result: 0, ...extra })
  it('정상(0)·실행 중 코드는 통과, 그 밖의 결과 코드는 이상', () => {
    const flags = taskFlags([
      ok('UpbitMonitor'),
      ok('UpbitTelegramBot', { state: 'Running', result: 2147946720 }), // 이미 실행 중이라 새로 안 띄움(5분 감시)
      ok('UpbitPaper', { result: 1 }),
    ], now)
    expect(flags).toEqual([{ name: 'UpbitPaper', problem: '마지막 결과 코드 1' }])
  })
  it('상주 데몬이 Running이 아니면 이상', () => {
    expect(taskFlags([ok('UpbitNewsWatch', { state: 'Ready' })], now)[0].problem).toContain('상주 데몬')
  })
  it('작업이 9개가 아니면 알린다', () => {
    expect(taskFlags([ok('UpbitMonitor')], now, { expectedCount: 9 }).some((f) => f.problem.includes('9개'))).toBe(true)
  })
})

describe('paperActivity — 원장 이벤트 집계', () => {
  const ev = [
    { ev: 'open', src: 'random', logAt: '2026-10-20T00:01:00Z' },
    { ev: 'open', src: 'random', logAt: '2026-10-20T00:01:01Z' },
    { ev: 'close', src: 'main', exitType: 'sl', logAt: '2026-10-20T05:10:00Z' },
    { ev: 'no-cash', src: 'main', logAt: '2026-10-20T06:00:40Z' },
    { ev: 'open', src: 'main', logAt: '2026-10-18T00:00:00Z' }, // 기간 밖
  ]
  it('장부별 진입·청산·현금 부족 건수', () => {
    expect(paperActivity(ev, T('2026-10-19T12:00:00Z'))).toEqual({
      random: { open: 2, close: 0, noCash: 0, noFill: 0, stale: 0 },
      main: { open: 0, close: 1, noCash: 1, noFill: 0, stale: 0 },
    })
  })
})
