import { describe, it, expect, afterEach } from 'vitest'
import { rollingAppend, clampWeight, ewmTarget, writeJson, readJson, withLock, DATA_DIR, hitComponent, returnComponent, qualityTarget, newWeight, readWeights } from '../lib/store.mjs'
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

describe('학습 컴포넌트 (적중률+수익)', () => {
  it('hitComponent 선형 매핑 + 클램프', () => {
    expect(hitComponent(0.4)).toBeCloseTo(0.7, 5)
    expect(hitComponent(0.7)).toBeCloseTo(1.5, 5)
    expect(hitComponent(0.55)).toBeCloseTo(1.1, 5)
    expect(hitComponent(0.2)).toBeCloseTo(0.7, 5) // <0.4 클램프
    expect(hitComponent(0.9)).toBeCloseTo(1.5, 5) // >0.7 클램프
  })
  it('returnComponent B안: +25% 상한, 하한 0.85, null→1', () => {
    expect(returnComponent(0)).toBeCloseTo(1.0, 5)
    expect(returnComponent(25)).toBeCloseTo(1.25, 5)
    expect(returnComponent(40)).toBeCloseTo(1.25, 5) // 상한
    expect(returnComponent(10)).toBeCloseTo(1.10, 5)
    expect(returnComponent(-3)).toBeCloseTo(0.97, 5)
    expect(returnComponent(-30)).toBeCloseTo(0.85, 5) // 하한
    expect(returnComponent(null)).toBe(1)
    expect(returnComponent(NaN)).toBe(1)
  })
  it('qualityTarget = hit×return, 검증값', () => {
    expect(qualityTarget(0.754, 9.79)).toBeCloseTo(1.647, 2)
    expect(qualityTarget(0.318, -1.96)).toBeCloseTo(0.686, 2)
  })
  it('newWeight 0.7/0.3 블렌드, avgReturn 반영', () => {
    // old 1.0, hit 0.7(→1.5), ret +25(→1.25) → target clamp(1.875)=1.875 → 1*0.7+1.875*0.3=1.2625
    expect(newWeight(1.0, 0.7, 25)).toBeCloseTo(1.2625, 3)
    // avgReturn 생략 시 return성분 1.0
    expect(newWeight(1.0, 0.7)).toBeCloseTo(1.0 * 0.7 + 1.5 * 0.3, 3)
  })
})

describe('readWeights', () => {
  it('함수이며 Promise 반환', async () => {
    expect(typeof readWeights).toBe('function')
    const w = await readWeights()
    expect(w && typeof w === 'object').toBe(true)
  })
})
