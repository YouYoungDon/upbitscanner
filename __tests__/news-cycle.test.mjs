// __tests__/news-cycle.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { runCycle, SOURCE_EVERY_MS } from '../lib/news/cycle.mjs'
import { emptyState } from '../lib/news/store.mjs'

const NOW = Date.parse('2026-10-07T13:41:00Z')
const markets = [{ market: 'KRW-ID', korean_name: '스페이스아이디', english_name: 'Space ID' }, { market: 'KRW-NMR', korean_name: '뉴메레르', english_name: 'Numeraire' }]
const ni = (id, source, title, o = {}) => ({ id, source, title, body: null, ts: o.ts ?? null, url: null, important: !!o.important, codes: o.codes || [] })

function mkDeps(over = {}) {
  return {
    fetchers: {
      coinness: vi.fn(async () => [ni('coinness:1', 'coinness', 'ID 고래 이체', { codes: ['ID'] })]),
      upbit: vi.fn(async () => [ni('upbit:1', 'upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가', { ts: '2026-10-07T13:00:00.000Z' })]),
      binance: vi.fn(async () => []),
      bithumb: vi.fn(async () => []),
      ...(over.fetchers || {}),
    },
    getMarkets: vi.fn(async () => markets),
    readCtx: vi.fn(async () => ({ held: new Set(['KRW-ID']), candidates: new Set(), positions: [{ market: 'KRW-ID' }] })),
    ensureEvents: vi.fn(async () => ({ byMarket: {}, newEvents: [] })),
    appendLog: vi.fn(async () => {}),
    send: vi.fn(async () => true),
    whenLabel: () => '22:41',
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'fetchers')),
  }
}

describe('runCycle', () => {
  it('첫 실행: seen만 기록, 알림 없음, 로그는 남김', async () => {
    const deps = mkDeps()
    const r = await runCycle({ state: emptyState(), nowMs: NOW, deps })
    expect(deps.send).not.toHaveBeenCalled()
    expect(r.state.initialized).toBe(true)
    expect(Object.keys(r.state.seen)).toEqual(expect.arrayContaining(['coinness:1', 'upbit:1']))
    expect(deps.appendLog).toHaveBeenCalledTimes(1)
  })
  it('다음 사이클: 새 항목만 알림, 전송 성공 시 alerted 기록', async () => {
    const deps = mkDeps()
    const s1 = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:2', 'coinness', '스페이스아이디 메인넷 업그레이드')])
    deps.fetchers.upbit = vi.fn(async () => [ni('upbit:2', 'upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가')])
    const r = await runCycle({ state: s1, nowMs: NOW + 61000, deps })
    expect(deps.send).toHaveBeenCalledTimes(1)
    const msg = deps.send.mock.calls[0][0]
    expect(msg).toContain('🟢상장 · 업비트')
    expect(msg).toContain('💼보유 · 코인니스 · 스페이스아이디 메인넷 업그레이드')
    expect(Object.keys(r.state.alerted)).toEqual(expect.arrayContaining(['KRW-NMR|upbit-krw', 'KRW-ID|news']))
  })
  it('전송 실패 시 alerted를 기록하지 않음', async () => {
    const deps = mkDeps({ send: vi.fn(async () => false) })
    const s1 = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:3', 'coinness', 'ID 고래', { codes: ['ID'] })])
    const r = await runCycle({ state: s1, nowMs: NOW + 61000, deps })
    expect(r.state.alerted).toEqual({})
  })
  it('주기가 안 된 소스는 호출하지 않음(바이낸스 5분)', async () => {
    const deps = mkDeps()
    const s1 = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    await runCycle({ state: s1, nowMs: NOW + 61000, deps })
    expect(deps.fetchers.binance).toHaveBeenCalledTimes(1)
    await runCycle({ state: s1, nowMs: NOW + SOURCE_EVERY_MS.binance, deps })
    expect(deps.fetchers.binance).toHaveBeenCalledTimes(2)
  })
  it('공식 소스 결과를 ensureEvents에 alerting:false로 전달(바이낸스 ts null 포함)', async () => {
    const deps = mkDeps({ fetchers: { binance: vi.fn(async () => [ni('binance:7', 'binance', 'Binance Will Delist ABC (ABC)')]) } })
    await runCycle({ state: emptyState(), nowMs: NOW, deps })
    const [mk, opts] = deps.ensureEvents.mock.calls[0]
    expect(mk).toEqual(['KRW-ID', 'KRW-NMR'])
    expect(opts.alerting).toBe(false)
    expect(await opts.deps.fetchBinanceAnnouncements()).toEqual([{ id: 'binance:7', title: 'Binance Will Delist ABC (ABC)', ts: null }])
    expect(await opts.deps.fetchBithumbAnnouncements()).toEqual([])
  })
  it('소스 30분 연속 실패 → 중단 알림 1회, 회복 → 회복 알림', async () => {
    const deps = mkDeps({ fetchers: { bithumb: vi.fn(async () => null) } })
    let s = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    s = (await runCycle({ state: s, nowMs: NOW + 31 * 60000, deps })).state
    expect(deps.send.mock.calls.at(-1)[0]).toContain('⚠️뉴스 소스 중단: 빗썸')
    const calls = deps.send.mock.calls.length
    s = (await runCycle({ state: s, nowMs: NOW + 33 * 60000, deps })).state
    expect(deps.send.mock.calls.length).toBe(calls) // 중복 경고 없음
    deps.fetchers.bithumb = vi.fn(async () => [])
    s = (await runCycle({ state: s, nowMs: NOW + 36 * 60000, deps })).state
    expect(deps.send.mock.calls.at(-1)[0]).toContain('✅ 뉴스 소스 회복: 빗썸')
  })
  it('깨진 상태(빈 객체)도 첫 실행처럼 무알림 복구', async () => {
    const deps = mkDeps()
    const r = await runCycle({ state: {}, nowMs: NOW, deps })
    expect(deps.send).not.toHaveBeenCalled()
    expect(r.state.initialized).toBe(true)
  })
})

