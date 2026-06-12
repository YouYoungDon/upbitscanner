import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createScanRunner } from '../server/scan-job.mjs'

function fakeSpawn() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return { child, spawn: vi.fn(() => child) }
}

describe('createScanRunner', () => {
  it('시작하면 running, 종료코드 0이면 done', async () => {
    const { child, spawn } = fakeSpawn()
    const runner = createScanRunner({ spawn })
    const { jobId } = runner.start()
    expect(runner.get(jobId).status).toBe('running')
    child.stdout.emit('data', Buffer.from('스캔 대상 247종목 (전체 260)\n'))
    expect(runner.get(jobId).progress).toBeGreaterThanOrEqual(0)
    child.emit('close', 0)
    expect(runner.get(jobId).status).toBe('done')
  })

  it('이미 running이면 같은 jobId 반환', () => {
    const { spawn } = fakeSpawn()
    const runner = createScanRunner({ spawn })
    const a = runner.start()
    const b = runner.start()
    expect(a.jobId).toBe(b.jobId)
  })

  it('종료코드 1이면 error', () => {
    const { child, spawn } = fakeSpawn()
    const runner = createScanRunner({ spawn })
    const { jobId } = runner.start()
    child.emit('close', 1)
    expect(runner.get(jobId).status).toBe('error')
  })
})
