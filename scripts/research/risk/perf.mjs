// 일간 수익 시계열 성과 지표(연구용). 365일 연율화(암호화폐는 무휴).
export function perf(daily) {
  const r = daily.filter(Number.isFinite)
  const n = r.length
  if (n < 2) return null
  const mean = r.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
  const down = Math.sqrt(r.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / n) // 하방 편차(목표 0)
  let eq = 1, peak = 1, mdd = 0
  for (const x of r) { eq *= 1 + x; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1) }
  return {
    cagr: eq ** (365 / n) - 1,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : null,
    sortino: down > 0 ? (mean / down) * Math.sqrt(365) : null,
    mdd, total: eq - 1,
    winDays: r.filter((x) => x > 0).length / n,
    activeDays: r.filter((x) => x !== 0).length / n,
  }
}
export const fmtPerf = (p) => !p ? '—' :
  `CAGR ${(p.cagr * 100).toFixed(0).padStart(5)}% 샤프 ${p.sharpe?.toFixed(2).padStart(5)} 소르티노 ${p.sortino?.toFixed(2).padStart(5)} MDD ${(p.mdd * 100).toFixed(0).padStart(4)}% 누적 ${(p.total * 100).toFixed(0).padStart(5)}% 상승일 ${(p.winDays * 100).toFixed(0)}% 투자일 ${(p.activeDays * 100).toFixed(0)}%`
