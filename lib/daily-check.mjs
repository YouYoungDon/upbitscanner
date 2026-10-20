// 일일 점검(/daily-check 스킬, scripts/daily-check.mjs) — 판단 로직만 모은 순수 함수.
// 10월 장애(창 닫힘·업데이트 재부팅·절전)를 다시 겪지 않았는지 매일 같은 기준으로 본다.

const SLOT_MS = 3 * 3600_000 // 반등·모멘텀 스캔은 3시간마다(KST 00·03·…·21시 = UTC 3의 배수 시)
const GRACE_MS = 15 * 60_000 // 슬롯 시작 뒤 이만큼 지나야 "있어야 할 슬롯"으로 센다(정상 1~2분, 10-19 절전 장애 때 8분)
const FOUND_MS = 60 * 60_000 // 슬롯 시작 뒤 이 안에 저장된 스캔을 그 슬롯의 스캔으로 본다

// 스캔 기록 타임스탬프(스캔이 로그를 저장한 시각) → 지난 24시간 슬롯 중 빠진 것과 슬롯별 소요(분).
// 소요 = 저장 시각 − (슬롯 시작 + slotMinute). 모멘텀은 xx:02에 시작한다.
export function scanSlots(timestamps, { nowMs = Date.now(), slotMinute = 0, hours = 24 } = {}) {
  const times = (timestamps ?? []).map((t) => (typeof t === 'number' ? t : Date.parse(t))).filter(Number.isFinite)
  const from = nowMs - hours * 3600_000
  const slots = []
  for (let s = Math.ceil(from / SLOT_MS) * SLOT_MS; s + slotMinute * 60_000 + GRACE_MS <= nowMs; s += SLOT_MS) slots.push(s)
  const missing = [], durations = []
  for (const s of slots) {
    const hit = times.filter((t) => t >= s && t < s + FOUND_MS).sort((a, b) => a - b)[0]
    if (hit == null) missing.push(new Date(s).toISOString())
    else durations.push((hit - s - slotMinute * 60_000) / 60_000)
  }
  return { expected: slots.length, missing, durations, maxMin: durations.length ? Math.max(...durations) : null }
}

// 뉴스 데몬 로그 줄 → 기간 안의 소스 중단/회복. 줄 형식: "<ISO> … ⚠️뉴스 소스 중단: 바이낸스" / "✅ 뉴스 소스 회복: 업비트".
const NEWS_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) .*뉴스 소스 (중단|회복): (\S+)/
export function newsEvents(lines, sinceMs) {
  const out = []
  for (const line of lines ?? []) {
    const m = NEWS_RE.exec(line)
    if (m && Date.parse(m[1]) >= sinceMs) out.push({ at: m[1], type: m[2], source: m[3] })
  }
  return out
}

// 작업 스케줄러 상태 → 이상 목록. 결과 코드 0 = 성공, 267009(0x41301) = 실행 중,
// 2147946720(0x800710E0) = 이미 실행 중이라 새로 안 띄움(상주 데몬의 5분 감시 트리거에서 정상).
const OK_RESULTS = new Set([0, 267009, 2147946720])
const DAEMONS = new Set(['UpbitTelegramBot', 'UpbitNewsWatch', 'UpbitDashboard'])
export function taskFlags(tasks, nowMs = Date.now(), { expectedCount = null } = {}) {
  const flags = []
  if (expectedCount != null && (tasks ?? []).length !== expectedCount) flags.push({ name: '(전체)', problem: `작업이 ${(tasks ?? []).length}개 — ${expectedCount}개여야 한다` })
  for (const t of tasks ?? []) {
    if (DAEMONS.has(t.name) && t.state !== 'Running') flags.push({ name: t.name, problem: `상주 데몬인데 상태가 ${t.state}` })
    if (!OK_RESULTS.has(t.result)) flags.push({ name: t.name, problem: `마지막 결과 코드 ${t.result}` })
  }
  return flags
}

// 모의매매 원장 이벤트 → 기간 안의 장부별 진입·청산·현금 부족·체결 실패·묵은 스캔 건수.
const EV_KEY = { open: 'open', close: 'close', 'no-cash': 'noCash', 'no-fill': 'noFill', 'stale-scan': 'stale' }
export function paperActivity(events, sinceMs) {
  const out = {}
  for (const e of events ?? []) {
    const k = EV_KEY[e?.ev]
    if (!k || !(Date.parse(e.logAt) >= sinceMs)) continue
    const src = e.src ?? e.source
    const b = (out[src] ||= { open: 0, close: 0, noCash: 0, noFill: 0, stale: 0 })
    b[k]++
  }
  return out
}
