// 지속성 보너스(전날까지 연속 매수권 일수 2일→+1, 3일+→+2) 유무 비교. 연속 판정은 보너스 없는 점수≥5 기준.
import { obs, MID, mean, pct } from './lib.mjs'
import { score } from './score.mjs'
const base = new Map()
for (const x of obs) base.set(`${x.m}|${x.d}`, score(x, {}))
const streak = (x) => { let s = 0; for (let d = x.d - 1; (base.get(`${x.m}|${d}`) ?? 0) >= 5; d--) s++; return s }
const bonus = (x) => { const s = streak(x); return s >= 3 ? 2 : s >= 2 ? 1 : 0 }
for (const [nm, f] of [['보너스 없음', () => 0], ['지속성 보너스', bonus]]) {
  const line = [nm.padEnd(12)]
  let all = []
  for (const h of ['x1', 'x3', 'x7']) for (const [lab, p] of [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]) {
    const ps = obs.filter((x) => x[h] != null && p(x)).map((x) => ({ x, s: base.get(`${x.m}|${x.d}`) + f(x) })).filter((r) => r.s >= 5)
    if (h === 'x3') all.push(...ps)
    const by = new Map(); for (const r of ps) (by.get(r.x.d) || by.set(r.x.d, []).get(r.x.d)).push(r)
    const top = []; for (const g of by.values()) top.push(...g.sort((a, b) => b.s - a.s).slice(0, 5))
    line.push(`${h}${lab} ${pct(mean(ps.map((r) => r.x[h]))).padStart(5)}/T5 ${pct(mean(top.map((r) => r.x[h]))).padStart(5)}`)
  }
  console.log(line.join(' '), `| ${(all.length / 539).toFixed(1)}/일`)
}
// 연속일수별 3일 초과(전/후)
for (const k of [0, 1, 2, 3]) {
  const sel = obs.filter((x) => x.x3 != null && base.get(`${x.m}|${x.d}`) >= 5 && (k < 3 ? streak(x) === k : streak(x) >= 3))
  console.log(`연속 ${k}${k === 3 ? '+' : ''}일`, 'n', sel.length, '전', pct(mean(sel.filter((x) => x.d < MID).map((x) => x.x3))), '후', pct(mean(sel.filter((x) => x.d >= MID).map((x) => x.x3))))
}
