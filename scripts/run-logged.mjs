// 작업 스케줄러 실행기 — node 스크립트를 돌리며 stdout·stderr를 로그 파일에 이어 붙인다.
// 사용: node scripts/run-logged.mjs <스크립트> <로그파일> [인자...]
// 예전엔 cmd /c "node ... 1>> log 2>&1"로 돌렸는데, Windows 11에선 그게 Windows Terminal 창으로 떠서
// 창을 닫으면 상주 봇이 Ctrl+C 종료(0xC000013A)로 죽었다(2026-10-08). install-scheduler.ps1이
// conhost.exe --headless로 이 실행기를 띄워 창 없이 돌린다. conhost는 cmd의 이중 따옴표를 깨뜨려서
// 리다이렉트를 cmd 대신 여기서 한다.
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'

const [script, log, ...args] = process.argv.slice(2)
if (!script || !log) {
  console.error('usage: node scripts/run-logged.mjs <script> <logfile> [args...]')
  process.exit(2)
}

const fd = openSync(log, 'a')
const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', fd, fd] })
child.on('error', (e) => { console.error(e); process.exit(1) })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