describe('최종 리뷰 수정 (2026-10-07)', () => {
  const DAY = 86400000
  it('#1 피드에 남아 있는 항목은 7일이 지나도 새 글이 아니다', async () => {
    const deps = mkDeps()
    let s = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    for (let d = 1; d <= 10; d++) s = (await runCycle({ state: s, nowMs: NOW + d * DAY, deps })).state
    expect(deps.send).not.toHaveBeenCalled()
  })
  it('#2 첫 사이클에 모든 소스가 실패해도, 각 소스의 첫 성공은 조용히 seen만', async () => {
    const fail = { coinness: vi.fn(async () => null), upbit: vi.fn(async () => null), binance: vi.fn(async () => null), bithumb: vi.fn(async () => null) }
    const deps = mkDeps({ fetchers: fail })
    let s = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:9', 'coinness', 'ID 고래', { codes: ['ID'] })])
    deps.fetchers.upbit = vi.fn(async () => [ni('upbit:9', 'upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가')])
    s = (await runCycle({ state: s, nowMs: NOW + 61000, deps })).state
    expect(deps.send).not.toHaveBeenCalled()
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:10', 'coinness', 'ID 메인넷', { codes: ['ID'] })])
    await runCycle({ state: s, nowMs: NOW + 122000, deps })
    expect(deps.send).toHaveBeenCalledTimes(1)
  })
  it('#4 전송 실패한 알림은 30분 안의 다음 사이클에 다시 보낸다', async () => {
    const deps = mkDeps()
    let s = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.send = vi.fn(async () => false)
    deps.fetchers.coinness = vi.fn(async () => [ni('coinness:20', 'coinness', 'ID 고래 이체', { codes: ['ID'] })])
    s = (await runCycle({ state: s, nowMs: NOW + 61000, deps })).state
    deps.send = vi.fn(async () => true)
    deps.fetchers.coinness = vi.fn(async () => [])
    s = (await runCycle({ state: s, nowMs: NOW + 122000, deps })).state
    expect(deps.send).toHaveBeenCalledTimes(1)
    expect(deps.send.mock.calls[0][0]).toContain('ID 고래 이체')
    expect(s.pending).toEqual([])
  })
  it('#10 마켓 목록이 비면 그 사이클은 seen 처리하지 않는다(다음에 다시 판정)', async () => {
    const deps = mkDeps()
    let s = (await runCycle({ state: emptyState(), nowMs: NOW, deps })).state
    deps.getMarkets = vi.fn(async () => [])
    deps.fetchers.upbit = vi.fn(async () => [ni('upbit:30', 'upbit', '뉴메레르(NMR) KRW, USDT 마켓 디지털 자산 추가')])
    s = (await runCycle({ state: s, nowMs: NOW + 61000, deps })).state
    expect(s.seen['upbit:30']).toBeUndefined()
    deps.getMarkets = vi.fn(async () => markets)
    await runCycle({ state: s, nowMs: NOW + 122000, deps })
    expect(deps.send.mock.calls.at(-1)[0]).toContain('🟢상장')
  })
})
