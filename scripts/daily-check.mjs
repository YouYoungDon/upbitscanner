// 일일 점검 — 작업 스케줄러·절전/재시작·스캔 슬롯·뉴스 소스·모의매매를 한 번에 본다(읽기 전용, API 호출 없음).
// 실행: node scripts/daily-check.mjs [시간=24]. /daily-check 스킬이 이 출력을 받아 해석한다.
// 판단 기준은 lib/daily-check.mjs. 어떤 항목이 실패해도 나머지는 계속 출력하고 종료 코드는 0(스킬 주입이 끊기지 않게).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DATA_DIR } from '../lib/store.mjs'
import { scanSlots, newsEvents, taskFlags, paperActivity } from '../lib/daily-check.mjs'

const HOURS = Number(process.argv[2]) || 24
const now = Date.now()
const since = now - HOURS * 3600_000
const kst = (ms) => new Date(ms + 9 * 3600_000).toISOString().slice(5, 16).replace('T', ' ')
const readJson = (f) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'))
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 60_000 }).trim()
const section = (title, fn) => {
  console.log(`\n## ${title}`)
  try { fn() } catch (e) { console.log(`- ⚠️ 점검 실패: ${e.message.split('\n')[0]}`) }
}

console.log(`# 일일 점검 — ${kst(now)} KST 기준 지난 ${HOURS}시간`)

section('작업 스케줄러', () => {
  const raw = ps("Get-ScheduledTask -TaskName 'Upbit*' | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{name=$_.TaskName; state=[string]$_.State; lastRun=$i.LastRunTime.ToUniversalTime().ToString('o'); result=$i.LastTaskResult} } | ConvertTo-Json -Compress")
  const tasks = [].concat(JSON.parse(raw || '[]'))
  const flags = taskFlags(tasks, now, { expectedCount: 9 })
  console.log(flags.length ? flags.map((f) => `- ❌ ${f.name}: ${f.problem}`).join('\n') : `- ✅ ${tasks.length}개 모두 정상(결과 코드·상주 데몬 실행 중)`)
  for (const t of tasks) console.log(`  - ${t.name} ${t.state} · 마지막 ${kst(Date.parse(t.lastRun))} · 결과 ${t.result}`)
})

section('절전·재시작', () => {
  // 42 = 절전 진입(Kernel-Power), 1074 = 재시작/종료 요청, 6008 = 비정상 종료, 41 = 전원 끊김
  // 이벤트가 하나도 없으면 Get-WinEvent가 "No events were found" 오류로 끝난다 — 없는 게 정상이라 빈 결과로 바꾼다
  const raw = ps(`try { Get-WinEvent -FilterHashtable @{LogName='System'; Id=42,1074,6008,41; StartTime=(Get-Date).AddHours(-${HOURS})} -ErrorAction Stop | ForEach-Object { [pscustomobject]@{at=$_.TimeCreated.ToUniversalTime().ToString('o'); id=$_.Id} } | ConvertTo-Json -Compress } catch { if ($_.FullyQualifiedErrorId -notmatch 'NoMatchingEventsFound') { throw } }; exit 0`)
  const evs = raw ? [].concat(JSON.parse(raw)) : []
  const NAME = { 42: '절전', 1074: '재시작/종료 요청', 6008: '비정상 종료', 41: '전원 끊김' }
  if (!evs.length) { console.log('- ✅ 없음'); return }
  const count = evs.reduce((a, e) => ({ ...a, [NAME[e.id] || e.id]: (a[NAME[e.id] || e.id] || 0) + 1 }), {})
  console.log(`- ⚠️ ${Object.entries(count).map(([k, n]) => `${k} ${n}회`).join(' · ')} — 최근 5건: ${evs.slice(0, 5).map((e) => `${kst(Date.parse(e.at))} ${NAME[e.id] || e.id}`).join(', ')}`)
})

