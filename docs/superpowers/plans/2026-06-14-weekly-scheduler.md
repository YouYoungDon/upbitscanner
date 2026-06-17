# 주간 자동 분석 스케줄러 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매주 일요일 22:00 KST에 지난 7일 스캔을 자동 분석해 "왜 맞았는지" 주간 리포트를 만들고 가중치에 반영하며, 매일 스캔은 그대로 유지한다.

**Architecture:** 순수 함수(`scansInLastDays`, `buildWeeklyReport`)를 TDD로 추가하고, 기존 `weekly-analysis.mjs`를 아카이브 7일 소스 + 일요일 게이트 + 리포트 생성으로 수정한다. 스케줄러에 주간 태스크를 추가하고, 리포트를 `/api/verify`로 노출해 신호검증 탭에 표시한다.

**Tech Stack:** Node 24 ESM (zero-dep), Vitest, Windows Task Scheduler (PowerShell), DaisyUI/Tailwind CDN.

---

### Task 1: `scansInLastDays` (아카이브 7일 필터)

**Files:**
- Modify: `lib/archive.mjs`
- Test: `__tests__/archive.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성** — `__tests__/archive.test.mjs` 끝에 추가

```js
import { scansInLastDays } from '../lib/archive.mjs'

describe('scansInLastDays', () => {
  const now = Date.parse('2026-06-14T12:00:00Z')
  const scans = [
    { timestamp: '2026-06-06T12:00:00Z' }, // 8일 전 → 제외
    { timestamp: '2026-06-07T12:00:01Z' }, // 경계 1초 안쪽 → 포함
    { timestamp: '2026-06-14T00:00:00Z' }, // 당일 → 포함
  ]
  it('지난 N일 내 스캔만, 입력 순서 유지', () => {
    const out = scansInLastDays(scans, 7, now)
    expect(out.map((s) => s.timestamp)).toEqual([
      '2026-06-07T12:00:01Z',
      '2026-06-14T00:00:00Z',
    ])
  })
  it('빈 배열은 빈 배열', () => {
    expect(scansInLastDays([], 7, now)).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/archive.test.mjs`
Expected: FAIL — `scansInLastDays is not a function`

- [ ] **Step 3: 구현** — `lib/archive.mjs` 끝(coinHistory 다음)에 추가

```js
// 지난 days일 내 스캔만 (입력 순서 유지). now 주입 가능(테스트용).
export function scansInLastDays(scans, days, now = Date.now()) {
  const cutoff = now - days * 86400000
  return scans.filter((s) => new Date(s.timestamp).getTime() >= cutoff)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/archive.test.mjs`
Expected: PASS (기존 + 신규)

- [ ] **Step 5: 커밋**

```bash
git add lib/archive.mjs __tests__/archive.test.mjs
git commit -m "feat: scansInLastDays 아카이브 N일 필터"
```

---

### Task 2: `buildWeeklyReport` (왜 맞았는지 리포트)

**Files:**
- Modify: `lib/weekly.mjs`
- Test: `__tests__/weekly.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성** — `__tests__/weekly.test.mjs` 끝에 추가

```js
import { buildWeeklyReport } from '../lib/weekly.mjs'

describe('buildWeeklyReport', () => {
  const stats = {
    'RSI 과매도': { count: 4, hitRate: 0.75 },
    'Stoch 골든크로스': { count: 2, hitRate: 1 },
    'EMA 하락배열': { count: 5, hitRate: 0.2 },
  }
  const records = [
    { market: 'KRW-ZKC', korean_name: '바운드리스', side: 'buy', signals: ['RSI 과매도'], hit: true },
    { market: 'KRW-ZKC', korean_name: '바운드리스', side: 'buy', signals: ['Stoch 골든크로스'], hit: true },
    { market: 'KRW-XYZ', korean_name: '엑스', side: 'buy', signals: ['EMA 하락배열'], hit: false },
  ]
  const oldW = { 'RSI 과매도': 1.0, 'EMA 하락배열': 1.0, '안변함': 1.0 }
  const newW = { 'RSI 과매도': 1.1, 'EMA 하락배열': 0.92, '안변함': 1.0 }

  it('topSignals: hits 내림차순, hits=round(count*hitRate)', () => {
    const { topSignals } = buildWeeklyReport(records, stats, oldW, newW)
    expect(topSignals[0]).toEqual({ key: 'RSI 과매도', count: 4, hitRate: 0.75, hits: 3 })
    expect(topSignals.map((s) => s.key)).toEqual(['RSI 과매도', 'Stoch 골든크로스', 'EMA 하락배열'])
  })
  it('weightChanges: 변화한 key만, 방향·이유 포함', () => {
    const { weightChanges } = buildWeeklyReport(records, stats, oldW, newW)
    expect(weightChanges.map((w) => w.key)).toEqual(['EMA 하락배열', 'RSI 과매도'])
    expect(weightChanges.find((w) => w.key === 'RSI 과매도')).toEqual({
      key: 'RSI 과매도', old: 1, new: 1.1, direction: 'up', reason: '적중률 75% (표본 4) → 상향',
    })
  })
  it('hitCoins / missCoins 집계', () => {
    const { hitCoins, missCoins } = buildWeeklyReport(records, stats, oldW, newW)
    expect(hitCoins).toEqual([{ market: 'KRW-ZKC', korean_name: '바운드리스', hits: 2, total: 2 }])
    expect(missCoins).toEqual([{ market: 'KRW-XYZ', korean_name: '엑스', total: 1 }])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/weekly.test.mjs`
Expected: FAIL — `buildWeeklyReport is not a function`

- [ ] **Step 3: 구현** — `lib/weekly.mjs` 끝에 추가

```js
// 주간 "왜 맞았는지" 리포트 (순수 함수)
export function buildWeeklyReport(records = [], stats = {}, oldWeights = {}, newWeights = {}) {
  const topSignals = Object.entries(stats)
    .map(([key, s]) => ({ key, count: s.count, hitRate: s.hitRate, hits: Math.round(s.count * s.hitRate) }))
    .sort((a, b) => b.hits - a.hits || b.hitRate - a.hitRate)
    .slice(0, 8)

  const weightChanges = []
  for (const key of new Set([...Object.keys(oldWeights), ...Object.keys(newWeights)])) {
    const o = +(oldWeights[key] ?? 1)
    const n = +(newWeights[key] ?? 1)
    if (o.toFixed(2) === n.toFixed(2)) continue
    const st = stats[key]
    const pct = st ? Math.round(st.hitRate * 100) : 0
    const direction = n > o ? 'up' : 'down'
    weightChanges.push({
      key, old: +o.toFixed(2), new: +n.toFixed(2), direction,
      reason: `적중률 ${pct}% (표본 ${st ? st.count : 0}) → ${direction === 'up' ? '상향' : '하향'}`,
    })
  }
  weightChanges.sort((a, b) => Math.abs(b.new - b.old) - Math.abs(a.new - a.old))

  const byMarket = {}
  for (const r of records) {
    const m = (byMarket[r.market] ??= { market: r.market, korean_name: r.korean_name, hits: 0, total: 0 })
    m.total++
    if (r.hit) m.hits++
    if (r.korean_name && !m.korean_name) m.korean_name = r.korean_name
  }
  const coins = Object.values(byMarket)
  const hitCoins = coins.filter((c) => c.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 10)
  const missCoins = coins.filter((c) => c.hits === 0)
    .map((c) => ({ market: c.market, korean_name: c.korean_name, total: c.total }))
    .sort((a, b) => b.total - a.total).slice(0, 10)

  return { topSignals, weightChanges, hitCoins, missCoins }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/weekly.test.mjs`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/weekly.mjs __tests__/weekly.test.mjs
git commit -m "feat: buildWeeklyReport 주간 리포트 순수 함수"
```

---

### Task 3: `weekly-analysis.mjs` — 아카이브 7일 소스 + 일요일 게이트 + 리포트

**Files:**
- Modify: `scripts/weekly-analysis.mjs`

> 테스트 없음(IO/네트워크 통합 스크립트). 순수 로직은 Task 1·2에서 검증됨.
> `--force`로 수동 실행해 회귀 확인.

- [ ] **Step 1: import 추가** — 1~6행 영역

기존:
```js
import { getTicker, getDayCandlesBefore } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { judgeHit, aggregateHitRates, updateWeights } from '../lib/weekly.mjs'
```
변경 후:
```js
import { getTicker, getDayCandlesBefore } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { judgeHit, aggregateHitRates, updateWeights, buildWeeklyReport } from '../lib/weekly.mjs'
import { readArchive, scansInLastDays } from '../lib/archive.mjs'
```

- [ ] **Step 2: 게이트를 일요일로 변경** — 47~51행

기존:
```js
const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
if (!force && kstDay !== 3) {
  console.log('수요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}
```
변경 후:
```js
const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
if (!force && kstDay !== 0) {
  console.log('일요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}
```

- [ ] **Step 3: 데이터 소스를 아카이브 7일로 변경** — 53~55행

기존:
```js
const log = await readJson('monitor-log.json', { scans: [] })
const recentScans = log.scans.slice(-7)
if (!recentScans.length) { console.log('스캔 이력 없음'); process.exit(0) }
```
변경 후:
```js
const recentScans = scansInLastDays(readArchive(), 7)
if (!recentScans.length) { console.log('지난 7일 스캔 이력 없음'); process.exit(0) }
```

- [ ] **Step 4: 예측 레코드에 market/korean_name 포함** — 57~74행

기존:
```js
const preds = []
for (const scan of recentScans) {
  for (const b of scan.buy) preds.push({ side: 'buy', market: b.market, signalPrice: b.price, signals: b.signals })
  for (const s of scan.sell) preds.push({ side: 'sell', market: s.market, signalPrice: s.price, signals: s.signals })
}
if (!preds.length) { console.log('예측 없음'); process.exit(0) }

const codes = [...new Set(preds.map((p) => p.market))]
const tickers = []
for (let i = 0; i < codes.length; i += 100) {
  const t = await getTicker(codes.slice(i, i + 100))
  if (t) tickers.push(...t)
}
const priceOf = Object.fromEntries(tickers.map((t) => [t.market, t.trade_price]))

const records = preds
  .filter((p) => priceOf[p.market] != null)
  .map((p) => ({ signals: p.signals, hit: judgeHit(p.side, p.signalPrice, priceOf[p.market]) }))
```
변경 후:
```js
const preds = []
for (const scan of recentScans) {
  for (const b of scan.buy) preds.push({ side: 'buy', market: b.market, korean_name: b.korean_name, signalPrice: b.price, signals: b.signals })
  for (const s of scan.sell) preds.push({ side: 'sell', market: s.market, korean_name: s.korean_name, signalPrice: s.price, signals: s.signals })
}
if (!preds.length) { console.log('예측 없음'); process.exit(0) }

const codes = [...new Set(preds.map((p) => p.market))]
const tickers = []
for (let i = 0; i < codes.length; i += 100) {
  const t = await getTicker(codes.slice(i, i + 100))
  if (t) tickers.push(...t)
}
const priceOf = Object.fromEntries(tickers.map((t) => [t.market, t.trade_price]))

const records = preds
  .filter((p) => priceOf[p.market] != null)
  .map((p) => ({ market: p.market, korean_name: p.korean_name, side: p.side, signals: p.signals, hit: judgeHit(p.side, p.signalPrice, priceOf[p.market]) }))
```

- [ ] **Step 5: 리포트 생성 + result에 추가** — 76~93행

기존:
```js
const stats = aggregateHitRates(records)
const oldWeights = await readJson('signal-weights.json', {})
const newWeights = updateWeights(oldWeights, stats)
await writeJson('signal-weights.json', newWeights)

console.log(`[${new Date().toISOString()}] 시간별 적중률 계산 중 (API 호출 포함)...`)
const timedHitRates = await calcTimedHitRates(recentScans)
console.log(`[${new Date().toISOString()}] 시간별 적중률:`, JSON.stringify(timedHitRates))

const hitCount = records.filter((r) => r.hit).length
const result = {
  timestamp: new Date().toISOString(),
  predictions: records.length,
  hits: hitCount,
  overallHitRate: records.length ? +(hitCount / records.length).toFixed(3) : 0,
  timedHitRates,
  signalStats: stats,
}
```
변경 후:
```js
const stats = aggregateHitRates(records)
const oldWeights = await readJson('signal-weights.json', {})
const newWeights = updateWeights(oldWeights, stats)
await writeJson('signal-weights.json', newWeights)

const report = buildWeeklyReport(records, stats, oldWeights, newWeights)

console.log(`[${new Date().toISOString()}] 시간별 적중률 계산 중 (API 호출 포함)...`)
const timedHitRates = await calcTimedHitRates(recentScans)
console.log(`[${new Date().toISOString()}] 시간별 적중률:`, JSON.stringify(timedHitRates))

const hitCount = records.filter((r) => r.hit).length
const result = {
  timestamp: new Date().toISOString(),
  predictions: records.length,
  hits: hitCount,
  overallHitRate: records.length ? +(hitCount / records.length).toFixed(3) : 0,
  timedHitRates,
  signalStats: stats,
  report,
}
```

- [ ] **Step 6: 콘솔 요약에 리포트 한 줄 추가** — 파일 끝 console.log 다음

기존 마지막 두 줄:
```js
console.log(`주간 분석 완료 — 예측 ${records.length}건, 적중 ${hitCount}건 (${result.overallHitRate})`)
console.log('가중치 갱신:', Object.keys(stats).filter((k) => stats[k].count >= 3).join(', ') || '없음')
```
변경 후(끝에 한 줄 추가):
```js
console.log(`주간 분석 완료 — 예측 ${records.length}건, 적중 ${hitCount}건 (${result.overallHitRate})`)
console.log('가중치 갱신:', Object.keys(stats).filter((k) => stats[k].count >= 3).join(', ') || '없음')
console.log('적중 신호 TOP:', report.topSignals.slice(0, 3).map((s) => `${s.key}(${s.hits}/${s.count})`).join(', ') || '없음')
```

- [ ] **Step 7: 강제 실행으로 회귀 확인**

Run: `node scripts/weekly-analysis.mjs --force`
Expected: 정상 종료. 아카이브에 7일 내 스캔이 있으면 "주간 분석 완료 …" + "적중 신호 TOP …" 출력. 없으면 "지난 7일 스캔 이력 없음".
주의: 이 실행은 `signal-weights.json`을 EWM으로 갱신한다. 확인 후 원복이 필요하면 `git checkout data/signal-weights.json`.

- [ ] **Step 8: 커밋**

```bash
git add scripts/weekly-analysis.mjs
git commit -m "feat: 주간 분석을 일요일 게이트 + 아카이브 7일 소스 + 리포트 생성으로 변경"
```

---

### Task 4: 스케줄러에 일요일 주간 태스크 추가

**Files:**
- Modify: `scripts/install-scheduler.ps1`

- [ ] **Step 1: 제거(Uninstall) 목록에 주간 태스크 포함** — 17~23행

기존:
```powershell
if ($Uninstall) {
  foreach ($t in $tasks) {
    try { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false; Write-Host "제거됨: $($t.Name)" }
    catch { Write-Host "없음: $($t.Name)" }
  }
  return
}
```
변경 후:
```powershell
if ($Uninstall) {
  foreach ($name in @($tasks.Name + 'UpbitWeekly_Sun')) {
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host "제거됨: $name" }
    catch { Write-Host "없음: $name" }
  }
  return
}
```

- [ ] **Step 2: 주간 태스크 등록 추가** — 25~33행(등록 루프 다음, 마지막 확인 안내 앞)

기존:
```powershell
foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$monitor`"" -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
  # WakeToRun: 절전 중이면 PC를 깨워 실행 / 배터리에서도 시작·유지 / 놓친 작업은 깨어난 뒤 실행
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "등록됨: $($t.Name) @ $($t.Time) (로컬 시간 = KST)"
}
Write-Host "`n확인: Get-ScheduledTask -TaskName 'UpbitMonitor_*'"
```
변경 후:
```powershell
foreach ($t in $tasks) {
  $action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$monitor`"" -WorkingDirectory $projectRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At $t.Time
  # WakeToRun: 절전 중이면 PC를 깨워 실행 / 배터리에서도 시작·유지 / 놓친 작업은 깨어난 뒤 실행
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "등록됨: $($t.Name) @ $($t.Time) (로컬 시간 = KST)"
}

# 주간 분석: 매주 일요일 22:00 (일일 스캔 21:00 종료 후)
$weekly = Join-Path $projectRoot 'scripts\weekly-analysis.mjs'
$wAction = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$weekly`"" -WorkingDirectory $projectRoot
$wTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '22:00'
$wSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
Register-ScheduledTask -TaskName 'UpbitWeekly_Sun' -Action $wAction -Trigger $wTrigger -Settings $wSettings -Force | Out-Null
Write-Host "등록됨: UpbitWeekly_Sun @ Sun 22:00 (로컬 시간 = KST)"

Write-Host "`n확인: Get-ScheduledTask -TaskName 'Upbit*'"
```

- [ ] **Step 3: 구문 검증 (등록은 사용자가 직접 실행)**

Run: `powershell -NoProfile -Command "$null = [System.Management.Automation.Language.Parser]::ParseFile('scripts\install-scheduler.ps1', [ref]$null, [ref]$null); if ($?) { 'parse ok' }"`
Expected: `parse ok` (구문 오류 없음). 실제 태스크 등록은 사용자가 `install-scheduler.ps1`로 수행.

- [ ] **Step 4: 커밋**

```bash
git add scripts/install-scheduler.ps1
git commit -m "feat: 일요일 22:00 주간 분석 작업 스케줄러 등록"
```

---

### Task 5: `/api/verify`에 report 노출

**Files:**
- Modify: `server/api.mjs`
- Test: `__tests__/api.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성** — `__tests__/api.test.mjs`의 buildVerify 영역(없으면 끝)에 추가

```js
import { buildVerify } from '../server/api.mjs'

describe('buildVerify report', () => {
  it('최신 주차 report를 통과시킨다', () => {
    const weekly = { weeks: [{ timestamp: 't1' }, { timestamp: 't2', report: { topSignals: [{ key: 'A' }] } }] }
    const v = buildVerify(weekly, { A: 1.2 })
    expect(v.report).toEqual({ topSignals: [{ key: 'A' }] })
  })
  it('report 없으면 null', () => {
    const v = buildVerify({ weeks: [{ timestamp: 't1' }] }, {})
    expect(v.report).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: FAIL — `v.report` is undefined (toBeNull/toEqual 실패)

- [ ] **Step 3: 구현** — `server/api.mjs`의 `buildVerify` 반환 객체에 한 줄 추가

기존:
```js
export function buildVerify(weekly, weights) {
  const latest = weekly?.weeks?.at(-1) || {}
  return {
    overallHitRate: latest.overallHitRate ?? null,
    timedHitRates: latest.timedHitRates ?? null,
    signalStats: latest.signalStats ?? {},
    weights: weights || {},
    history: (weekly?.weeks || []).map((w) => ({ timestamp: w.timestamp, overallHitRate: w.overallHitRate })),
  }
}
```
변경 후:
```js
export function buildVerify(weekly, weights) {
  const latest = weekly?.weeks?.at(-1) || {}
  return {
    overallHitRate: latest.overallHitRate ?? null,
    timedHitRates: latest.timedHitRates ?? null,
    signalStats: latest.signalStats ?? {},
    weights: weights || {},
    report: latest.report ?? null,
    history: (weekly?.weeks || []).map((w) => ({ timestamp: w.timestamp, overallHitRate: w.overallHitRate })),
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run __tests__/api.test.mjs`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add server/api.mjs __tests__/api.test.mjs
git commit -m "feat: /api/verify에 주간 리포트 노출"
```

---

### Task 6: 신호검증 탭 "이번 주 요약" 섹션 + README

**Files:**
- Modify: `public/app.js`
- Modify: `README.md`

> 프론트엔드 렌더 변경은 자동 테스트 없음. 서버 띄워 육안 확인.

- [ ] **Step 1: verify() 라우트에 리포트 섹션 추가** — `public/app.js`의 `verify()` 함수

`const timed = v.timedHitRates || {}` 다음, 최종 `view.innerHTML = ...` 직전에 리포트 HTML 빌더를 추가하고, 최종 템플릿의 stats div 다음에 삽입한다.

`const timed = v.timedHitRates || {}` 아래에 추가:
```js
    const r = v.report
    const sigBadge = (s) => `<tr><td>${esc(s.key)}</td><td>${s.count}</td><td>${Math.round(s.hitRate * 100)}%</td><td><span class="badge badge-success badge-sm">${s.hits}</span></td></tr>`
    const wChange = (w) => `<tr><td>${esc(w.key)}</td><td>${w.old.toFixed(2)} → ${w.new.toFixed(2)}</td><td>${w.direction === 'up' ? '<span class="text-success">▲</span>' : '<span class="text-error">▼</span>'}</td><td class="opacity-70">${esc(w.reason)}</td></tr>`
    const coinBadge = (c) => `<span class="badge badge-success badge-outline gap-1">${esc(c.korean_name || c.market.replace('KRW-', ''))} <span class="opacity-60">${c.hits}/${c.total}</span></span>`
    const reportCard = !r ? '' : `
      <div class="card bg-base-200 shadow mb-4"><div class="card-body p-4">
        <h3 class="card-title text-sm">📅 이번 주 요약</h3>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <div class="text-xs opacity-60 mb-1">적중 신호 TOP</div>
            <table class="table table-sm"><thead><tr><th>신호</th><th>표본</th><th>적중률</th><th>적중</th></tr></thead>
              <tbody>${r.topSignals.map(sigBadge).join('') || '<tr><td colspan="4" class="opacity-60">없음</td></tr>'}</tbody></table>
          </div>
          <div>
            <div class="text-xs opacity-60 mb-1">가중치 변화</div>
            <table class="table table-sm"><thead><tr><th>신호</th><th>변화</th><th></th><th>이유</th></tr></thead>
              <tbody>${r.weightChanges.map(wChange).join('') || '<tr><td colspan="4" class="opacity-60">변화 없음</td></tr>'}</tbody></table>
          </div>
        </div>
        <div class="text-xs opacity-60 mt-2 mb-1">적중 코인</div>
        <div class="flex flex-wrap gap-1">${r.hitCoins.map(coinBadge).join('') || '<span class="opacity-60">없음</span>'}</div>
      </div></div>`
```

그리고 최종 `view.innerHTML` 템플릿에서 stats `</div>` 다음(신호별 적중률 카드 앞)에 `${reportCard}` 삽입:
```js
      </div>
      ${reportCard}
      <div class="card bg-base-200 shadow"><div class="card-body p-4">
        <h3 class="card-title text-sm">신호별 적중률 / 가중치</h3>
```

- [ ] **Step 2: 서버 띄워 육안 확인**

Run: `node server/server.mjs` (별도 터미널), 브라우저 `http://127.0.0.1:8787` → 신호검증 탭.
Expected: 주간 분석이 한 번이라도 돌아 `report`가 있으면 "📅 이번 주 요약" 카드 표시. 없으면 카드 생략되고 기존 UI 정상. 확인 후 서버 종료.

- [ ] **Step 3: README 갱신** — `scripts/weekly-analysis.mjs` 설명과 스케줄 표현 수정

다음 두 곳을 수정한다.

1) 자동화 섹션의 등록 주석/확인 명령:
```
# 등록 (매일 09:00 / 21:00 + 일요일 22:00 주간 분석, 로컬 시간 = KST)
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
...
Get-ScheduledTask -TaskName 'Upbit*'
```

2) "가중치 자동 갱신(EWM)" 섹션의 첫 문장:
```
`scripts/weekly-analysis.mjs`가 매주 일요일 22:00에 지난 7일 스캔 아카이브의
적중률을 집계해 가중치를 갱신하고, "왜 맞았는지" 주간 리포트를 생성한다(신호검증 탭 표시).
```

3) 구조 표의 `scripts/weekly-analysis.mjs` 행 설명을 "주간 적중률 + 가중치 EWM + 리포트"로 갱신.

- [ ] **Step 4: 커밋**

```bash
git add public/app.js README.md
git commit -m "feat: 신호검증 탭 이번 주 요약 섹션 + README 갱신"
```

---

## 최종 검증

- [ ] **전체 테스트**

Run: `npx vitest run`
Expected: 전체 PASS (기존 + 신규 archive/weekly/api 테스트).

- [ ] **가중치 시드 확인**

Task 3 Step 7의 `--force` 실행으로 `data/signal-weights.json`이 EWM 갱신됐다면, 의도된 결과인지 확인하고 필요 시 `git checkout data/signal-weights.json`으로 §7 시드를 복원한다.
