import { obs, mean, median, pct, MID } from './lib.mjs'
import { score } from './score.mjs'
const D1 = ['거래량 급증', 'MACD 반등', 'EMA 20/50 골든크로스', '거래량 선행 매집', 'SMC Pump Start']
const D2 = [...D1, 'MACD 골든크로스', 'Stoch 과매도', 'Williams %R 과매도']
const V = { V0: { opt: {} }, V1: { opt: { drop: new Set(['거래량 급증']) } }, D1: { opt: { drop: new Set(D1) } }, D2: { opt: { drop: new Set(D2) } } }
for (const thr of [4, 5]) for (const h of ['x1', 'x3', 'x7']) {
  for (const [name, { opt }] of Object.entries(V)) {
    const line = [`thr${thr} ${h} ${name.padEnd(3)}`]
    for (const [lab, part] of [['전반', (x) => x.d < MID], ['후반', (x) => x.d >= MID]]) {
      const rows = obs.filter((x) => x[h] != null && part(x)).map((x) => ({ x, s: score(x, opt) }))
      const picks = rows.filter((r) => r.s >= thr), days = new Set(rows.map((r) => r.x.d)).size
      const by = new Map(); for (const r of picks) (by.get(r.x.d) || by.set(r.x.d, []).get(r.x.d)).push(r)
      const top = []; for (const ps of by.values()) top.push(...ps.sort((a, b) => b.s - a.s).slice(0, 5))
      const v = picks.map((r) => r.x[h]), t = top.map((r) => r.x[h])
      line.push(`${lab} ${(picks.length / days).toFixed(1).padStart(4)}/일 초과 ${pct(mean(v)).padStart(6)} 중앙 ${pct(median(v)).padStart(6)} 승 ${pct(v.filter((z) => z > 0).length / v.length, 0)} TOP5 ${pct(mean(t)).padStart(6)} 승 ${pct(t.filter((z) => z > 0).length / t.length, 0)}`)
    }
    console.log(line.join(' | '))
  }
}