section('스캔 슬롯 (3시간마다)', () => {
  const show = (label, file, slotMinute) => {
    const ts = (readJson(file).scans || []).map((s) => s.timestamp)
    const r = scanSlots(ts, { nowMs: now, slotMinute, hours: HOURS })
    const dur = r.durations.length ? `소요 최대 ${r.maxMin.toFixed(1)}분 · 평균 ${(r.durations.reduce((a, b) => a + b, 0) / r.durations.length).toFixed(1)}분` : '소요 -'
    const miss = r.missing.length ? ` · ❌ 빠진 슬롯 ${r.missing.map((m) => kst(Date.parse(m))).join(', ')}` : ''
    console.log(`- ${r.missing.length ? '❌' : '✅'} ${label}: ${r.expected - r.missing.length}/${r.expected} · ${dur}${miss}`)
  }
  show('반등(monitor, xx:00)', 'monitor-log.json', 0)
  show('모멘텀(xx:02)', 'momentum-log.json', 2)
  const last = (readJson('monitor-log.json').scans || []).at(-1)
  console.log(`- 마지막 반등 스캔 ${last ? kst(Date.parse(last.timestamp)) : '-'} · 매수 ${last?.buy?.length ?? '-'} · 무작위 대조 후보(universe) ${Array.isArray(last?.universe) ? `${last.universe.length}종목` : '❌ 없음'}`)
})

section('뉴스 데몬', () => {
  const p = join(DATA_DIR, 'task-logs', 'UpbitNewsWatch.log')
  const lines = existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []
  const evs = newsEvents(lines, since)
  console.log(evs.length ? evs.map((e) => `- ${e.type === '중단' ? '⚠️' : '✅'} ${kst(Date.parse(e.at))} ${e.source} ${e.type}`).join('\n') : '- ✅ 소스 중단/회복 없음')
  const st = existsSync(join(DATA_DIR, 'news-state.json')) ? readJson('news-state.json') : {}
  const age = st.lastLoopAt ? (now - Date.parse(st.lastLoopAt)) / 60_000 : null
  console.log(`- 마지막 사이클 ${age == null ? '-' : `${age.toFixed(0)}분 전`}${age != null && age > 10 ? ' ❌ 10분 넘게 멈춤' : ''} · 지금 실패 중인 소스 ${Object.keys(st.sourceFail || {}).join(', ') || '없음'}`)
})

section('모의매매', () => {
  const st = readJson('paper-trades.json')
  const ageMin = (now - Date.parse(st.lastRun)) / 60_000
  const eq = st.equity.at(-1) || {}
  console.log(`- 마지막 실행 ${kst(Date.parse(st.lastRun))} (${ageMin.toFixed(0)}분 전${ageMin > 75 ? ' ❌ 매시 :10 실행이 밀림' : ''}) · 체결 모델 v${st.fillModel} · 모델 변경 기록 ${st.modelChanges?.length ?? 0}건`)
  const lines = readFileSync(join(DATA_DIR, 'paper-trades-log.jsonl'), 'utf8').trim().split('\n')
  const act = paperActivity(lines.map((l) => { try { return JSON.parse(l) } catch { return null } }), since)
  for (const [src, b] of Object.entries(st.books)) {
    const a = act[src] || { open: 0, close: 0, noCash: 0, noFill: 0, stale: 0 }
    const start = b.startCash ?? st.params?.START_CASH ?? 500000
    console.log(`- ${src}: 평가 ${(eq[src] ?? 0).toLocaleString('ko-KR')}원 (${(((eq[src] ?? start) / start - 1) * 100).toFixed(2)}%) · 보유 ${b.open.length} · 현금 ${Math.round(b.cash).toLocaleString('ko-KR')}원 · ` +
      `지난 ${HOURS}시간 진입 ${a.open} · 청산 ${a.close} · 현금 부족 ${a.noCash}${a.noFill ? ` · 체결 실패 ${a.noFill}` : ''}${a.stale ? ` · 묵은 스캔 ${a.stale}` : ''}`)
  }
})
