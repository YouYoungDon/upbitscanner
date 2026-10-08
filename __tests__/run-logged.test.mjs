import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUNNER = join(import.meta.dirname, '..', 'scripts', 'run-logged.mjs')

describe('run-logged', () => {
  it('appends child stdout+stderr to the log and passes the exit code through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'run-logged-'))
    const child = join(dir, 'child.mjs')
    const log = join(dir, 'out.log')
    writeFileSync(child, "console.log('to stdout'); console.error('to stderr'); process.exit(3)\n")
    writeFileSync(log, 'earlier line\n')

    const r = spawnSync(process.execPath, [RUNNER, child, log])

    expect(r.status).toBe(3)
    const text = readFileSync(log, 'utf8')
    expect(text.startsWith('earlier line\n')).toBe(true)
    expect(text).toContain('to stdout')
    expect(text).toContain('to stderr')
  })

  it('exits non-zero with a usage message when arguments are missing', () => {
    const r = spawnSync(process.execPath, [RUNNER])
    expect(r.status).not.toBe(0)
    expect(String(r.stderr)).toMatch(/usage/i)
  })
})
