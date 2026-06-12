import { topSignalsOfScan, bestHitRateSignal } from '../lib/insights.mjs'

export function buildResults(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { buyCount: 0, sellCount: 0, totalScans: log?.totalScans || 0 }, buy: [], sell: [] }
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { buyCount: scan.buy.length, sellCount: scan.sell.length, totalScans: log.totalScans || 0 },
    buy: scan.buy,
    sell: scan.sell,
  }
}

export function buildInsights(log, weekly) {
  const scan = log?.scans?.at(-1)
  const topSignal = scan ? (topSignalsOfScan(scan)[0] || null) : null
  const stats = weekly?.weeks?.at(-1)?.signalStats || {}
  return { topSignal, bestHitRate: bestHitRateSignal(stats) }
}

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
