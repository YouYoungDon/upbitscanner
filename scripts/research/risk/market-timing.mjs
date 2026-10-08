// 1번: 시장 타이밍(절대 모멘텀) 필터 측정 (2026-10-08).
// 질문: 시장이 하락 추세인 날 매수를 쉬면 스캐너 픽의 절대 성과(비용 차감)가 나아지나?
// 신호는 D 종가까지만 사용(미래 참조 없음), 픽 진입은 D 종가, 보유 1일(매일 리밸런싱, 매일 왕복 비용).
// 필터 후보는 전반 데이터로만 고르고 후반에서 검증한다.
// 실행: node scripts/research/risk/market-timing.mjs
import { readFileSync } from 'node:fs'
import { obs, MID } from '../signal-ablation/lib.mjs'
import { score } from '../signal-ablation/score.mjs'
import { ROUND_TRIP_COST } from '../../../lib/costs.mjs'
import { perf, fmtPerf } from './perf.mjs'

const C = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url), 'utf8'))
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
const idx = Object.fromEntries(Object.entries(C).map(([m, o]) => [m, new Map(o.map((c, i) => [Math.floor(c.time / 86400), i]))]))
const days = [...new Set(obs.map((x) => x.d))].sort((a, b) => a - b)

// 동일가중 시장 지수(일간 연쇄)와 BTC 종가
const mret = new Map()
for (const d of days) {
  const v = []
  for (const [m, o] of Object.entries(C)) { const i = idx[m].get(d); if (i > 0 && Math.floor(o[i - 1].time / 86400) === d - 1) v.push(W(o[i].close / o[i - 1].close - 1)) }
  if (v.length > 50) mret.set(d, v.reduce((a, b) => a + b, 0) / v.length)
}
const level = new Map(); let L = 1
for (const d of days) { if (mret.has(d)) L *= 1 + mret.get(d); level.set(d, L) }
const btc = new Map(C['KRW-BTC'].map((c) => [Math.floor(c.time / 86400), c.close]))
const btcMA = (d, n) => { let s = 0; for (let i = 0; i < n; i++) { const v = btc.get(d - i); if (v == null) return null; s += v } return s / n }

// 필터 후보: true = 그날 매수 허용
const FILTERS = { '필터 없음': () => true, '레짐≠약세(기존 라벨)': (d, reg) => reg !== 'bear' }
for (const n of [7, 14, 30, 60]) FILTERS[`시장 ${n}일 수익>0`] = (d) => { const a = level.get(d), b = level.get(d - n); return a != null && b != null && a / b - 1 > 0 }
for (const n of [20, 50, 100]) FILTERS[`BTC>MA${n}`] = (d) => { const m = btcMA(d, n); return m != null && btc.get(d) > m }

// 픽: 라이브 monitor 재현 점수 ≥ 5 (확정 종가 진입), 1일 보유 원수익
const picks = obs.filter((x) => x.r1 != null).map((x) => ({ d: x.d, reg: x.reg, r: W(x.r1) })).filter((_, i, a) => true)
const scored = obs.filter((x) => x.r1 != null && score(x) >= 5).map((x) => ({ d: x.d, reg: x.reg, r: W(x.r1) }))
const regOf = new Map(obs.map((x) => [x.d, x.reg]))
console.log(`메인 픽 ${scored.length}건 · ${days.length}일 · 분할 ${new Date(MID * 864e5).toISOString().slice(0, 10)} · 비용 ${ROUND_TRIP_COST * 100}%/일`)

// 일간 포트폴리오: 그날 픽 동일가중, 1일 보유, 비용 차감. 필터가 막으면 현금(0). 픽 없는 날도 0.
const byDay = new Map(); for (const p of scored) (byDay.get(p.d) || byDay.set(p.d, []).get(p.d)).push(p.r)
const series = (allow, half) => days.filter((d) => half(d)).map((d) => {
  const l = byDay.get(d)
  if (!l || !allow(d, regOf.get(d))) return 0
  return l.reduce((a, b) => a + b, 0) / l.length - ROUND_TRIP_COST
})
const halves = [['전반', (d) => d < MID], ['후반', (d) => d >= MID]]
console.log('\n[시장 동일가중 보유(비교용, 비용 없음)]')
for (const [lab, h] of halves) console.log(`  ${lab}: ${fmtPerf(perf(days.filter(h).map((d) => mret.get(d) ?? 0)))}`)
for (const [name, f] of Object.entries(FILTERS)) {
  console.log(`\n[${name}]`)
  for (const [lab, h] of halves) console.log(`  ${lab}: ${fmtPerf(perf(series(f, h)))}`)
  // 쉬는 날 vs 매수일의 픽 하루 수익(일 평균) 차이 — 필터가 실제로 나쁜 날을 고르나
  for (const [lab, h] of halves) {
    const on = [], off = []
    for (const d of days.filter(h)) { const l = byDay.get(d); if (!l) continue; const v = l.reduce((a, b) => a + b, 0) / l.length; (f(d, regOf.get(d)) ? on : off).push(v) }
    if (on.length < 5 || off.length < 5) { console.log(`  ${lab} 매수일/쉼일 비교: 표본 부족 (${on.length}/${off.length})`); continue }
    const m = (a) => a.reduce((s, x) => s + x, 0) / a.length, v = (a, mu) => a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1)
    const t = (m(on) - m(off)) / Math.sqrt(v(on, m(on)) / on.length + v(off, m(off)) / off.length)
    console.log(`  ${lab} 매수일 ${(m(on) * 100).toFixed(2)}% (${on.length}일) vs 쉼일 ${(m(off) * 100).toFixed(2)}% (${off.length}일) · 차이 t=${t.toFixed(2)}`)
  }
}
