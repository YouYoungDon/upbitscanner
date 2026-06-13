import { spawn as nodeSpawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MONITOR = join(ROOT, 'scripts', 'monitor.mjs')

// spawn 주입 가능(테스트용). 동시 1개 실행 제한.
export function createScanRunner({ spawn = nodeSpawn } = {}) {
  const jobs = new Map()
  let activeId = null

  function start() {
    if (activeId && jobs.get(activeId)?.status === 'running') {
      return { jobId: activeId }
    }
    const jobId = `scan-${Date.now()}`
    const job = { status: 'running', progress: 0, startedAt: Date.now(), finishedAt: null, message: '' }
    jobs.set(jobId, job)
    activeId = jobId

    const child = spawn(process.execPath, [MONITOR], { cwd: ROOT })
    child.stdout.on('data', (d) => {
      const text = d.toString()
      if (/스캔 대상/.test(text)) job.progress = 10
      if (/완료/.test(text)) { job.progress = 100; job.message = text.trim() }
    })
    child.stderr.on('data', (d) => { job.message = d.toString().trim() })
    child.on('close', (code) => {
      job.finishedAt = Date.now()
      job.status = code === 0 ? 'done' : 'error'
      if (code === 0 && job.progress < 100) job.progress = 100
    })
    return { jobId }
  }

  function get(jobId) {
    return jobs.get(jobId) || null
  }

  return { start, get }
}
