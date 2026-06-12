import { getTicker } from '../lib/upbit.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { judgeHit, aggregateHitRates, updateWeights } from '../lib/weekly.mjs'

const force = process.argv.includes('--force')
const MAX_WEEKS = 12

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

const hitCount = records.filter((r) => r.hit).length
const result = {
  timestamp: new Date().toISOString(),
  predictions: records.length,
  hits: hitCount,
  overallHitRate: records.length ? +(hitCount / records.length).toFixed(3) : 0,
  signalStats: stats,
}
const hist = await readJson('weekly-analysis.json', { weeks: [] })
hist.weeks = rollingAppend(hist.weeks || [], result, MAX_WEEKS)
await writeJson('weekly-analysis.json', hist)

console.log(`주간 분석 완료 — 예측 ${records.length}건, 적중 ${hitCount}건 (${result.overallHitRate})`)
console.log('가중치 갱신:', Object.keys(stats).filter((k) => stats[k].count >= 3).join(', ') || '없음')
