// 2번: 리스크 관리 측정 (2026-10-08).
// (a) 청산: 현행 고정 SL12/TP12/7일 vs 트레일링 스탑(고점 대비 %·ATR 배수) — 메인 픽(재생 점수 ≥ 5), D 종가 진입.
//     일봉 경로 보수 규칙: 오늘 저가가 '어제까지 고점'으로 정한 스탑을 깨면 청산(갭 하락이면 시가), 고점은 그 뒤 갱신.
//     고정 규칙은 같은 봉 SL·TP 동시 도달 시 손절 우선. 모든 거래 왕복 비용 차감.
// (b) 비중: 같은 날 픽을 동일가중 vs 변동성 역비례(20일 일간 표준편차) — 1일 보유 일간 포트폴리오로 비교.
// 변형은 전반 성과로 고르고 후반에서 검증한다.
// 실행: node scripts/research/risk/sizing-exits.mjs
import { readFileSync } from 'node:fs'
import { obs, MID } from '../signal-ablation/lib.mjs'
import { score } from '../signal-ablation/score.mjs'
import { ROUND_TRIP_COST } from '../../../lib/costs.mjs'
import { clusteredT } from '../../../lib/perf-metrics.mjs'
import { perf, fmtPerf } from './perf.mjs'

const C = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url), 'utf8'))
const idx = Object.fromEntries(Object.entries(C).map(([m, o]) => [m, new Map(o.map((c, i) => [Math.floor(c.time / 86400), i]))]))
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
const picks = obs.filter((x) => score(x) >= 5).map((x) => ({ m: x.m, d: x.d, i: idx[x.m].get(x.d) })).filter((p) => p.i != null)

const atr14 = (o, i) => { if (i < 15) return null; let s = 0; for (let k = i - 13; k <= i; k++) s += Math.max(o[k].high - o[k].low, Math.abs(o[k].high - o[k - 1].close), Math.abs(o[k].low - o[k - 1].close)); return s / 14 }
const vol20 = (o, i) => { if (i < 21) return null; const r = []; for (let k = i - 19; k <= i; k++) r.push(o[k].close / o[k - 1].close - 1); const m = r.reduce((a, b) => a + b, 0) / 20; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / 19) }

// 청산 시뮬레이터. 반환: 비용 차감 수익(완결 안 되면 null)
function fixed(o, i, { sl, tp, hold }) {
  const e = o[i].close, S = e * (1 - sl), T = e * (1 + tp)
  for (let k = i + 1; k <= i + hold; k++) {
    const c = o[k]; if (!c) return null
    if (c.low <= S) return Math.min(c.open, S) / e - 1 - ROUND_TRIP_COST
    if (c.high >= T) return Math.max(c.open, T) / e - 1 - ROUND_TRIP_COST
    if (k === i + hold) return c.close / e - 1 - ROUND_TRIP_COST
  }
  return null
}
function trailing(o, i, { pct, atrK, hold }) {
  const e = o[i].close
  const dist = atrK ? atrK * atr14(o, i) : null
  if (atrK && !(dist > 0)) return null
  let peak = e
  for (let k = i + 1; k <= i + hold; k++) {
    const c = o[k]; if (!c) return null
    const stop = atrK ? peak - dist : peak * (1 - pct)
    if (c.low <= stop) return Math.min(c.open, stop) / e - 1 - ROUND_TRIP_COST
    peak = Math.max(peak, c.high)
    if (k === i + hold) return c.close / e - 1 - ROUND_TRIP_COST
  }
  return null
}
const V = { '현행 고정 SL12/TP12/7일': (o, i) => fixed(o, i, { sl: 0.12, tp: 0.12, hold: 7 }) }
for (const pct of [0.08, 0.12, 0.16, 0.2]) for (const hold of [7, 14]) V[`트레일링 고점−${pct * 100}% · 최대 ${hold}일`] = (o, i) => trailing(o, i, { pct, hold })
for (const atrK of [2, 3, 4]) for (const hold of [7, 14]) V[`트레일링 고점−${atrK}ATR · 최대 ${hold}일`] = (o, i) => trailing(o, i, { atrK, hold })

const res = {}
for (const [name, f] of Object.entries(V)) res[name] = picks.map((p) => ({ ...p, r: f(C[p.m], p.i) }))
const base = res['현행 고정 SL12/TP12/7일']
const halves = [['전반', (d) => d < MID], ['후반', (d) => d >= MID]]
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] }
console.log(`메인 픽 ${picks.length}건 · 비용 ${ROUND_TRIP_COST * 100}% · 분할 ${new Date(MID * 864e5).toISOString().slice(0, 10)}`)
console.log('형식: 평균(일군집 t) / 중앙값 / 승률 / 하위5% | 현행 대비 차이(쌍대, 일군집 t)')
for (const [name, rows] of Object.entries(res)) {
  const parts = halves.map(([lab, h]) => {
    const ok = rows.map((r, j) => ({ r, b: base[j] })).filter(({ r, b }) => h(r.d) && r.r != null && b.r != null)
    const s = clusteredT(ok.map(({ r }) => ({ day: r.d, v: r.r })))
    const dlt = clusteredT(ok.map(({ r, b }) => ({ day: r.d, v: r.r - b.r })))
    const v = ok.map(({ r }) => r.r)
    return `${lab} ${(s.mean * 100).toFixed(2)}%(t${s.t?.toFixed(1)}) / ${(q(v, 0.5) * 100).toFixed(1)} / ${(v.filter((x) => x > 0).length / v.length * 100).toFixed(0)}% / ${(q(v, 0.05) * 100).toFixed(1)}%` +
      (name.startsWith('현행') ? '' : ` | Δ ${(dlt.mean * 100).toFixed(2)}%p(t${dlt.t?.toFixed(1)})`)
  })
  console.log(`${name.padEnd(26)} ${parts.join('   ')}`)
}

// (b) 비중
console.log('\n[비중: 같은 날 픽, 1일 보유 일간 포트폴리오, 비용 차감]')
const days = [...new Set(picks.map((p) => p.d))].sort((a, b) => a - b)
const byDay = new Map(); for (const p of picks) (byDay.get(p.d) || byDay.set(p.d, []).get(p.d)).push(p)
const day1 = (p) => { const o = C[p.m]; return o[p.i + 1] ? W(o[p.i + 1].close / o[p.i].close - 1) : null }
for (const [name, wf] of [['동일가중', () => 1], ['변동성 역비례', (p) => { const v = vol20(C[p.m], p.i); return v > 0 ? 1 / v : null }]]) {
  for (const [lab, h] of halves) {
    const series = days.filter(h).map((d) => {
      const l = byDay.get(d).map((p) => ({ r: day1(p), w: wf(p) })).filter((x) => x.r != null && x.w != null)
      if (!l.length) return 0
      const ws = l.reduce((a, x) => a + x.w, 0)
      return l.reduce((a, x) => a + x.r * x.w, 0) / ws - ROUND_TRIP_COST
    })
    console.log(`  ${name.padEnd(8)} ${lab}: ${fmtPerf(perf(series))}`)
  }
}
