// 주간 학습 가중치(data/signal-weights.json) vs 전부 1.0 — 현행 매수 파이프라인 픽 성과 비교(전/후반).
import { obs, MID, mean, pct } from './lib.mjs'
import { score, WEIGHTS } from './score.mjs'
for (const [nm, opt] of [['학습 가중치', {}], ['전부 1.0', { weights: {} }]]) {
  const line = [nm.padEnd(10)]
  for (const h of ['x1', 'x3', 'x7']) for (const [lab, p] of [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]) {
    const ps = obs.filter((x) => x[h] != null && p(x)).map((x) => ({ x, s: score(x, opt) })).filter((r) => r.s >= 5)
    const by = new Map(); for (const r of ps) (by.get(r.x.d) || by.set(r.x.d, []).get(r.x.d)).push(r)
    const top = []; for (const g of by.values()) top.push(...g.sort((a, b) => b.s - a.s).slice(0, 5))
    line.push(`${h}${lab} ${pct(mean(ps.map((r) => r.x[h]))).padStart(5)}/T5 ${pct(mean(top.map((r) => r.x[h]))).padStart(5)}`)
  }
  console.log(line.join(' '))
}
const w = Object.entries(WEIGHTS).sort((a, b) => b[1] - a[1])
console.log('가중치 범위', w[0], w.at(-1))
