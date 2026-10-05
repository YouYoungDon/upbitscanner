// 청산 파라미터 백테스트의 판정 로직 — 순수 함수.
// I/O(캔들 조회·파일 쓰기)는 scripts/exit-backtest.mjs가 담당하고
// 여기에는 통계적 판단만 둔다(테스트 가능성).
// 단위: ret·medianRet·meanRet는 분수(-0.05 = -5%). runUpPct·threshold만 퍼센트.

function median(sorted) {
  const m = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

// 거래 결과 배열 → 요약. ret이 유한수가 아닌 항목(no-data 등)은 제외한다.
export function summarizeTrades(trades) {
  const usable = (trades ?? []).filter((t) => t && Number.isFinite(t.ret))
  const n = usable.length
  if (n === 0) return { n: 0, winRate: null, meanRet: null, medianRet: null, reasons: {} }
  const rets = usable.map((t) => t.ret)
  const reasons = {}
  for (const t of usable) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1
  return {
    n,
    winRate: rets.filter((r) => r > 0).length / n,
    meanRet: rets.reduce((a, b) => a + b, 0) / n,
    medianRet: median([...rets].sort((a, b) => a - b)),
    reasons,
  }
}

export function cellKey(p) { return `${p.slPct}/${p.tpPct}/${p.holdMax}` }

// 각 축 ±1단계 이웃. 축 범위를 벗어나는 방향은 생략한다.
export function neighborsOf(params, axes) {
  const out = []
  for (const k of ['slPct', 'tpPct', 'holdMax']) {
    const vals = axes[k] ?? []
    const i = vals.indexOf(params[k])
    if (i < 0) continue
    for (const d of [-1, 1]) {
      const j = i + d
      if (j >= 0 && j < vals.length) out.push({ ...params, [k]: vals[j] })
    }
  }
  return out
}

const STABILITY_MIN_RATIO = 0.5 // 이웃 중앙값이 최적값의 50% 미만이면 봉우리로 간주
const STABILITY_MIN_NEIGHBORS = 2 // 뒷받침하는 이웃이 2개 미만이면 안정성을 판단할 근거가 부족해 교체 후보로 인정하지 않는다

// 선정: minTrades 통과 셀 중 평균수익 최대(동률 시 승률) → 이웃 안정성 검사 → 채택.
// 불안정하면 기준선 이상인 셀 중 안정성 비율이 가장 높은 셀로 교체한다(스펙 §3.3.4).
// stability는 항상 chosen을 서술한다. 거부된 봉우리는 bestStability로 따로 노출한다.
export function pickBest(cells, axes, { minTrades, baseline }) {
  const eligible = (cells ?? []).filter((c) => c.summary.n >= minTrades)
  if (!eligible.length) {
    return { chosen: null, best: null, stability: null, bestStability: null, passesGate: false, reason: 'no-eligible-cells' }
  }
  // 이웃 증거는 minTrades를 통과한 셀만 인정한다 — 표본이 적은 셀의 평균은 잡음이고, 잡음은 증거가 아니다.
  const byKey = new Map(eligible.map((c) => [cellKey(c.params), c]))
  const stabilityOf = (c) => {
    const nbrs = neighborsOf(c.params, axes).map((p) => byKey.get(cellKey(p))).filter(Boolean)
    if (!nbrs.length) return { ratio: null, nbrMedian: null, nbrCount: 0, stable: true } // 이웃 없음 → 판정 불가, 통과 처리
    const nbrMedian = median(nbrs.map((x) => x.summary.meanRet).sort((a, b) => a - b))
    const ratio = c.summary.meanRet > 0 ? nbrMedian / c.summary.meanRet : null
    return { ratio, nbrMedian, nbrCount: nbrs.length, stable: ratio != null && ratio >= STABILITY_MIN_RATIO }
  }
  const best = [...eligible].sort((a, b) =>
    b.summary.meanRet - a.summary.meanRet || b.summary.winRate - a.summary.winRate)[0]
  const bestStability = stabilityOf(best)
  let chosen = best
  let stability = bestStability
  if (!bestStability.stable) {
    // 교체 후보는 뒷받침 이웃이 2개 이상이어야 한다 — 이웃이 적을수록 비율이 쉽게 커져,
    // 증거가 거의 없는 섬이 "가장 안정적"으로 둔갑해 교체를 가로챌 수 있기 때문이다.
    const cand = eligible
      .filter((c) => c.summary.meanRet >= baseline.meanRet)
      .map((c) => ({ c, s: stabilityOf(c) }))
      .filter((x) => x.s.ratio != null && x.s.nbrCount >= STABILITY_MIN_NEIGHBORS)
      .sort((a, b) => b.s.ratio - a.s.ratio)
    if (cand.length) { chosen = cand[0].c; stability = cand[0].s }
  }
  const passesGate = chosen.summary.meanRet >= baseline.meanRet && chosen.summary.medianRet >= baseline.medianRet
  return { chosen, best, stability, bestStability, passesGate, reason: passesGate ? 'ok' : 'below-baseline' }
}

// 과열 임계별 집계. rows: [{ runUpPct(퍼센트), fwd7(분수) }]
export function overextensionTable(rows, thresholds) {
  return (thresholds ?? []).map((threshold) => {
    const g = (rows ?? []).filter((r) => r.runUpPct > threshold)
    if (!g.length) return { threshold, n: 0, winRate: null, medianRet: null }
    return {
      threshold,
      n: g.length,
      winRate: g.filter((r) => r.fwd7 > 0).length / g.length,
      medianRet: median(g.map((r) => r.fwd7).sort((a, b) => a - b)),
    }
  })
}

// 사전등록 규칙(스펙 §3.1) — argmax 금지.
// tier*MedMax는 분수(-0.01 = -1%). 조건을 만족하는 "가장 작은" 임계를 고른다.
// monotonic: 임계가 커질수록 승률이 비증가하는지(효과의 일관성 확인).
export function applyPreRegisteredRule(table, { tier1MedMax, tier1MinN, tier2MedMax, tier2MinN }) {
  const valid = (table ?? []).filter((r) => r.n > 0).sort((a, b) => a.threshold - b.threshold)
  let monotonic = true
  for (let i = 1; i < valid.length; i++) if (valid[i].winRate > valid[i - 1].winRate) monotonic = false
  const pick = (medMax, minN) => {
    const hit = valid.filter((r) => r.medianRet <= medMax && r.n >= minN)
    return hit.length ? hit[0].threshold : null
  }
  return { monotonic, tier1Pct: pick(tier1MedMax, tier1MinN), tier2Pct: pick(tier2MedMax, tier2MinN) }
}
