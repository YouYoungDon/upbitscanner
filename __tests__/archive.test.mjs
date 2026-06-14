import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, existsSync, writeFileSync } from 'node:fs'
import { appendScan, readArchive, summarizeScans, coinHistory, scansInLastDays } from '../lib/archive.mjs'

let file
beforeEach(() => { file = join(tmpdir(), `arch-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`) })
afterEach(() => { if (existsSync(file)) rmSync(file) })

describe('appendScan/readArchive', () => {
  it('append한 스캔을 순서대로 읽음', () => {
    appendScan({ timestamp: 't1', buy: [], sell: [] }, file)
    appendScan({ timestamp: 't2', buy: [{ market: 'KRW-A' }], sell: [] }, file)
    const r = readArchive(file)
    expect(r).toHaveLength(2)
    expect(r[0].timestamp).toBe('t1')
    expect(r[1].buy[0].market).toBe('KRW-A')
  })
  it('파일 없으면 빈 배열', () => {
    expect(readArchive(file)).toEqual([])
  })
  it('깨진 줄은 건너뜀', () => {
    writeFileSync(file, '{"timestamp":"t1","buy":[],"sell":[]}\n깨진줄\n{"timestamp":"t2","buy":[],"sell":[]}\n')
    const r = readArchive(file)
    expect(r.map((s) => s.timestamp)).toEqual(['t1', 't2'])
  })
})

describe('summarizeScans', () => {
  it('스캔별 매수/매도 수 + 상위 매수 종목명', () => {
    const scans = [{
      timestamp: 't1',
      buy: [
        { korean_name: '에이', score: 5 },
        { korean_name: '비', score: 9 },
        { korean_name: '씨', score: 7 },
        { korean_name: '디', score: 1 },
      ],
      sell: [{ korean_name: '이' }],
    }]
    const r = summarizeScans(scans)
    expect(r[0]).toEqual({ timestamp: 't1', buyCount: 4, sellCount: 1, topBuy: ['비', '씨', '에이'] })
  })
})

describe('coinHistory', () => {
  it('해당 마켓이 등장한 스캔만 시간순으로', () => {
    const scans = [
      { timestamp: 't1', buy: [{ market: 'KRW-A', score: 6, signals: ['x'] }], sell: [] },
      { timestamp: 't2', buy: [], sell: [{ market: 'KRW-A', score: 4, signals: ['y'] }] },
      { timestamp: 't3', buy: [{ market: 'KRW-B', score: 5, signals: [] }], sell: [] },
    ]
    const r = coinHistory(scans, 'KRW-A')
    expect(r).toEqual([
      { timestamp: 't1', side: 'buy', score: 6, signals: ['x'] },
      { timestamp: 't2', side: 'sell', score: 4, signals: ['y'] },
    ])
  })
})

describe('scansInLastDays', () => {
  const now = Date.parse('2026-06-14T12:00:00Z')
  const scans = [
    { timestamp: '2026-06-06T12:00:00Z' }, // 8일 전 → 제외
    { timestamp: '2026-06-07T12:00:01Z' }, // 경계 1초 안쪽 → 포함
    { timestamp: '2026-06-14T00:00:00Z' }, // 당일 → 포함
  ]
  it('지난 N일 내 스캔만, 입력 순서 유지', () => {
    const out = scansInLastDays(scans, 7, now)
    expect(out.map((s) => s.timestamp)).toEqual([
      '2026-06-07T12:00:01Z',
      '2026-06-14T00:00:00Z',
    ])
  })
  it('빈 배열은 빈 배열', () => {
    expect(scansInLastDays([], 7, now)).toEqual([])
  })
})
