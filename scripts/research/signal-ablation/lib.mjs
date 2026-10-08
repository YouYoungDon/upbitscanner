import { readFileSync } from 'node:fs'
export const obs = JSON.parse(readFileSync(new URL('../../../data/research/obs.json', import.meta.url)))
// 일별 횡단면 평균을 뺀 초과수익(시장 방향 제거). 극단치 ±50% 윈저라이즈.
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
for (const h of ['r1', 'r3', 'r7']) {
  const by = new Map()
  for (const x of obs) if (x[h] != null) { const a = by.get(x.d) || [0, 0]; a[0] += W(x[h]); a[1]++; by.set(x.d, a) }
  for (const x of obs) x['x' + h.slice(1)] = x[h] == null ? null : W(x[h]) - by.get(x.d)[0] / by.get(x.d)[1]
}
// 진입일 군집 t(같은 날 픽을 하루 평균 하나로) — 픽 단위 평균만 보면 신호가 몰린 날에 휘둘린다(2026-10-08 QA).
// 셀에 평균과 함께 찍는다: |t|<2면 그 칸의 부호는 우연과 구별되지 않는다.
import { clusteredT } from '../../../lib/perf-metrics.mjs'
export const dayT = (rows) => { const t = clusteredT(rows).t; return t == null ? '—' : t.toFixed(1) }
const days = [...new Set(obs.map((x) => x.d))].sort((a, b) => a - b)
export const MID = days[Math.floor(days.length / 2)]
// 매수측 피처(존재 여부)
export function buyFeatures(x) {
  const f = new Set()
  for (const [k] of x.b) f.add(k)
  for (const p of x.pb) f.add(p)
  if (x.sw?.[0] === 'buy') f.add('SMC 유동성 스윕')
  if (x.vb != null) f.add('SMC V-Bottom')
  if (x.pu != null) f.add('SMC Pump Start')
  return f
}
export function sellFeatures(x) {
  const f = new Set()
  for (const [k] of x.s) f.add(k)
  for (const p of x.ps) f.add(p)
  if (x.sw?.[0] === 'sell') f.add('SMC 스윕 고점')
  return f
}
// OLS (절편 포함). X: 행렬(배열의 배열), y: 배열 → {coef, se, t}
export function ols(X, y) {
  const n = X.length, k = X[0].length + 1
  const XtX = Array.from({ length: k }, () => new Float64Array(k)), Xty = new Float64Array(k)
  for (let r = 0; r < n; r++) {
    const row = [1, ...X[r]]
    for (let i = 0; i < k; i++) { if (!row[i]) continue; Xty[i] += row[i] * y[r]; for (let j = 0; j < k; j++) XtX[i][j] += row[i] * row[j] }
  }
  const inv = invert(XtX.map((r) => Array.from(r)))
  const coef = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0))
  let sse = 0
  for (let r = 0; r < n; r++) { const row = [1, ...X[r]]; let p = 0; for (let i = 0; i < k; i++) p += row[i] * coef[i]; sse += (y[r] - p) ** 2 }
  const s2 = sse / (n - k)
  const se = inv.map((r, i) => Math.sqrt(Math.max(0, r[i] * s2)))
  return { coef: coef.slice(1), se: se.slice(1), t: coef.slice(1).map((c, i) => c / se[i + 1]) }
}
function invert(A) {
  const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const d = M[c][c] || 1e-12
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j] }
  }
  return M.map((r) => r.slice(n))
}
export const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN)
export const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] }
export const pct = (v, d = 2) => (v * 100).toFixed(d)
