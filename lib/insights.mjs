import { keyOf, SIGNAL_KEYS } from './signals.mjs'

// 신호 통계를 믿을 최소 표본. 8건짜리 '100%'가 1위로 걸리던 것(거래량 선행 매집)을 막는다.
export const MIN_STAT_SAMPLES = 30

// 현재 스캐너가 쓰는 신호인지. 주간 통계에는 제거된 신호(2026-10-07·08 정리)의 과거 집계가 남는다.
export const isActiveSignal = (key) => SIGNAL_KEYS.includes(key)

// 한 스캔 내 신호 라벨 빈도 (콤보/익절/MTF 태그 제외), 빈도순 정렬
export function topSignalsOfScan(scan) {
  const counts = {}
  for (const side of ['buy', 'sell']) {
    for (const item of scan[side] ?? []) {
      for (const label of item.signals ?? []) {
        const key = keyOf(label)
        if (!key) continue
        counts[key] = (counts[key] || 0) + 1
      }
    }
  }
  return Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

// 최소 표본(기본 3) 이상 신호 중 적중률 최고
export function bestHitRateSignal(stats, minSamples = MIN_STAT_SAMPLES) {
  let best = null
  for (const [key, { count, hitRate }] of Object.entries(stats)) {
    if (count < minSamples || !isActiveSignal(key)) continue
    if (!best || hitRate > best.hitRate) best = { key, count, hitRate }
  }
  return best
}
