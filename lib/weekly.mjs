import { newWeight } from './store.mjs'
import { keyOf } from './signals.mjs'

const MIN_SAMPLES = 3

export function judgeHit(side, signalPrice, currentPrice) {
  return side === 'buy' ? currentPrice > signalPrice : currentPrice < signalPrice
}

export function aggregateHitRates(records) {
  const acc = {}
  for (const rec of records) {
    for (const label of rec.signals) {
      const key = keyOf(label)
      if (!key) continue
      acc[key] ??= { count: 0, hits: 0 }
      acc[key].count++
      if (rec.hit) acc[key].hits++
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(acc)) {
    out[k] = { count: v.count, hitRate: v.count ? v.hits / v.count : 0 }
  }
  return out
}

export function updateWeights(weights, stats) {
  const out = { ...weights }
  for (const [key, { count, hitRate }] of Object.entries(stats)) {
    if (count < MIN_SAMPLES) continue
    out[key] = newWeight(out[key] ?? 1, hitRate)
  }
  return out
}

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
