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

// 선정: minTrades 통과 셀 중 "두 다리 게이트"(평균·중앙값 모두 기준선 이상)를 만족하는
// 셀만 후보로 삼고, 그 안에서 평균수익 최대(동률 시 승률) → 이웃 안정성 검사 → 채택한다.
// 게이트를 채택 이후가 아니라 후보 자격 단계에서 먼저 걸어야 한다 — 그러지 않으면 평균
// 1위 셀이 중앙값 다리에서 떨어져도 그 셀만 보고 전체를 탈락 처리하게 되어, 두 다리를 모두
// 통과하는 다른 셀이 있어도 찾아보지 않는다.
// 불안정하면 후보 중 안정성 비율이 가장 높은 셀로 교체한다(스펙 §3.3.4).
// stability는 항상 chosen을 서술한다. 거부된 봉우리는 bestStability로 따로 노출한다.
export function pickBest(cells, axes, { minTrades, baseline }) {
  const eligible = (cells ?? []).filter((c) => c.summary.n >= minTrades)
  if (!eligible.length) {
    return { chosen: null, best: null, stability: null, bestStability: null, passesGate: false, reason: 'no-eligible-cells' }
  }
  // 이웃 증거는 minTrades를 통과한 셀 전체(게이트 통과 여부와 무관)에서 찾는다 — 게이트는
  // 후보 자격의 문제이고, 이웃 조회는 그 주변이 고원인지 봉우리인지 판단하는 증거의 문제다.
  // 후보 풀을 기준으로 이웃을 좁히면 nbrCount가 조용히 달라져 안정성 검사가 깨진다.
  const byKey = new Map(eligible.map((c) => [cellKey(c.params), c]))
  const stabilityOf = (c) => {
    const nbrs = neighborsOf(c.params, axes).map((p) => byKey.get(cellKey(p))).filter(Boolean)
    if (!nbrs.length) return { ratio: null, nbrMedian: null, nbrCount: 0, stable: true } // 이웃 없음 → 판정 불가, 통과 처리
    const nbrMedian = median(nbrs.map((x) => x.summary.meanRet).sort((a, b) => a - b))
    const ratio = c.summary.meanRet > 0 ? nbrMedian / c.summary.meanRet : null
    return { ratio, nbrMedian, nbrCount: nbrs.length, stable: ratio != null && ratio >= STABILITY_MIN_RATIO }
  }
  const pool = eligible.filter((c) =>
    c.summary.meanRet >= baseline.meanRet && c.summary.medianRet >= baseline.medianRet)
  if (!pool.length) {
    return { chosen: null, best: null, stability: null, bestStability: null, passesGate: false, reason: 'below-baseline' }
  }
  // `best` = 게이트 통과 풀(pool) 안에서의 평균수익 1위이며, **그리드 전체의 argmax가 아니다.**
  // 두 다리 게이트를 후보 자격 단계에서 먼저 걸기 때문에(위 주석), 평균은 더 높지만 중앙값
  // 다리에서 탈락한 셀은 pool에 들어오지 않아 여기서 보이지 않는다(실측: 12/18/7이 그 경우).
  // 안정성 검사를 "실제로 채택할 셀"에 대해 수행하려면 이 정의가 맞다 — 다만 이 필드를
  // "그리드 최적"으로 읽으면 안 된다. 리포트·로그 문구도 그렇게 쓰지 않는다.
  const best = [...pool].sort((a, b) =>
    b.summary.meanRet - a.summary.meanRet || b.summary.winRate - a.summary.winRate)[0]
  const bestStability = stabilityOf(best)
  let chosen = best
  let stability = bestStability
  if (!bestStability.stable) {
    // 교체 후보는 뒷받침 이웃이 2개 이상이어야 한다 — 이웃이 적을수록 비율이 쉽게 커져,
    // 증거가 거의 없는 섬이 "가장 안정적"으로 둔갑해 교체를 가로챌 수 있기 때문이다.
    // 후보는 이미 게이트를 통과한 pool에서만 고른다(게이트 미달 셀은 후보 자격이 없다).
    const cand = pool
      .map((c) => ({ c, s: stabilityOf(c) }))
      .filter((x) => x.s.ratio != null && x.s.nbrCount >= STABILITY_MIN_NEIGHBORS)
      .sort((a, b) => b.s.ratio - a.s.ratio)
    if (cand.length) { chosen = cand[0].c; stability = cand[0].s }
  }
  // chosen은 항상 pool(두 다리 게이트 통과)에서 나오므로 passesGate는 구조상 true이지만,
  // 하드코딩하지 않고 그대로 계산해 둔다 — 향후 로직이 바뀌어도 이 불변 조건이 깨지면 바로 드러난다.
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
// 단조성은 스펙 §3.1 step 1의 **하드 스톱**이다 — "성립하지 않으면 과열 필터 전체를 보류".
// 따라서 monotonic=false이면 임계값을 아예 반환하지 않는다(둘 다 null). 호출부가 monotonic을
// 확인하지 않고 tier*Pct만 읽어도 사전등록 규칙이 거부한 값을 배선할 수 없게 하는 안전장치다.
export function applyPreRegisteredRule(table, { tier1MedMax, tier1MinN, tier2MedMax, tier2MinN }) {
  const valid = (table ?? []).filter((r) => r.n > 0).sort((a, b) => a.threshold - b.threshold)
  let monotonic = true
  for (let i = 1; i < valid.length; i++) if (valid[i].winRate > valid[i - 1].winRate) monotonic = false
  const pick = (medMax, minN) => {
    if (!monotonic) return null
    const hit = valid.filter((r) => r.medianRet <= medMax && r.n >= minN)
    return hit.length ? hit[0].threshold : null
  }
  return { monotonic, tier1Pct: pick(tier1MedMax, tier1MinN), tier2Pct: pick(tier2MedMax, tier2MinN) }
}
