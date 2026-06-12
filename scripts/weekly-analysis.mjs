import { getTicker, getDayCandlesBefore } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { judgeHit, aggregateHitRates, updateWeights } from '../lib/weekly.mjs'

const force = process.argv.includes('--force')
const MAX_WEEKS = 12

// 특정 날짜의 일봉 종가 조회 (해당일 자정 직후 캔들 1개)
async function fetchCandleClose(market, targetDate) {
  const toStr = new Date(targetDate.getTime() + 86400000).toISOString().slice(0, 10) + 'T00:00:00Z'
  const candles = await getDayCandlesBefore(market, toStr, 1)
  return Array.isArray(candles) && candles.length > 0 ? candles[0].trade_price : null
}

// 매수 신호의 +1/+3/+7일 시간별 적중률 (현재가 단일 판정의 보유기간 혼재 문제 보완)
async function calcTimedHitRates(scans) {
  const now = Date.now()
  const windows = [1, 3, 7]
  const stats = Object.fromEntries(windows.map((d) => [d, { hit: 0, total: 0 }]))

  for (const scan of scans) {
    const scanTime = new Date(scan.timestamp).getTime()
    const daysPassed = (now - scanTime) / 86400000
    if (daysPassed < 1) continue
    for (const item of scan.buy ?? []) {
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
if (!force && kstDay !== 3) {
  console.log('수요일이 아닙니다. --force로 강제 실행 가능.')
  process.exit(0)
}

const log = await readJson('monitor-log.json', { scans: [] })
const recentScans = log.scans.slice(-7)
if (!recentScans.length) { console.log('스캔 이력 없음'); process.exit(0) }

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
const hist = await readJson('weekly-analysis.json', { weeks: [] })
hist.weeks = rollingAppend(hist.weeks || [], result, MAX_WEEKS)
await writeJson('weekly-analysis.json', hist)

console.log(`주간 분석 완료 — 예측 ${records.length}건, 적중 ${hitCount}건 (${result.overallHitRate})`)
console.log('가중치 갱신:', Object.keys(stats).filter((k) => stats[k].count >= 3).join(', ') || '없음')
