import { obs, buyFeatures, sellFeatures, ols, mean, median, pct, MID } from './lib.mjs'
const side = process.argv[2] || 'buy'
const H = process.argv[3] || 'x3'
const feat = side === 'buy' ? buyFeatures : sellFeatures
const rows = obs.filter((x) => x[H] != null).map((x) => ({ x, f: feat(x) }))
const names = [...new Set(rows.flatMap((r) => [...r.f]))].filter((nm) => rows.filter((r) => r.f.has(nm)).length >= 30).sort()
const fit = (rs) => ols(rs.map((r) => names.map((nm) => (r.f.has(nm) ? 1 : 0))), rs.map((r) => r.x[H]))
const all = fit(rows), h1 = fit(rows.filter((r) => r.x.d < MID)), h2 = fit(rows.filter((r) => r.x.d >= MID))
const out = names.map((nm, i) => {
  const ys = rows.filter((r) => r.f.has(nm)).map((r) => r.x[H])
  return { nm, n: ys.length, uni: mean(ys), med: median(ys), win: ys.filter((v) => v > 0).length / ys.length, c: all.coef[i], t: all.t[i], c1: h1.coef[i], c2: h2.coef[i] }
}).sort((a, b) => b.t - a.t)
console.log(`${side} ${H}  n=${rows.length}  (단위 %p, 초과수익, 윈저 ±50%)`)
console.log('신호'.padEnd(22), 'n'.padStart(6), '단순평균', '중앙값', '승률', ' |한계효과', '  t', '  전반', '  후반')
for (const r of out) console.log(r.nm.padEnd(22), String(r.n).padStart(6), pct(r.uni).padStart(7), pct(r.med).padStart(6), pct(r.win, 0).padStart(4), '|', pct(r.c).padStart(7), r.t.toFixed(1).padStart(5), pct(r.c1).padStart(6), pct(r.c2).padStart(6))
