// __tests__/news-route.test.mjs
import { describe, it, expect } from 'vitest'
import { alertReasons, alertKey, selectAlerts, formatNewsAlert } from '../lib/news/route.mjs'
import { emptyState } from '../lib/news/store.mjs'

const NOW = Date.parse('2026-10-07T13:41:00Z')
const rec = (o = {}) => ({
  item: { id: o.id || 'coinness:1', source: o.source || 'coinness', title: o.title || '제목', important: !!o.important, ts: null, codes: [] },
  markets: o.markets || [], via: {}, kind: o.kind || 'news', type: o.type ?? null, tags: o.tags || [],
})
const ctx = { held: new Set(['KRW-ID']), candidates: new Set(['KRW-STX']) }

describe('alertReasons', () => {
  it('공식 상장은 보유 무관 알림', () => {
    expect(alertReasons(rec({ kind: 'official-listing', type: 'binance-spot', markets: ['KRW-ZZZ'] }), ctx)).toEqual(['listing'])
  })
  it('공식 악재는 보유·후보일 때만(그 외는 monitor 담당)', () => {
    expect(alertReasons(rec({ kind: 'official-risk', type: 'halt', markets: ['KRW-ID'] }), ctx)).toEqual(['risk', 'held'])
    expect(alertReasons(rec({ kind: 'official-risk', type: 'halt', markets: ['KRW-ZZZ'] }), ctx)).toEqual([])
  })
  it('뉴스: 보유/후보/중요', () => {
    expect(alertReasons(rec({ markets: ['KRW-STX'] }), ctx)).toEqual(['candidate'])
    expect(alertReasons(rec({ markets: [], important: true }), ctx)).toEqual(['important'])
    expect(alertReasons(rec({ markets: ['KRW-ZZZ'] }), ctx)).toEqual([])
  })
  it('official-other는 알림 없음', () => {
    expect(alertReasons(rec({ kind: 'official-other', markets: ['KRW-ID'] }), ctx)).toEqual([])
  })
})

describe('selectAlerts', () => {
  it('6시간 내 같은 키는 다시 보내지 않음', () => {
    const r = rec({ markets: ['KRW-ID'] })
    const state = { ...emptyState(), alerted: { [alertKey(r)]: new Date(NOW - 3600000).toISOString() } }
    expect(selectAlerts([r], ctx, state, NOW).alerts).toEqual([])
  })
  it('같은 사이클 같은 키는 하나만', () => {
    const a = rec({ id: 'coinness:1', markets: ['KRW-ID'] }), b = rec({ id: 'coinness:2', markets: ['KRW-ID'] })
    expect(selectAlerts([a, b], ctx, emptyState(), NOW).alerts).toHaveLength(1)
  })
  it('공식 알림이 나간 코인의 뉴스는 30분 안엔 생략(같은 사건 이중 알림 방지)', () => {
    const off = rec({ id: 'upbit:1', source: 'upbit', kind: 'official-listing', type: 'upbit-krw', markets: ['KRW-ID'] })
    const news = rec({ id: 'coinness:5', markets: ['KRW-ID'] })
    const r1 = selectAlerts([off, news], ctx, emptyState(), NOW)
    expect(r1.alerts.map((a) => a.rec.item.id)).toEqual(['upbit:1'])
    const state = { ...emptyState(), alerted: { 'KRW-ID|upbit-krw': new Date(NOW - 10 * 60000).toISOString() } }
    expect(selectAlerts([news], ctx, state, NOW).alerts).toEqual([])
  })
})

describe('formatNewsAlert', () => {
  it('이유 이모지·출처·제목·티커', () => {
    const msg = formatNewsAlert([{ rec: rec({ source: 'upbit', kind: 'official-listing', type: 'upbit-krw', markets: ['KRW-NMR'], title: '뉴메레르(NMR) KRW 마켓 추가' }), reasons: ['listing'] }], '22:41')
    expect(msg).toContain('📰 뉴스·공지 (22:41)')
    expect(msg).toContain('🟢상장 · 업비트 · 뉴메레르(NMR) KRW 마켓 추가')
  })
  it('20줄 초과는 잘라서 "외 N건"', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ rec: rec({ id: `c:${i}`, important: true, title: `t${i}` }), reasons: ['important'] }))
    const msg = formatNewsAlert(many, '22:41')
    expect(msg).toContain('외 5건')
    expect(msg.length).toBeLessThan(4096)
  })
  it('공지(notices)도 덧붙임', () => {
    expect(formatNewsAlert([], '22:41', ['⚠️뉴스 소스 중단: 바이낸스'])).toContain('⚠️뉴스 소스 중단: 바이낸스')
  })
})
