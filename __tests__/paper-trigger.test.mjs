import { describe, it, expect } from 'vitest'
import { triggerPaper } from '../lib/paper-trigger.mjs'

const fakeSpawn = () => {
  const calls = []
  const fn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} } }
  return { fn, calls }
}

describe('triggerPaper', () => {
  it('spawns paper-trade through run-logged, detached, logging to UpbitPaper.log', () => {
    const s = fakeSpawn()
    expect(triggerPaper({ env: {}, spawnFn: s.fn, reason: 'main' })).toBe(true)
    expect(s.calls).toHaveLength(1)
    const { cmd, args, opts } = s.calls[0]
    expect(cmd).toBe(process.execPath)
    expect(args[0]).toMatch(/run-logged\.mjs$/)
    expect(args[1]).toMatch(/paper-trade\.mjs$/)
    expect(args[2]).toMatch(/UpbitPaper\.log$/)
    expect(args.slice(3)).toEqual(['--after-scan', 'main'])
    expect(opts.detached).toBe(true)
    expect(opts.stdio).toBe('ignore')
  })
  it('does nothing when PAPER_TRIGGER=0 (manual verification scans)', () => {
    const s = fakeSpawn()
    expect(triggerPaper({ env: { PAPER_TRIGGER: '0' }, spawnFn: s.fn })).toBe(false)
    expect(s.calls).toHaveLength(0)
  })
  it('never throws into the scan even if spawning fails', () => {
    expect(triggerPaper({ env: {}, spawnFn: () => { throw new Error('boom') } })).toBe(false)
  })
})
