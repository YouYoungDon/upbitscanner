import { getTicker, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend, withLock, readWeights } from '../lib/store.mjs'
import { updateWeights, buildWeeklyReport, judgeAtHorizon, sideSummary, timedHitRates, statsWithReturns, MIN_SAMPLES } from '../lib/weekly.mjs'
import { confirmedOhlcvAsOf } from '../lib/ohlcv.mjs'
import { readArchive, scansInLastDays } from '../lib/archive.mjs'

const force = process.argv.includes('--force')
const MAX_WEEKS = 12
const DAY_MS = 86400000
const LOOKBACK_DAYS = 14      // 기본 조회 창: +7일 적중률 확보
const MAX_CATCHUP_DAYS = 60   // learnedUntil 공백 캐치업 상한 (초과분은 경고 후 포기)
const MIN_LEARN_COVERAGE = 0.8 // 판정 성공률 하한 — 미만이면 학습·워터마크 전진 보류(다음 실행 재시도)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
if (!force && kstDay !== 0) {
  console.log('일요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}

// learnedUntil 워터마크 조회 (meta 우선, 외부 절차가 meta를 덮어썼으면 주간 엔트리에서 자가 복구)
async function readLearnedUntil() {
  const meta = await readJson('signal-weights.meta.json', {})
  if (meta.learnedUntil) return meta.learnedUntil
  const wa = await readJson('weekly-analysis.json', { weeks: [] })
  const recovered = wa.weeks?.at(-1)?.learned?.learnedUntil
  if (recovered) console.log(`learnedUntil 메타 소실 감지 — 주간 엔트리에서 복구: ${recovered}`)
  return recovered ?? ''
}

// 조회 창: 기본 14일, learnedUntil이 더 과거면 캐치업 확장(상한 60일)
const peekLearnedUntil = await readLearnedUntil()
const daysSinceLearn = peekLearnedUntil ? Math.ceil((Date.now() - Date.parse(peekLearnedUntil)) / DAY_MS) : LOOKBACK_DAYS
const lookback = Math.min(MAX_CATCHUP_DAYS, Math.max(LOOKBACK_DAYS, daysSinceLearn + 1))
if (daysSinceLearn + 1 > MAX_CATCHUP_DAYS) console.warn(`⚠️ learnedUntil 공백 ${daysSinceLearn}일 > 상한 ${MAX_CATCHUP_DAYS}일 — 초과 구간은 학습에서 제외됩니다`)
else if (lookback > LOOKBACK_DAYS) console.log(`캐치업: 조회 창 ${lookback}일로 확장 (learnedUntil ${peekLearnedUntil})`)

const scans = scansInLastDays(readArchive(), lookback)
if (!scans.length) { console.log(`지난 ${lookback}일 스캔 이력 없음`); process.exit(0) }
const momLog = await readJson('momentum-log.json', { scans: [] })
const momScans = scansInLastDays(momLog.scans || [], LOOKBACK_DAYS)

// ── 마켓별 일봉 캐시 (날짜 인지 확정봉 — 당일 봉만 제거, 저유동 마켓의 어제 확정봉 보존)
const nowMs = Date.now()
const todayIdx = Math.floor(nowMs / DAY_MS)
const allMarkets = new Set()
for (const s of scans) for (const it of [...(s.buy ?? []), ...(s.sell ?? [])]) allMarkets.add(it.market)
for (const s of momScans) for (const p of s.picks ?? []) allMarkets.add(p.market)
console.log(`[${new Date().toISOString()}] 일봉 캐시 구축 중 — 마켓 ${allMarkets.size}개...`)
const closeIdx = new Map()
let failedMarkets = 0
for (const m of allMarkets) {
  const candles = await getDayCandles(m, Math.min(200, lookback + 11)) // 창 + horizon 7 + 여유
  if (!Array.isArray(candles) || !candles.length) { failedMarkets++; continue }
  const confirmed = confirmedOhlcvAsOf(candlesToOhlcv(candles), nowMs)
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
const cutoff7 = nowMs - 7 * DAY_MS
const weekRecords = judgeAtHorizon(preds.filter((p) => new Date(p.ts).getTime() >= cutoff7), closeOf)
const displayStats = statsWithReturns(weekRecords)

// ── 가중치 갱신: learnedUntil 이후 스캔만, "실제 판정된 픽" 기준으로만 워터마크 전진
let oldWeights, newWeights, learnRecords = [], learnStats = {}, learnedUntilNew, learnSkipped = false
await withLock('signal-weights', async () => {
  const meta = await readJson('signal-weights.meta.json', {})
  const learnedUntil = meta.learnedUntil ?? peekLearnedUntil ?? ''
  const learnPreds = preds.filter((p) => p.ts > learnedUntil)
  const judgeable = learnPreds.filter((p) => p.dayIdx <= todayIdx - 2) // D0+1 봉이 확정된 픽
  learnRecords = judgeAtHorizon(learnPreds, closeOf)
  learnStats = statsWithReturns(learnRecords)
  oldWeights = await readWeights()
  const coverage = judgeable.length ? learnRecords.length / judgeable.length : 1
  learnedUntilNew = learnedUntil
  if (coverage < MIN_LEARN_COVERAGE) {
    // 대량 fetch 실패 등으로 판정 커버리지가 낮으면 이번 학습을 통째로 보류 — 다음 실행이 같은 창을 재시도
    learnSkipped = true
    newWeights = oldWeights
    console.warn(`⚠️ 학습 커버리지 ${(coverage * 100).toFixed(0)}% < ${MIN_LEARN_COVERAGE * 100}% — 가중치 갱신·learnedUntil 전진 보류`)
  } else {
    newWeights = updateWeights(oldWeights, learnStats)
    await writeJson('signal-weights.json', newWeights)
    // 워터마크는 실제 판정에 성공한 픽의 최신 ts까지만 전진 (ISO 문자열 사전순 = 시간순)
    learnedUntilNew = learnRecords.reduce((a, r) => (r.ts > a ? r.ts : a), learnedUntil)
    const skipped = judgeable.length - learnRecords.length
    if (skipped > 0) console.log(`미판정 픽 ${skipped}건 학습 제외 (캔들 결손 — 커버리지 ${(coverage * 100).toFixed(0)}%)`)
    if (learnedUntilNew !== learnedUntil) {
      await writeJson('signal-weights.meta.json', { ...meta, learnedUntil: learnedUntilNew, horizonMode: 'confirmed-1d' })
    }
  }
})

// 리포트의 가중치 변화 '이유'는 실제 학습 입력(learnStats) 기준 — 표시 창과 어긋나지 않게
const report = buildWeeklyReport(weekRecords, learnStats, oldWeights, newWeights)
const timedScans = scansInLastDays(scans, LOOKBACK_DAYS)
const timed = timedHitRates(timedScans, (s) => s.buy ?? [], closeOf)
console.log(`[${new Date().toISOString()}] 시간별 적중률:`, JSON.stringify(timed))

// ── 모멘텀 스캐너 검증 (overall = 최근 7일 픽 현재가 기준 "지금까지" 게이지 — 기존 의미 유지, timed = 14일 확정종가)
let momentum = null
if (momScans.length) {
  const momScans7 = scansInLastDays(momScans, 7)
  const momCodes = [...new Set(momScans7.flatMap((s) => (s.picks ?? []).map((p) => p.market)))]
  const momTickers = []
  for (let i = 0; i < momCodes.length; i += 100) {
    const t = await getTicker(momCodes.slice(i, i + 100))
    if (t) momTickers.push(...t)
  }
  const momPriceOf = Object.fromEntries(momTickers.map((t) => [t.market, t.trade_price]))
  const momRecs = momScans7.flatMap((s) => (s.picks ?? []).filter((p) => momPriceOf[p.market] != null).map((p) => p.price < momPriceOf[p.market]))
  const momHits = momRecs.filter(Boolean).length
  momentum = {
    picks: momRecs.length,
    overallHitRate: momRecs.length ? +(momHits / momRecs.length).toFixed(3) : 0,
    timedHitRates: timedHitRates(momScans, (s) => s.picks ?? [], closeOf),
  }
  console.log(`모멘텀 검증 — 픽 ${momRecs.length}건, 적중 ${momHits}건 (${momentum.overallHitRate})`)
}

const sideStats = sideSummary(weekRecords)
if (!weekRecords.length) {
  console.log('판정 가능한 레코드 0건 (전 픽이 2일 미만 경과) — 주간 엔트리 저장 생략')
} else {
  const hitCount = weekRecords.filter((r) => r.hit).length
  const result = {
    timestamp: new Date().toISOString(),
    predictions: weekRecords.length,
    hits: hitCount,
    overallHitRate: +(hitCount / weekRecords.length).toFixed(3),
    sideStats,
    timedHitRates: timed,
    signalStats: displayStats,
    report,
    momentum,
    horizonMode: 'confirmed-1d',
    learned: { records: learnRecords.length, learnedUntil: learnedUntilNew || null, skipped: learnSkipped },
  }
  // 락 안에서 fresh 재읽기 → 증가 → 쓰기. 수동 실행이 정시 실행과 겹쳐도 갱신유실 없음.
  await withLock('weekly-analysis', async () => {
    const fresh = await readJson('weekly-analysis.json', { weeks: [] })
    fresh.weeks = rollingAppend(fresh.weeks || [], result, MAX_WEEKS)
    await writeJson('weekly-analysis.json', fresh)
  })
}

const pct = (r) => (r.predictions ? `${Math.round(r.hitRate * 100)}% (${r.hits}/${r.predictions})` : '- (0건)')
console.log(`주간 분석 완료 [+1일 확정종가] — 매수 ${pct(sideStats.buy)} · 매도 ${pct(sideStats.sell)}`)
console.log(`가중치 갱신: 학습 레코드 ${learnRecords.length}건${learnSkipped ? ' (보류)' : ''}, 갱신 신호 ${Object.keys(learnStats).filter((k) => learnStats[k].count >= MIN_SAMPLES).length}개, learnedUntil → ${learnedUntilNew || '(없음)'}`)
console.log('적중 매수신호 TOP:', report.topBuySignals.slice(0, 3).map((s) => `${s.key} ${Math.round(s.hitRate * 100)}%(${s.hits}/${s.count})`).join(', ') || '없음')
