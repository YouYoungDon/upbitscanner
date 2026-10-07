// 모멘텀 스캐너 재생: 라이브와 같은 확정봉 200창으로 scoreMomentum → 유동성·비중 감점 제외(재생 불가는 비중만).
// 픽(점수≥MIN) 초과수익 전/후반, 신호(그룹)별 단일 제거 시험.
import { readFileSync } from 'node:fs'
import { obs, MID, mean, median, pct } from './lib.mjs'
const R = new URL('../../../lib/', import.meta.url).href
const { scoreMomentum, MIN_MOMENTUM_SCORE } = await import(R + 'momentum.mjs')
const { liquidityMultiplier } = await import(R + 'scan-universe.mjs')
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const idx = {}
for (const [m, o] of Object.entries(candles)) idx[m] = new Map(o.map((c, i) => [Math.floor(c.time / 86400), i]))
const rows = []
for (const x of obs) {
  if (x.x3 == null) continue
  const o = candles[x.m], i = idx[x.m].get(x.d)
  const { score, signals } = scoreMomentum(o.slice(Math.max(0, i - 199), i + 1))
  if (score <= 0) { rows.push({ x, s: score, sig: [] }); continue }
  rows.push({ x, s: score * liquidityMultiplier(x.tv), raw: score, sig: signals.map((l) => l.replace(/\s*\d+봉$/, '').replace(/\s*\(-?\d+\)$/, '')) })
}
const grp = (l) => l.startsWith('연속양봉') ? '연속양봉' : l
function report(name, keep) {
  const line = [name.padEnd(30)]
  for (const h of ['x1', 'x3', 'x7']) for (const [lab, part] of [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]) {
    const ps = rows.filter((r) => part(r.x) && r.x[h] != null && keep(r))
    line.push(`${h}${lab} ${pct(mean(ps.map((r) => r.x[h]))).padStart(5)}`)
  }
  const ps = rows.filter(keep)
  console.log(line.join(' '), `| n ${ps.length} (${(ps.length / 539).toFixed(1)}/일) 승 ${pct(ps.filter((r) => r.x.x3 > 0).length / ps.length, 0)} 3일중앙 ${pct(median(ps.map((r) => r.x.x3)))}`)
}
console.log(`MIN_MOMENTUM_SCORE=${MIN_MOMENTUM_SCORE}. 값 = 픽 평균 초과수익 %p (전반/후반)`)
report('현행 픽', (r) => r.s >= MIN_MOMENTUM_SCORE)
for (const t of [6, 8, 12, 14]) report(`  임계 ${t}`, (r) => r.s >= t)
// 신호별: 해당 신호 보유 픽 vs 미보유 픽
const names = [...new Set(rows.flatMap((r) => r.sig.map(grp)))]
console.log('\n신호별 — 현행 픽 중 보유/미보유 3일 초과(전/후)')
for (const nm of names) {
  const cell = (has) => [(x) => x.d < MID, (x) => x.d >= MID].map((p) => pct(mean(rows.filter((r) => r.s >= MIN_MOMENTUM_SCORE && p(r.x) && r.sig.map(grp).includes(nm) === has).map((r) => r.x.x3)))).join('/')
  const n = rows.filter((r) => r.s >= MIN_MOMENTUM_SCORE && r.sig.map(grp).includes(nm)).length
  console.log(nm.padEnd(26), `n ${String(n).padStart(5)}  보유 ${cell(true).padStart(12)}  미보유 ${cell(false).padStart(12)}`)
}
// 과열 상태별(픽 내부)
console.log('\n현행 픽 내부 — 과열 지표별 3일 초과(전/후)')
const first = obs.filter((x) => x.d < MID)
const q80 = (f) => { const v = first.map((x) => x[f]).filter((z) => z != null).sort((a, b) => a - b); return v[Math.floor(v.length * 0.8)] }
for (const f of ['p1', 'p5', 'vr', 'hl', 'e20', 'rsi']) {
  const c = q80(f)
  const cell = (hot) => [(x) => x.d < MID, (x) => x.d >= MID].map((p) => pct(mean(rows.filter((r) => r.s >= MIN_MOMENTUM_SCORE && p(r.x) && r.x[f] != null && (r.x[f] >= c) === hot).map((r) => r.x.x3)))).join('/')
  const nh = rows.filter((r) => r.s >= MIN_MOMENTUM_SCORE && r.x[f] >= c).length
  console.log(`${f.padEnd(4)} ≥${c.toFixed(3)}  과열 n ${String(nh).padStart(5)} ${cell(true).padStart(12)}  비과열 ${cell(false).padStart(12)}`)
}
