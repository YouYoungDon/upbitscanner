import { describe, it, expect, afterEach } from 'vitest'
import { rollingAppend, clampWeight, ewmTarget, writeJson, readJson, withLock, DATA_DIR } from '../lib/store.mjs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const TEST_FILES = ['__t_counter__.json', '__t_counter__.lock', '__t_throw__.lock']
afterEach(async () => {
  for (const f of TEST_FILES) await rm(join(DATA_DIR, f), { force: true }).catch(() => {})
})

describe('withLock', () => {
  it('동시 read-modify-write 직렬화 → 갱신 유실 없음', async () => {
    await writeJson('__t_counter__.json', { n: 0 })
    const inc = () => withLock('__t_counter__', async () => {
      const c = await readJson('__t_counter__.json', { n: 0 })
      await new Promise((r) => setTimeout(r, 15)) // 경합창 확대
      await writeJson('__t_counter__.json', { n: c.n + 1 })
    })
    await Promise.all([inc(), inc(), inc()])
    expect((await readJson('__t_counter__.json', { n: 0 })).n).toBe(3) // 락 없으면 1
  })

  it('fn이 throw해도 락 해제 (다음 획득 가능)', async () => {
    await expect(withLock('__t_throw__', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    let ran = false
    await withLock('__t_throw__', async () => { ran = true })
    expect(ran).toBe(true)
  })
})

describe('writeJson (원자적)', () => {
  it('쓰기 후 정확한 내용 반환', async () => {
    await writeJson('__t_counter__.json', { n: 42, s: 'x' })
    expect(await readJson('__t_counter__.json', null)).toEqual({ n: 42, s: 'x' })
  })
})

describe('rollingAppend', () => {
  it('최대 길이 초과 시 오래된 항목 제거', () => {
    const arr = [1, 2, 3]
    expect(rollingAppend(arr, 4, 3)).toEqual([2, 3, 4])
  })
  it('한도 미만이면 그대로 append', () => {
    expect(rollingAppend([1], 2, 3)).toEqual([1, 2])
  })
})

describe('ewmTarget', () => {
  it('hitRate별 target', () => {
    expect(ewmTarget(0.8)).toBe(1.5)
    expect(ewmTarget(0.6)).toBe(1.0)
    expect(ewmTarget(0.3)).toBe(0.7)
  })
})

describe('clampWeight', () => {
  it('0.5~2.0 범위로 제한', () => {
    expect(clampWeight(0.8 * 1.4 + 0.2 * 1.5)).toBeCloseTo(1.42, 5)
    expect(clampWeight(5)).toBe(2.0)
    expect(clampWeight(0.1)).toBe(0.5)
  })
})
