import { keyOf } from './signals.mjs'

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
export function bestHitRateSignal(stats, minSamples = 3) {
  let best = null
  for (const [key, { count, hitRate }] of Object.entries(stats)) {
    if (count < minSamples) continue
    if (!best || hitRate > best.hitRate) best = { key, count, hitRate }
  }
  return best
}
