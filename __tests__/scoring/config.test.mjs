import { describe, it, expect } from 'vitest'
import { validateConfig, resolveGroup } from '../../lib/scoring/config.mjs'
import registry from '../../lib/scoring/features/index.mjs'

const base = { weights: { relative_volume: 1 }, groups: { relative_volume: 'early' }, tierCutoffs: { S: 85, A: 70, B: 55, C: 40 } }

describe('validateConfig', () => {
  it('정상 config → errors 없음', () => {
    expect(validateConfig(base, registry).errors).toEqual([])
  })
  it('음수 weight → error', () => {
    const r = validateConfig({ ...base, weights: { relative_volume: -1 } }, registry)
    expect(r.errors.some((e) => e.includes('negative'))).toBe(true)
  })
  it('없는 feature weight → warning', () => {
    const r = validateConfig({ ...base, weights: { ...base.weights, ghost: 1 } }, registry)
    expect(r.warnings.some((w) => w.includes('ghost'))).toBe(true)
  })
  it('잘못된 group → error', () => {
    const r = validateConfig({ ...base, groups: { relative_volume: 'sideways' } }, registry)
    expect(r.errors.some((e) => e.includes('group'))).toBe(true)
  })
  it('tierCutoffs 비단조 → warning', () => {
    const r = validateConfig({ ...base, tierCutoffs: { S: 50, A: 70, B: 55, C: 40 } }, registry)
    expect(r.warnings.some((w) => w.includes('monotonic'))).toBe(true)
  })
})

describe('resolveGroup', () => {
  it('config group 우선', () => {
    expect(resolveGroup('relative_volume', { relative_volume: 'confirm' }, registry)).toBe('confirm')
  })
  it('config 없으면 plugin defaultGroup fallback', () => {
    expect(resolveGroup('relative_volume', {}, registry)).toBe('early')
  })
})
