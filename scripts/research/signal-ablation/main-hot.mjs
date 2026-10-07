import { obs, MID, mean, median, pct } from './lib.mjs'
import { score } from './score.mjs'
const first = obs.filter((x) => x.d < MID)
const q80 = (f) => { const v = first.map((x) => x[f]).filter((z) => z != null).sort((a, b) => a - b); return v[Math.floor(v.length * 0.8)] }
const CP1 = q80('p1'), CHL = q80('hl')
const hot = (x) => x.p1 >= CP1 || x.hl >= CHL
for (const [nm, opt] of [['메인 현행(정리 후)', {}], ['메인 + 당일과열 제외', { extra: (x) => (hot(x) ? 0 : 1) }]]) {
  const line = [nm.padEnd(22)]
  let all = []
  for (const h of ['x1', 'x3', 'x7']) for (const [lab, p] of [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]) {
    const rows = obs.filter((x) => x[h] != null && p(x)).map((x) => ({ x, s: score(x, opt) }))
    const ps = rows.filter((r) => r.s >= 5); if (h === 'x3') all.push(...ps)
    const by = new Map(); for (const r of ps) (by.get(r.x.d) || by.set(r.x.d, []).get(r.x.d)).push(r)
    const top = []; for (const g of by.values()) top.push(...g.sort((a, b) => b.s - a.s).slice(0, 5))
    line.push(`${h}${lab} ${pct(mean(ps.map((r) => r.x[h]))).padStart(5)}/T5 ${pct(mean(top.map((r) => r.x[h]))).padStart(5)}`)
  }
  console.log(line.join(' '), `| ${(all.length / 539).toFixed(1)}/일 승 ${pct(all.filter((r) => r.x.x3 > 0).length / all.length, 0)}`)
}
