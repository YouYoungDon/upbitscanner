// lib/scoring/normalizers.mjs
const bad = (v) => v == null || Number.isNaN(v)

// 유니버스 raw 분포 대비 백분위 (0~100). dist는 non-null raw 배열.
export function percentileVsUniverse(raw, dist) {
  if (bad(raw) || !Array.isArray(dist) || dist.length === 0) return null
  const le = dist.reduce((n, x) => n + (x <= raw ? 1 : 0), 0)
  return +(le / dist.length * 100).toFixed(1)
}

// 코인 자기 과거 분포 대비 백분위. hist 길이 5 미만이면 null.
export function vsOwnHistory(raw, hist, { minLen = 5 } = {}) {
  if (bad(raw) || !Array.isArray(hist) || hist.length < minLen) return null
  const clean = hist.filter((x) => !bad(x))
  if (clean.length < minLen) return null
  const le = clean.reduce((n, x) => n + (x <= raw ? 1 : 0), 0)
  return +(le / clean.length * 100).toFixed(1)
}

// 구간 보간(piecewise linear) + [0,100] 클램프. breakpoints=[[x,y],...] x 오름차순.
export function fixedCurve(raw, breakpoints) {
  if (bad(raw) || !Array.isArray(breakpoints) || breakpoints.length < 2) return null
  const bp = breakpoints
  if (raw <= bp[0][0]) return bp[0][1]
  if (raw >= bp[bp.length - 1][0]) return bp[bp.length - 1][1]
  for (let i = 1; i < bp.length; i++) {
    const [x0, y0] = bp[i - 1], [x1, y1] = bp[i]
    if (raw <= x1) return +(y0 + (y1 - y0) * ((raw - x0) / (x1 - x0))).toFixed(1)
  }
  return null
}

// 전략 위임. opts: { dist, hist, params }
export function normalize(strategy, raw, { dist, hist, params } = {}) {
  if (strategy === 'percentileVsUniverse') return percentileVsUniverse(raw, dist)
  if (strategy === 'vsOwnHistory') return vsOwnHistory(raw, hist, params || {})
  if (strategy === 'fixedCurve') return fixedCurve(raw, params)
  return null
}
