import { getTicker, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend, withLock, readWeights } from '../lib/store.mjs'
import { aggregateHitRates, aggregateReturns, updateWeights, buildWeeklyReport, judgeAtHorizon, sideSummary, timedHitRates, MIN_SAMPLES } from '../lib/weekly.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { readArchive, scansInLastDays } from '../lib/archive.mjs'

const force = process.argv.includes('--force')
const MAX_WEEKS = 12
const DAY_MS = 86400000
const LOOKBACK_DAYS = 14 // +7일 창 확보 + 미실행 주 캐치업
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
if (!force && kstDay !== 0) {
  console.log('일요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}

const scans = scansInLastDays(readArchive(), LOOKBACK_DAYS)
if (!scans.length) { console.log(`지난 ${LOOKBACK_DAYS}일 스캔 이력 없음`); process.exit(0) }
const momLog = await readJson('momentum-log.json', { scans: [] })
const momScans = scansInLastDays(momLog.scans || [], LOOKBACK_DAYS)

// ── 마켓별 일봉 캐시 (확정봉만) — 픽당 API 1콜 대신 마켓당 1콜
const allMarkets = new Set()
for (const s of scans) for (const it of [...(s.buy ?? []), ...(s.sell ?? [])]) allMarkets.add(it.market)
for (const s of momScans) for (const p of s.picks ?? []) allMarkets.add(p.market)
console.log(`[${new Date().toISOString()}] 일봉 캐시 구축 중 — 마켓 ${allMarkets.size}개...`)
const closeIdx = new Map()
let failedMarkets = 0
for (const m of allMarkets) {
  const candles = await getDayCandles(m, LOOKBACK_DAYS + 11) // 창 14 + horizon 7 + 여유
  if (!Array.isArray(candles) || !candles.length) { failedMarkets++; continue }
  const confirmed = confirmedOhlcv(candlesToOhlcv(candles))
  closeIdx.set(m, new Map(confirmed.map((c) => [Math.floor(c.time / 86400), c.close])))
  await sleep(120)
}
if (failedMarkets) console.log(`캔들 fetch 실패 마켓 ${failedMarkets}개 — 해당 픽 제외`)
const closeOf = (market, dayIdx) => closeIdx.get(market)?.get(dayIdx) ?? null

// ── 예측 목록 (+1일 확정종가 판정용, dayIdx = 스캔일 UTC day-index)
const preds = []
for (const scan of scans) {
  const dayIdx = Math.floor(new Date(scan.timestamp).getTime() / DAY_MS)
  for (const b of scan.buy ?? []) preds.push({ ts: scan.timestamp, dayIdx, side: 'buy', market: b.market, korean_name: b.korean_name, signalPrice: b.price, signals: b.signals })
  for (const s of scan.sell ?? []) preds.push({ ts: scan.timestamp, dayIdx, side: 'sell', market: s.market, korean_name: s.korean_name, signalPrice: s.price, signals: s.signals })
}
if (!preds.length) { console.log('예측 없음'); process.exit(0) }

// 표시용 통계: 최근 7일 픽 전체 (+1일 종가 미확정 픽은 자동 제외)
const cutoff7 = Date.now() - 7 * DAY_MS
const weekRecords = judgeAtHorizon(preds.filter((p) => new Date(p.ts).getTime() >= cutoff7), closeOf)
const displayStats = aggregateHitRates(weekRecords)
const displayReturns = aggregateReturns(weekRecords)
for (const k of Object.keys(displayStats)) displayStats[k].avgReturn = displayReturns[k] ?? 0

// ── 가중치 갱신: learnedUntil 이후 스캔만 학습 (재실행·중복 실행 시 이중 학습 차단)
const todayIdx = Math.floor(Date.now() / DAY_MS)
let oldWeights, newWeights, learnRecords, learnStats, learnedUntilNew
await withLock('signal-weights', async () => {
  const meta = await readJson('signal-weights.meta.json', {})
  const learnedUntil = meta.learnedUntil ?? ''
  const learnPreds = preds.filter((p) => p.ts > learnedUntil)
  learnRecords = judgeAtHorizon(learnPreds, closeOf)
  learnStats = aggregateHitRates(learnRecords)
  const learnReturns = aggregateReturns(learnRecords)
  for (const k of Object.keys(learnStats)) learnStats[k].avgReturn = learnReturns[k] ?? 0
  oldWeights = await readWeights()
  newWeights = updateWeights(oldWeights, learnStats)
  await writeJson('signal-weights.json', newWeights)
  // learnedUntil 전진: +1일 캔들이 확정된 스캔(D0 ≤ 오늘-2)까지만 — 미확정 스캔은 다음 실행에서 학습
  const judged = learnPreds.filter((p) => p.dayIdx <= todayIdx - 2).map((p) => p.ts).sort()
  learnedUntilNew = judged.at(-1) ?? learnedUntil
  if (learnedUntilNew && learnedUntilNew !== learnedUntil) {
    await writeJson('signal-weights.meta.json', { ...meta, learnedUntil: learnedUntilNew, horizonMode: 'confirmed-1d' })
  }
})

const report = buildWeeklyReport(weekRecords, displayStats, oldWeights, newWeights)
const timed = timedHitRates(scans, (s) => s.buy ?? [], closeOf)
console.log(`[${new Date().toISOString()}] 시간별 적중률:`, JSON.stringify(timed))

// ── 모멘텀 스캐너 검증 (overall = 현재가 기준 "지금까지" 게이지, timed = 확정종가)
let momentum = null
if (momScans.length) {
  const momCodes = [...new Set(momScans.flatMap((s) => (s.picks ?? []).map((p) => p.market)))]
  const momTickers = []
  for (let i = 0; i < momCodes.length; i += 100) {
    const t = await getTicker(momCodes.slice(i, i + 100))
    if (t) momTickers.push(...t)
  }
  const momPriceOf = Object.fromEntries(momTickers.map((t) => [t.market, t.trade_price]))
  const momRecs = momScans.flatMap((s) => (s.picks ?? []).filter((p) => momPriceOf[p.market] != null).map((p) => p.price < momPriceOf[p.market]))
  const momHits = momRecs.filter(Boolean).length
  momentum = {
    picks: momRecs.length,
    overallHitRate: momRecs.length ? +(momHits / momRecs.length).toFixed(3) : 0,
    timedHitRates: timedHitRates(momScans, (s) => s.picks ?? [], closeOf),
  }
  console.log(`모멘텀 검증 — 픽 ${momRecs.length}건, 적중 ${momHits}건 (${momentum.overallHitRate})`)
}

const hitCount = weekRecords.filter((r) => r.hit).length
const sideStats = sideSummary(weekRecords)
const result = {
  timestamp: new Date().toISOString(),
  predictions: weekRecords.length,
  hits: hitCount,
  overallHitRate: weekRecords.length ? +(hitCount / weekRecords.length).toFixed(3) : 0,
  sideStats,
  timedHitRates: timed,
  signalStats: displayStats,
  report,
  momentum,
  horizonMode: 'confirmed-1d',
  learned: { records: learnRecords.length, learnedUntil: learnedUntilNew ?? null },
}
// 락 안에서 fresh 재읽기 → 증가 → 쓰기. 수동 실행이 정시 실행과 겹쳐도 갱신유실 없음.
await withLock('weekly-analysis', async () => {
  const fresh = await readJson('weekly-analysis.json', { weeks: [] })
  fresh.weeks = rollingAppend(fresh.weeks || [], result, MAX_WEEKS)
  await writeJson('weekly-analysis.json', fresh)
})

const pct = (r) => `${Math.round(r.hitRate * 100)}% (${r.hits}/${r.predictions})`
console.log(`주간 분석 완료 [+1일 확정종가] — 매수 ${pct(sideStats.buy)} · 매도 ${pct(sideStats.sell)}`)
console.log(`가중치 갱신: 학습 레코드 ${learnRecords.length}건, 갱신 신호 ${Object.keys(learnStats).filter((k) => learnStats[k].count >= MIN_SAMPLES).length}개, learnedUntil → ${learnedUntilNew ?? '(없음)'}`)
console.log('적중 매수신호 TOP:', report.topBuySignals.slice(0, 3).map((s) => `${s.key} ${Math.round(s.hitRate * 100)}%(${s.hits}/${s.count})`).join(', ') || '없음')
