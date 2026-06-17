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

// 신호별 평균 수익률(%) 집계. record.ret = 신호 방향 기준 유리한 수익률(%).
export function aggregateReturns(records) {
  const acc = {}
  for (const rec of records) {
    if (rec.ret == null) continue
    for (const label of rec.signals) {
      const key = keyOf(label)
      if (!key) continue
      acc[key] ??= { sum: 0, n: 0 }
      acc[key].sum += rec.ret
      acc[key].n++
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(acc)) out[k] = v.n ? +(v.sum / v.n).toFixed(2) : 0
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

// 한 쪽(side)의 신호별 적중률 집계: 표본 MIN_SAMPLES 이상, 적중률 내림차순(동률 시 표본 많은 순)
function topSignalsBySide(records, side) {
  const acc = {}
  for (const r of records) {
    if (r.side !== side) continue
    for (const label of r.signals) {
      const key = keyOf(label)
      if (!key) continue
      acc[key] ??= { count: 0, hits: 0 }
      acc[key].count++
      if (r.hit) acc[key].hits++
    }
  }
  return Object.entries(acc)
    .filter(([, v]) => v.count >= MIN_SAMPLES)
    .map(([key, v]) => ({ key, count: v.count, hitRate: v.count ? v.hits / v.count : 0, hits: v.hits }))
    .sort((a, b) => b.hitRate - a.hitRate || b.count - a.count)
    .slice(0, 8)
}

// 주간 "왜 맞았는지" 리포트 (순수 함수)
export function buildWeeklyReport(records = [], stats = {}, oldWeights = {}, newWeights = {}) {
  const topBuySignals = topSignalsBySide(records, 'buy')
  const topSellSignals = topSignalsBySide(records, 'sell')

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

  return { topBuySignals, topSellSignals, weightChanges, hitCoins, missCoins }
}
