// 아카이브 누적 스캔을 윈도우로 집계해 반복 등장 빈도 × 평균 점수로 추천 랭킹.
// 최신 스캔 1개가 아니라 윈도우 전체를 보므로 스캔마다 픽이 바뀌지 않는다.
export function aggregateRecommendations(scans, { windowMs, now = Date.now() }) {
  const cutoff = now - windowMs
  const acc = new Map()
  for (const s of scans || []) {
    const t = Date.parse(s?.timestamp)
    if (!Number.isFinite(t) || t < cutoff) continue
    for (const b of s.buy || []) {
      if (b.lowLiquidity) continue
      if (b.score == null || Number.isNaN(b.score)) continue
      const cur = acc.get(b.market) || { market: b.market, korean_name: b.korean_name, appearances: 0, sumScore: 0, maxScore: -Infinity, lastSeen: '', lastSignals: [] }
      cur.appearances += 1
      cur.sumScore += b.score
      cur.maxScore = Math.max(cur.maxScore, b.score)
      cur.korean_name = b.korean_name || cur.korean_name
      if (s.timestamp >= cur.lastSeen) {
        cur.lastSeen = s.timestamp
        cur.lastSignals = b.signals || []
        cur.dominance = b.dominance
        cur.cg = b.cg
      }
      acc.set(b.market, cur)
    }
  }
  const out = []
  for (const c of acc.values()) {
    const avgScore = +(c.sumScore / c.appearances).toFixed(1)
    out.push({
      market: c.market, korean_name: c.korean_name,
      appearances: c.appearances, avgScore, maxScore: c.maxScore,
      rankScore: +(c.appearances * avgScore).toFixed(1),
      lastSeen: c.lastSeen, lastSignals: c.lastSignals,
      ...(c.dominance ? { dominance: c.dominance } : {}),
      ...(c.cg ? { cg: c.cg } : {}),
    })
  }
  out.sort((a, b) => b.rankScore - a.rankScore || b.appearances - a.appearances || b.avgScore - a.avgScore)
  return out
}
