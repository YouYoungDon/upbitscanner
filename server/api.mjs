import { topSignalsOfScan, bestHitRateSignal } from '../lib/insights.mjs'
import { summarizeScans } from '../lib/archive.mjs'

// 매수 종목 신호 태그에서 콤보/MTF 종목 수 집계
export function comboDistribution(buyList = []) {
  const has = (item, kw) => (item.signals || []).some((s) => s.includes(kw))
  let rebound = 0, trap = 0, volume = 0, mtf = 0
  for (const item of buyList) {
    if (has(item, '반등확인')) rebound++
    if (has(item, '과매도 함정')) trap++
    if (has(item, '거래량확인')) volume++
    if (has(item, '[MTF]')) mtf++
  }
  return { rebound, trap, volume, mtf }
}

// 캔들 강세/약세형 종목 수 + 대표 패턴 (라벨 '캔들 강세형 (망치형,...)'에서 추출)
export function candleSummary(scan = {}) {
  const names = (signals, key) => {
    const label = (signals || []).find((s) => s.startsWith(key))
    if (!label) return []
    const m = label.match(/\(([^)]*)\)/)
    return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : []
  }
  let bullishCount = 0, bearishCount = 0
  const bullCounts = {}, bearCounts = {}
  for (const item of scan.buy || []) {
    const ns = names(item.signals, '캔들 강세형')
    if (ns.length) bullishCount++
    for (const n of ns) bullCounts[n] = (bullCounts[n] || 0) + 1
  }
  for (const item of scan.sell || []) {
    const ns = names(item.signals, '캔들 약세형')
    if (ns.length) bearishCount++
    for (const n of ns) bearCounts[n] = (bearCounts[n] || 0) + 1
  }
  const top = (counts) => Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 3)
  return { bullishCount, bearishCount, topBullish: top(bullCounts), topBearish: top(bearCounts) }
}

// 최근 스캔별 매수/매도 개수 추이
export function buildHistory(log, limit = 14) {
  const scans = (log?.scans || []).slice(-limit)
  return scans.map((s) => ({ timestamp: s.timestamp, buyCount: (s.buy || []).length, sellCount: (s.sell || []).length }))
}

export function buildResults(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { buyCount: 0, sellCount: 0, totalScans: log?.totalScans || 0 }, buy: [], sell: [], comboDist: { rebound: 0, trap: 0, volume: 0, mtf: 0 }, candleSummary: { bullishCount: 0, bearishCount: 0, topBullish: [], topBearish: [] } }
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { buyCount: scan.buy.length, sellCount: scan.sell.length, totalScans: log.totalScans || 0 },
    buy: scan.buy,
    sell: scan.sell,
    comboDist: comboDistribution(scan.buy),
    candleSummary: candleSummary(scan),
    regime: scan.regime || null,
  }
}

// 모멘텀 스캔 최신 결과 (추세지속 추천)
export function buildMomentum(log) {
  const scan = log?.scans?.at(-1)
  if (!scan) return { empty: true, kpi: { count: 0, totalScans: log?.totalScans || 0 }, picks: [] }
  return {
    empty: false,
    timestamp: scan.timestamp,
    kpi: { count: (scan.picks || []).length, totalScans: log.totalScans || 0 },
    picks: scan.picks || [],
  }
}

export function buildInsights(log, weekly) {
  const scan = log?.scans?.at(-1)
  const topSignal = scan ? (topSignalsOfScan(scan)[0] || null) : null
  const stats = weekly?.weeks?.at(-1)?.signalStats || {}
  return { topSignal, bestHitRate: bestHitRateSignal(stats) }
}

// 아카이브 스캔(시간 오름차순)을 최신순 요약으로, limit/offset 적용
export function buildScans(scans, { limit = 20, offset = 0 } = {}) {
  const summaries = summarizeScans(scans).slice().reverse() // 최신순
  return { total: summaries.length, items: summaries.slice(offset, offset + limit) }
}

export function findScanByTimestamp(scans, ts) {
  return scans.find((s) => s.timestamp === ts) || null
}

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
