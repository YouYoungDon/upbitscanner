import { newWeight } from './store.mjs'
import { keyOf } from './signals.mjs'

export const MIN_SAMPLES = 8

export function judgeHit(side, signalPrice, currentPrice) {
  return side === 'buy' ? currentPrice > signalPrice : currentPrice < signalPrice
}

// D0+horizon일 확정종가로 예측을 판정해 레코드 생성. 종가 없는 픽(미확정·fetch 실패)은 제외.
// preds: [{ market, korean_name, side, signalPrice, signals, dayIdx }] (dayIdx = 스캔일 UTC day-index)
// closeOf: (market, dayIdx) => 확정 종가 | null
export function judgeAtHorizon(preds, closeOf, horizonDays = 1) {
  const out = []
  for (const p of preds) {
    const close = closeOf(p.market, p.dayIdx + horizonDays)
    if (close == null || !(p.signalPrice > 0)) continue
    const ret = p.side === 'buy' ? (close / p.signalPrice - 1) * 100 : (p.signalPrice / close - 1) * 100
    out.push({
      market: p.market, korean_name: p.korean_name, side: p.side, signals: p.signals, ts: p.ts,
      hit: judgeHit(p.side, p.signalPrice, close), ret: +ret.toFixed(2),
    })
  }
  return out
}

// 신호별 적중률 + 평균수익(%) 병합 집계 — 표시용·학습용 공용 (분기 시 두 경로 동시 반영 보장)
export function statsWithReturns(records) {
  const stats = aggregateHitRates(records)
  const returns = aggregateReturns(records)
  for (const k of Object.keys(stats)) stats[k].avgReturn = returns[k] ?? 0
  return stats
}

// 매수/매도 분리 헤드라인 요약
export function sideSummary(records) {
  const of = (side) => {
    const rs = records.filter((r) => r.side === side)
    const hits = rs.filter((r) => r.hit).length
    return { predictions: rs.length, hits, hitRate: rs.length ? +(hits / rs.length).toFixed(3) : 0 }
  }
  return { buy: of('buy'), sell: of('sell') }
}

// +1/+3/+7일 적중률 (확정종가 캐시 기반, 순수). getItems로 매수(s.buy)·모멘텀(s.picks) 선택.
export function timedHitRates(scans, getItems, closeOf) {
  const windows = [1, 3, 7]
  const stats = Object.fromEntries(windows.map((d) => [d, { hit: 0, total: 0 }]))
  for (const scan of scans) {
    const d0 = Math.floor(new Date(scan.timestamp).getTime() / 86400000)
    for (const item of getItems(scan)) {
      for (const days of windows) {
        const close = closeOf(item.market, d0 + days)
        if (close == null) continue
        stats[days].total++
        if (judgeHit('buy', item.price, close)) stats[days].hit++
      }
    }
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
  for (const [key, { count, hitRate, avgReturn }] of Object.entries(stats)) {
    if (count < MIN_SAMPLES) continue
    out[key] = newWeight(out[key] ?? 1, hitRate, avgReturn)
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

// 가중치 학습 동결(10-30 결정): 판정 예상일(11-28)까지 점수 체계를 고정한다. 마지막 갱신은 10-25 22:00 KST.
// 설계: docs/superpowers/specs/2026-10-30-score-reversal-design.md. 해제 뒤 첫 실행이 learnedUntil 이후를 캐치업한다.
// SPLIT_DAY = 동결 전후를 나눠 보는 경계. 마지막 갱신일 다음 UTC 날 0시 — 날 중간에서 자르면 진입일 제외 규칙이 어긋난다.
export const WEIGHTS_FREEZE = { SPLIT_DAY: '2026-10-26T00:00:00Z', UNTIL: '2026-11-29T00:00:00Z', WARN_DAYS: 14 }
export const weightsFrozen = (nowMs = Date.now()) => nowMs < Date.parse(WEIGHTS_FREEZE.UNTIL)
// 기한이 가까우면 안내 문구 — 기한 뒤 첫 일요일 실행이 가중치를 덮어쓰고 되돌릴 수 없어서 미리 결정하게 한다.
export function freezeNotice(nowMs = Date.now()) {
  const left = (Date.parse(WEIGHTS_FREEZE.UNTIL) - nowMs) / 86400000
  if (left <= 0 || left > WEIGHTS_FREEZE.WARN_DAYS) return null
  return `가중치 동결이 ${Math.ceil(left)}일 뒤(${WEIGHTS_FREEZE.UNTIL.slice(0, 10)}) 끝납니다. 판정이 안 났으면 기한 연장을 결정하세요(WEIGHTS_FREEZE.UNTIL).`
}
