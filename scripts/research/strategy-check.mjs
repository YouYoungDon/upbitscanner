// 조용한 바닥 전략 시장 대비 검증 (2026-10-08 퀀트 QA).
// data/research/candles.json(signal-ablation/fetch.mjs로 수집)에서 현행 strategy-config로 거래를 재생하고,
// ① 비용(ROUND_TRIP_COST) 차감 원수익 ② 같은 진입일에 전 종목을 같은 SL/TP/보유 규칙으로 산 평균 대비
// 초과수익을 진입일 군집 t로 낸다. ③ "시장 급락일 타이밍" 해석: 신호가 K개 이상 뜬 날의 시장 선행수익 vs 나머지 날.
// 전/후반 분할. 한계: 현재 상장 코인만 있다(생존 편향 — 바닥 매수 전략에 유리하게 작용).
// 실행: node scripts/research/strategy-check.mjs
import { readFileSync } from 'node:fs'
import { quietBottomSeries, simulateTrade } from '../../lib/strategy.mjs'
import { ROUND_TRIP_COST } from '../../lib/costs.mjs'
import { clusteredT } from '../../lib/perf-metrics.mjs'

const C = JSON.parse(readFileSync(new URL('../../data/research/candles.json', import.meta.url), 'utf8'))
const cfg = JSON.parse(readFileSync(new URL('../../data/strategy-config.json', import.meta.url), 'utf8'))
const DAY = 86400
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
const dayOf = (c) => Math.floor(c.time / DAY)
const idx = Object.fromEntries(Object.entries(C).map(([m, h]) => [m, new Map(h.map((c, i) => [dayOf(c), i]))]))
const days = [...new Set(Object.values(C).flat().map(dayOf))].sort((a, b) => a - b)
const MID = days[Math.floor(days.length / 2)]
const iso = (d) => new Date(d * DAY * 1000).toISOString().slice(0, 10)
const det = { rsiMax: cfg.rsiMax, stochMax: cfg.stochMax, volMax: cfg.volMax }
const exit = { slPct: cfg.slPct, tpPct: cfg.tpPct, holdMax: cfg.holdMax }

// 거래 재생 + 신호일 집계
const trades = [], sigCount = new Map()
for (const h of Object.values(C)) {
  if (h.length < 80) continue
  const sig = quietBottomSeries(h, det)
  sig.forEach((s, i) => { if (s) sigCount.set(dayOf(h[i]), (sigCount.get(dayOf(h[i])) ?? 0) + 1) })
  let i = 0
  while (i < h.length - 1) {
    if (sig[i]) {
      const t = simulateTrade(h, i, exit)
      if (t) { trades.push({ day: dayOf(h[i + 1]), ret: t.ret, reason: t.reason }); i = t.exitIdx + 1; continue }
    }
    i++
  }
}
// 진입일 기준선: 그날 전 종목을 같은 규칙으로 샀을 때 평균
const baseCache = new Map()
const baseline = (d) => {
  if (!baseCache.has(d)) {
    const r = []
    for (const [m, h] of Object.entries(C)) { const i = idx[m].get(d); if (i > 0) { const t = simulateTrade(h, i - 1, exit); if (t) r.push(t.ret) } }
    baseCache.set(d, r.length ? r.reduce((a, b) => a + b, 0) / r.length : null)
  }
  return baseCache.get(d)
}
const pct = (v, k = 2) => (v == null ? '—' : `${(v * 100).toFixed(k)}`)
console.log(`기간 ${iso(days[0])}~${iso(days.at(-1))} · 비용 ${ROUND_TRIP_COST * 100}% · 설정`, JSON.stringify({ ...det, ...exit }))
for (const [lab, p] of [['전체', () => true], ['전반', (d) => d < MID], ['후반', (d) => d >= MID]]) {
  const tr = trades.filter((t) => p(t.day))
  if (!tr.length) { console.log(lab, 'n=0'); continue }
  const net = clusteredT(tr.map((t) => ({ day: t.day, v: t.ret - ROUND_TRIP_COST })))
  const ex = clusteredT(tr.map((t) => ({ day: t.day, v: baseline(t.day) == null ? NaN : t.ret - baseline(t.day) })))
  const win = tr.filter((t) => t.ret > ROUND_TRIP_COST).length / tr.length
  console.log(`${lab}: n=${tr.length} 진입일 ${net.days} | 비용후 평균(일군집) ${pct(net.mean)}% t=${net.t?.toFixed(2)} 승률 ${pct(win, 0)}% | 시장 대비 ${pct(ex.mean)}%p t=${ex.t?.toFixed(2)}`)
}
// 시장 타이밍 해석: 신호 K개 이상 날의 동일가중 시장 선행수익 vs 나머지 날 (Welch t)
const fwd = (m, d, h) => { const o = C[m], i = idx[m].get(d); return i != null && i + h < o.length ? o[i + h].close / o[i].close - 1 : null }
const mkt = (d, h) => { const v = Object.keys(C).map((m) => fwd(m, d, h)).filter((x) => x != null).map(W); return v.length > 50 ? v.reduce((a, b) => a + b, 0) / v.length : null }
const welch = (a, b) => {
  const m = (x) => x.reduce((s, v) => s + v, 0) / x.length
  const v = (x, mu) => x.reduce((s, y) => s + (y - mu) ** 2, 0) / (x.length - 1)
  const ma = m(a), mb = m(b)
  return { ma, mb, t: (ma - mb) / Math.sqrt(v(a, ma) / a.length + v(b, mb) / b.length) }
}
for (const K of [1, 5]) for (const [lab, p] of [['전반', (d) => d < MID], ['후반', (d) => d >= MID]]) {
  const cells = [1, 3, 7].map((h) => {
    const sig = [], non = []
    for (const d of days.slice(60).filter(p)) { const r = mkt(d, h); if (r != null) ((sigCount.get(d) ?? 0) >= K ? sig : non).push(r) }
    if (sig.length < 2 || non.length < 2) return `${h}일 —`
    const w = welch(sig, non)
    return `${h}일 ${pct(w.ma)}% vs ${pct(w.mb)}% t=${w.t.toFixed(2)}`
  })
  console.log(`타이밍 K≥${K} ${lab}: ${cells.join(' | ')}`)
}
