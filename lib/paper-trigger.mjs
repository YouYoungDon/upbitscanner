// 스캔 직후 모의매매를 바로 돌린다 — 매시 :10까지 기다리지 않게(체결 모델 v2, lib/paper.mjs 주석).
// 2026-10-15 측정: 매시 :10에만 돌 땐 모멘텀 스캔이 xx:10 직후에 끝나면 한 시간 뒤에 샀다(중앙값 60분, 건당 약 +0.4% 비싸게).
// 분리 프로세스로 띄우고 기다리지 않는다 — 모의매매가 실패해도 스캔 결과·알림엔 영향이 없다.
// 같은 스캔을 두 번 사지 않는 건 paper-trade의 잠금과 book.lastScan이 맡는다. PAPER_TRIGGER=0이면 끈다(검증용 수동 스캔).
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER = join(ROOT, 'scripts', 'run-logged.mjs')
const SCRIPT = join(ROOT, 'scripts', 'paper-trade.mjs')
const LOG = join(ROOT, 'data', 'task-logs', 'UpbitPaper.log')

export function triggerPaper({ env = process.env, spawnFn = spawn, reason = 'scan' } = {}) {
  if (env.PAPER_TRIGGER === '0') return false
  try {
    const child = spawnFn(process.execPath, [RUNNER, SCRIPT, LOG, '--after-scan', reason],
      { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true })
    child.on?.('error', () => {})
    child.unref?.()
    return true
  } catch {
    return false
  }
}
