import { getTicker, getDayCandlesBefore } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend, withLock } from '../lib/store.mjs'
import { judgeHit, aggregateHitRates, updateWeights, buildWeeklyReport, aggregateReturns } from '../lib/weekly.mjs'
import { readArchive, scansInLastDays } from '../lib/archive.mjs'

const force = process.argv.includes('--force')
const MAX_WEEKS = 12

// 특정 날짜의 일봉 종가 조회 (해당일 자정 직후 캔들 1개)
async function fetchCandleClose(market, targetDate) {
  const toStr = new Date(targetDate.getTime() + 86400000).toISOString().slice(0, 10) + 'T00:00:00Z'
  const candles = await getDayCandlesBefore(market, toStr, 1)
  return Array.isArray(candles) && candles.length > 0 ? candles[0].trade_price : null
}

// 매수 신호의 +1/+3/+7일 시간별 적중률 (현재가 단일 판정의 보유기간 혼재 문제 보완)
async function calcTimedHitRates(scans, getItems = (s) => s.buy ?? []) {
  const now = Date.now()
  const windows = [1, 3, 7]
  const stats = Object.fromEntries(windows.map((d) => [d, { hit: 0, total: 0 }]))

  for (const scan of scans) {
    const scanTime = new Date(scan.timestamp).getTime()
    const daysPassed = (now - scanTime) / 86400000
    if (daysPassed < 1) continue
    for (const item of getItems(scan)) {
      for (const days of windows) {
        if (daysPassed < days) continue
        const price = await fetchCandleClose(item.market, new Date(scanTime + days * 86400000))
        if (price == null) continue
        stats[days].total++
        if (price > item.price) stats[days].hit++
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }

  const result = {}
  for (const days of windows) {
    const s = stats[days]
    result[`+${days}일`] = s.total > 0
      ? { hit: s.hit, total: s.total, hitRate: parseFloat((s.hit / s.total).toFixed(3)) }
      : null
  }
  return result
}

const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay()
if (!force && kstDay !== 0) {
  console.log('일요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}

const recentScans = scansInLastDays(readArchive(), 7)
if (!recentScans.length) { console.log('지난 7일 스캔 이력 없음'); process.exit(0) }

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
  .map((p) => {
    const cur = priceOf[p.market]
    const ret = p.side === 'buy' ? (cur / p.signalPrice - 1) * 100 : (p.signalPrice / cur - 1) * 100
    return { market: p.market, korean_name: p.korean_name, side: p.side, signals: p.signals, hit: judgeHit(p.side, p.signalPrice, cur), ret: +ret.toFixed(2) }
  })

const stats = aggregateHitRates(records)
const returns = aggregateReturns(records)
for (const k of Object.keys(stats)) stats[k].avgReturn = returns[k] ?? 0
// 락 안에서 fresh 재읽기 → 갱신 → 쓰기. 수동 실행이 정시 실행과 겹쳐도 갱신유실 없음.
let oldWeights, newWeights
await withLock('signal-weights', async () => {
  oldWeights = await readJson('signal-weights.json', {})
  newWeights = updateWeights(oldWeights, stats)
  await writeJson('signal-weights.json', newWeights)
})

const report = buildWeeklyReport(records, stats, oldWeights, newWeights)

console.log(`[${new Date().toISOString()}] 시간별 적중률 계산 중 (API 호출 포함)...`)
const timedHitRates = await calcTimedHitRates(recentScans)
console.log(`[${new Date().toISOString()}] 시간별 적중률:`, JSON.stringify(timedHitRates))

// 모멘텀 스캐너 검증 (지난 7일 momentum-log 픽의 +1/+3/+7일 적중률)
const momLog = await readJson('momentum-log.json', { scans: [] })
const momScans = scansInLastDays(momLog.scans || [], 7)
let momentum = null
if (momScans.length) {
  const momPicks = momScans.flatMap((s) => (s.picks ?? []).map((p) => p.market))
  const momCodes = [...new Set(momPicks)]
  const momTickers = []
  for (let i = 0; i < momCodes.length; i += 100) {
    const t = await getTicker(momCodes.slice(i, i + 100))
    if (t) momTickers.push(...t)
  }
  const momPriceOf = Object.fromEntries(momTickers.map((t) => [t.market, t.trade_price]))
  const momRecs = momScans.flatMap((s) => (s.picks ?? []).filter((p) => momPriceOf[p.market] != null).map((p) => p.price < momPriceOf[p.market]))
  const momHits = momRecs.filter(Boolean).length
  const momTimed = await calcTimedHitRates(momScans, (s) => s.picks ?? [])
  momentum = {
    picks: momRecs.length,
    overallHitRate: momRecs.length ? +(momHits / momRecs.length).toFixed(3) : 0,
    timedHitRates: momTimed,
  }
  console.log(`모멘텀 검증 — 픽 ${momRecs.length}건, 적중 ${momHits}건 (${momentum.overallHitRate})`)
}

const hitCount = records.filter((r) => r.hit).length
const result = {
  timestamp: new Date().toISOString(),
  predictions: records.length,
  hits: hitCount,
  overallHitRate: records.length ? +(hitCount / records.length).toFixed(3) : 0,
  timedHitRates,
  signalStats: stats,
  report,
  momentum,
}
// 락 안에서 fresh 재읽기 → 증가 → 쓰기. 수동 실행이 정시 실행과 겹쳐도 갱신유실 없음.
await withLock('weekly-analysis', async () => {
  const fresh = await readJson('weekly-analysis.json', { weeks: [] })
  fresh.weeks = rollingAppend(fresh.weeks || [], result, MAX_WEEKS)
  await writeJson('weekly-analysis.json', fresh)
})

console.log(`주간 분석 완료 — 예측 ${records.length}건, 적중 ${hitCount}건 (${result.overallHitRate})`)
console.log('가중치 갱신:', Object.keys(stats).filter((k) => stats[k].count >= 3).join(', ') || '없음')
console.log('적중 매수신호 TOP:', report.topBuySignals.slice(0, 3).map((s) => `${s.key} ${Math.round(s.hitRate * 100)}%(${s.hits}/${s.count})`).join(', ') || '없음')
