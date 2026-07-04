// lib/scoring/context.mjs
import { scoreUniverse } from './engine.mjs'

export function buildContexts(markets, candleMap, tickerMap, market) {
  return markets.map((mk) => ({
    coin: { market: mk, ohlcvDaily: candleMap[mk] || [], ticker: tickerMap[mk] || {} },
  }))
}

// 쉐도우 실행: 절대 throw하지 않고 {scoring, scoringMeta} 또는 {scoringError} 반환.
// 저장 대상 = earlyScore top-N ∪ buyMarkets(기존 buy 후보), 중복 제거.
export function runScoringShadow(markets, candleMap, tickerMap, market, registry, config, buyMarkets = []) {
  try {
    if (!config) throw new Error('scoring config missing')
    const ctxs = buildContexts(markets, candleMap, tickerMap, market)
    const scored = scoreUniverse(ctxs, registry, config, market)
    const topN = config.archiveTopN ?? 20
    const byEarly = scored.filter((s) => s.earlyScore != null).sort((a, b) => (b.earlyScore ?? 0) - (a.earlyScore ?? 0))
    const keep = new Set(byEarly.slice(0, topN).map((s) => s.market))
    for (const m of buyMarkets) keep.add(m)
    const scoring = scored.filter((s) => keep.has(s.market))
    const covs = scored.map((s) => Object.values(s.features).filter((f) => f.normalized != null).length / (Object.keys(s.features).length || 1))
    const coverageAvg = +(covs.reduce((a, b) => a + b, 0) / (covs.length || 1)).toFixed(2)
    return { scoring, scoringMeta: { version: config.version, universeSize: markets.length, coverageAvg } }
  } catch (e) {
    return { scoringError: { message: String(e && e.message || e) } }
  }
}
