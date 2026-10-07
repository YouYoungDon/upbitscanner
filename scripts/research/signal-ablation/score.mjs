// 라이브 monitor 매수 점수 파이프라인 재현(재생 가능한 부분만: 펀딩·코인게코·이벤트·MTF·지속성 제외).
import { readFileSync } from 'node:fs'
import { obs, mean, median, pct, MID } from './lib.mjs'
const R = new URL('../../../lib/', import.meta.url).href
const { applyCombos, fallingKnifePenalty, PATTERN_SCORE } = await import(R + 'signals.mjs')
const { liquidityMultiplier } = await import(R + 'scan-universe.mjs')
export const WEIGHTS = JSON.parse(readFileSync(new URL('../../../data/signal-weights.json', import.meta.url), 'utf8'))

// opt: { drop:Set(키), weights, noVolCombo, noGcCombo, noTrap, noKnife, extra:(x)=>mult }
export function score(x, opt = {}) {
  const W = opt.weights ?? WEIGHTS, drop = opt.drop ?? new Set()
  const items = x.b.filter(([k]) => !drop.has(k))
  let s = 0
  const labels = []
  for (const [k, base, label] of items) { s += base * (W[k] ?? 1); labels.push(label) }
  for (const p of x.pb) if (!drop.has(p)) { s += (PATTERN_SCORE[p] || 0) * (W[p] ?? 1); labels.push(p) }
  let lab = labels
  if (!opt.raw) {
    const c = applyCombos(labels, [], s, x.vr)
    s = c.buyScore; lab = c.buy
    if (opt.noVolCombo && labels.some((l) => l.startsWith('거래량 급증'))) s /= c.combos.find((q) => q.label.includes('거래량확인'))?.mult ?? 1
    if (opt.noGcCombo && c.combos.some((q) => q.label.includes('반등확인'))) s /= 1.4
    if (opt.noTrap && c.combos.some((q) => q.label.includes('함정'))) s /= 0.55
  }
  if (x.sw?.[0] === 'buy' && !drop.has('SMC 유동성 스윕')) s += x.sw[1]
  if (x.vb != null && !drop.has('SMC V-Bottom')) s += x.vb
  if (x.pu != null && !drop.has('SMC Pump Start')) s += x.pu
  if (x.reg === 'bear' && !opt.noRegime) s *= 0.85
  s *= liquidityMultiplier(x.tv)
  if (!opt.noKnife) s *= fallingKnifePenalty(lab, x.s.map(([k]) => k)).mult
  if (opt.extra) s *= opt.extra(x)
  return s
}

export function evaluate(name, opt, { thr = 5, h = 'x3', filter = () => true } = {}) {
  const rows = obs.filter((x) => x[h] != null && filter(x))
  const sc = rows.map((x) => ({ x, s: score(x, opt) }))
  const picks = sc.filter((r) => r.s >= thr)
  const st = (ps) => { const v = ps.map((r) => r.x[h]); return { n: v.length, mean: mean(v), med: median(v), win: v.filter((z) => z > 0).length / v.length, raw: mean(ps.map((r) => r.x['r' + h.slice(1)])) } }
  const top = []
  const byDay = new Map(); for (const r of picks) (byDay.get(r.x.d) || byDay.set(r.x.d, []).get(r.x.d)).push(r)
  for (const ps of byDay.values()) top.push(...ps.sort((a, b) => b.s - a.s).slice(0, 5))
  const all = st(picks), a1 = st(picks.filter((r) => r.x.d < MID)), a2 = st(picks.filter((r) => r.x.d >= MID)), t5 = st(top)
  // 순위상관(점수>0 관측): 점수가 높을수록 초과수익이 높은가
  const pos = sc.filter((r) => r.s > 0)
  const ic = spearman(pos.map((r) => r.s), pos.map((r) => r.x[h]))
  console.log(name.padEnd(30), `픽 ${String(all.n).padStart(5)} (${(all.n / byDay.size).toFixed(1)}/일)`, `초과 ${pct(all.mean).padStart(6)} 중앙 ${pct(all.med).padStart(6)} 승 ${pct(all.win, 0)}`, `| 전반 ${pct(a1.mean).padStart(6)} 후반 ${pct(a2.mean).padStart(6)}`, `| TOP5 ${pct(t5.mean).padStart(6)} 승 ${pct(t5.win, 0)}`, `| 원수익 ${pct(all.raw).padStart(6)}`, `| IC ${ic.toFixed(3)}`)
  return { all, a1, a2, t5, ic }
}
function rank(a) { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1 } return r }
function spearman(a, b) { const ra = rank(a), rb = rank(b), ma = mean(ra), mb = mean(rb); let n = 0, da = 0, db = 0; for (let i = 0; i < ra.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2 } return n / Math.sqrt(da * db) }
