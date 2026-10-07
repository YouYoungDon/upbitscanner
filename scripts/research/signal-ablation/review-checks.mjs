// 종합 점검 측정: (1) 지속성 보너스 변형 (3) 상장 후 경과일 (4) 매도 신호 단일 제거
import { readFileSync } from 'node:fs'
import { obs, MID, mean, pct } from './lib.mjs'
import { score, WEIGHTS } from './score.mjs'
const R = new URL('../../../lib/', import.meta.url).href
const { PATTERN_SCORE } = await import(R + 'signals.mjs')
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const H = ['x1', 'x3', 'x7'], parts = [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]
const base = new Map(); for (const x of obs) base.set(`${x.m}|${x.d}`, score(x, {}))
const streak = (x) => { let s = 0; for (let d = x.d - 1; (base.get(`${x.m}|${d}`) ?? 0) >= 5; d--) s++; return s }
function picksReport(name, scoreFn, thr = 5) {
  const line = [name.padEnd(26)]
  for (const h of H) for (const [lab, p] of parts) {
    const ps = obs.filter((x) => x[h] != null && p(x)).map((x) => ({ x, s: scoreFn(x) })).filter((r) => r.s >= thr)
    const by = new Map(); for (const r of ps) (by.get(r.x.d) || by.set(r.x.d, []).get(r.x.d)).push(r)
    const top = []; for (const g of by.values()) top.push(...g.sort((a, b) => b.s - a.s).slice(0, 5))
    line.push(`${h}${lab} ${pct(mean(ps.map((r) => r.x[h]))).padStart(5)}/T5 ${pct(mean(top.map((r) => r.x[h]))).padStart(5)}`)
  }
  console.log(line.join(' '))
}
console.log('=== (1) 지속성 보너스 변형 (픽 평균 / TOP5 초과수익 %p)')
const b = (x) => base.get(`${x.m}|${x.d}`)
picksReport('현행(2일+1, 3일+ +2)', (x) => { const s = streak(x); return b(x) + (s >= 3 ? 2 : s >= 2 ? 1 : 0) })
picksReport('3일+ 보너스 제거(2일만+1)', (x) => b(x) + (streak(x) === 2 ? 1 : 0))
picksReport('보너스 전부 제거', (x) => b(x))

console.log('\n=== (3) 상장 후 경과일별 픽 3일 초과수익 (창 안에서 상장한 코인만)')
const first = {}; for (const [m, o] of Object.entries(candles)) if (o.length < 590) first[m] = Math.floor(o[0].time / 86400)
for (const [lo, hi] of [[60, 90], [90, 180], [180, 400]]) {
  const sel = obs.filter((x) => first[x.m] != null && x.d - first[x.m] >= lo && x.d - first[x.m] < hi && x.x3 != null && b(x) >= 5)
  console.log(`상장 ${lo}~${hi}일`, 'n', sel.length, '전', pct(mean(sel.filter((x) => x.d < MID).map((x) => x.x3))), '후', pct(mean(sel.filter((x) => x.d >= MID).map((x) => x.x3))))
}
const old = obs.filter((x) => first[x.m] == null && x.x3 != null && b(x) >= 5)
console.log('기존 코인(600일+)', 'n', old.length, '전', pct(mean(old.filter((x) => x.d < MID).map((x) => x.x3))), '후', pct(mean(old.filter((x) => x.d >= MID).map((x) => x.x3))))

console.log('\n=== (4) 매도 목록(매도점수≥3) 단일 제거 — 매도 픽 초과수익은 낮을수록(음수) 좋다')
const sellScore = (x, drop) => {
  let s = 0
  for (const [k, base_] of x.s) if (!drop.has(k)) s += base_ * (WEIGHTS[k] ?? 1)
  for (const p of x.ps) if (!drop.has(p)) s += (PATTERN_SCORE[p] || 0) * (WEIGHTS[p] ?? 1)
  if (x.sw?.[0] === 'sell' && !drop.has('SMC 스윕 고점')) s += x.sw[1]
  return s
}
function sellReport(name, drop) {
  const line = [name.padEnd(26)]
  for (const h of H) for (const [lab, p] of parts) {
    const ps = obs.filter((x) => x[h] != null && p(x) && sellScore(x, drop) >= 3)
    line.push(`${h}${lab} ${pct(mean(ps.map((x) => x[h]))).padStart(5)}`)
  }
  const n = obs.filter((x) => sellScore(x, drop) >= 3).length
  console.log(line.join(' '), `| ${(n / 539).toFixed(1)}/일`)
}
sellReport('매도 현행', new Set())
for (const k of ['Stoch 과매수', 'Williams %R 과매수', 'Stoch 과매수 데드크로스', '쌍봉 패턴', '하락깃발 패턴', 'MACD 하락', 'MACD 하락전환', 'EMA 하락배열', '캔들 약세형'])
  sellReport(`  − ${k}`, new Set([k]))
sellReport('  − 역방향 4종 묶음', new Set(['Stoch 과매수', 'Williams %R 과매수', 'Stoch 과매수 데드크로스', '쌍봉 패턴']))
sellReport('  − 역방향 4종 + 하락깃발', new Set(['Stoch 과매수', 'Williams %R 과매수', 'Stoch 과매수 데드크로스', '쌍봉 패턴', '하락깃발 패턴']))
