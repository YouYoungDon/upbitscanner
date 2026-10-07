// __tests__/news-store.test.mjs
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState, pruneState, newItems, markSeen, appendNewsLog } from '../lib/news/store.mjs'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const H = 3600000

describe('news store', () => {
  it('emptyState 형태', () => {
    expect(emptyState()).toEqual({ initialized: false, seen: {}, alerted: {}, sourceFail: {}, lastFetchAt: {}, lastLoopAt: null })
  })
  it('newItems: seen·배치 중복 제외', () => {
    const s = { ...emptyState(), seen: { 'a:1': new Date(NOW).toISOString() } }
    const r = newItems([{ id: 'a:1' }, { id: 'a:2' }, { id: 'a:2' }], s)
    expect(r.map((x) => x.id)).toEqual(['a:2'])
  })
  it('markSeen은 입력 불변', () => {
    const s0 = emptyState()
    const s1 = markSeen(s0, [{ id: 'a:9' }], NOW)
    expect(s1.seen['a:9']).toBe(new Date(NOW).toISOString())
    expect(s0.seen).toEqual({})
  })
  it('pruneState: seen 7일·alerted 6시간 초과 제거', () => {
    const s = { ...emptyState(),
      seen: { old: new Date(NOW - 8 * 24 * H).toISOString(), fresh: new Date(NOW - H).toISOString() },
      alerted: { 'KRW-A|news': new Date(NOW - 7 * H).toISOString(), 'KRW-B|news': new Date(NOW - H).toISOString() } }
    const p = pruneState(s, NOW)
    expect(Object.keys(p.seen)).toEqual(['fresh'])
    expect(Object.keys(p.alerted)).toEqual(['KRW-B|news'])
  })
  it('appendNewsLog: jsonl 한 줄씩 추가', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'news-'))
    await appendNewsLog([{ a: 1 }, { b: 2 }], { dir })
    await appendNewsLog([{ c: 3 }], { dir })
    const lines = readFileSync(join(dir, 'news-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })
})
