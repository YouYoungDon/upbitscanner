import { readFileSync } from 'node:fs'
import { obs, MID, mean, median, pct } from './lib.mjs'
const R = new URL('../../../lib/', import.meta.url).href
const { scoreMomentum, MIN_MOMENTUM_SCORE } = await import(R + 'momentum.mjs')
const { liquidityMultiplier } = await import(R + 'scan-universe.mjs')
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const idx = {}; for (const [m, o] of Object.entries(candles)) idx[m] = new Map(o.map((c, i) => [Math.floor(c.time / 86400), i]))
const first = obs.filter((x) => x.d < MID)
const q80 = (f) => { const v = first.map((x) => x[f]).filter((z) => z != null).sort((a, b) => a - b); return v[Math.floor(v.length * 0.8)] }
const CP1 = q80('p1'), CHL = q80('hl')
const rows = []
for (const x of obs) {
  if (x.x3 == null) continue
  const o = candles[x.m], i = idx[x.m].get(x.d)
  const { score, signals } = scoreMomentum(o.slice(Math.max(0, i - 199), i + 1))
  if (score < 6) continue
  rows.push({ x, s: score * liquidityMultiplier(x.tv), sig: signals })
}
const hot = (x) => x.p1 >= CP1 || x.hl >= CHL
const macdOnly = (r) => r.sig.includes('MACD 히스토 3연속↑')
const V = {
  '현행': (r) => r.s >= MIN_MOMENTUM_SCORE,
  'M1 당일과열 제외': (r) => r.s >= MIN_MOMENTUM_SCORE && !hot(r.x),
  'M2 M1 + MACD단독(+2) 제거': (r) => (r.s - (macdOnly(r) ? 2 : 0)) >= MIN_MOMENTUM_SCORE && !hot(r.x),
}
console.log(`과열 컷(전반 80분위): 당일상승 ≥${pct(CP1, 1)}% 또는 윗꼬리 ≥${pct(CHL, 1)}%`)
for (const [nm, keep] of Object.entries(V)) {
  const line = [nm.padEnd(26)]
  for (const h of ['x1', 'x3', 'x7']) for (const [lab, p] of [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]) {
    const ps = rows.filter((r) => p(r.x) && r.x[h] != null && keep(r)); line.push(`${h}${lab} ${pct(mean(ps.map((r) => r.x[h]))).padStart(5)}`)
  }
  const ps = rows.filter(keep)
  console.log(line.join(' '), `| ${(ps.length / 539).toFixed(1)}/일 승 ${pct(ps.filter((r) => r.x.x3 > 0).length / ps.length, 0)} 중앙 ${pct(median(ps.map((r) => r.x.x3)))}`)
}
