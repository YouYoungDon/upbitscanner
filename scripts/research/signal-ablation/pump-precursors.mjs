// 급등 전조 탐색: 향후 7일 고가 +30%↑(급등) 직전 특징이 급등 확률을 얼마나 높이나(리프트).
// 특징은 신호일까지의 확정봉만 사용. 전반으로 구간을 보고 후반에서 같은 구간이 유지되는지 확인.
import { readFileSync, writeFileSync } from 'node:fs'
import { obs, MID, mean, pct } from './lib.mjs'
const R = new URL('../../../lib/', import.meta.url).href
const { calcOBV, calcBBWidthSeries } = await import(R + 'indicators.mjs')
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const idx = {}
for (const [m, o] of Object.entries(candles)) idx[m] = new Map(o.map((c, i) => [Math.floor(c.time / 86400), i]))
const slope = (a) => { const n = a.length, mx = (n - 1) / 2, my = mean(a); let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (i - mx) * (a[i] - my); den += (i - mx) ** 2 } return num / den }
const rows = []
for (const x of obs) {
  if (x.f7 == null || x.x7 == null) continue
  const o = candles[x.m], i = idx[x.m].get(x.d)
  if (i < 130) continue
  const w = o.slice(i - 129, i + 1), cl = w.map((c) => c.close), hi = w.map((c) => c.high), lo = w.map((c) => c.low), vol = w.map((c) => c.volume)
  const bw = calcBBWidthSeries(cl, 20, 2) // 길이 111
  const bwNow = bw.at(-1), bwHist = bw.slice(-100)
  const bwPct = bwHist.filter((v) => v <= bwNow).length / bwHist.length // 0=역사적 최저 수축
  const h20 = Math.max(...hi.slice(-20)), l20 = Math.min(...lo.slice(-20))
  const obv = calcOBV(cl, vol).slice(-20)
  const obvSlopeN = slope(obv) / (mean(vol.slice(-20)) || 1) // 일평균거래량 대비 OBV 기울기
  const p20 = cl.at(-1) / cl.at(-21) - 1
  rows.push({
    d: x.d, pump: x.f7 >= 0.30, x7: x.x7, tv: x.tv,
    bwPct,
    range20: (h20 - l20) / l20,
    toHigh20: cl.at(-1) / h20 - 1,
    volTrend: mean(vol.slice(-5)) / (mean(vol.slice(-60, -5)) || 1), // 최근 5일 vs 이전 55일
    obvDiv: obvSlopeN - p20 * 10, // OBV 상승인데 가격은 덜 오름(+일수록 매집형)
    obvSlopeN,
    p20, dd120: cl.at(-1) / Math.max(...hi.slice(-120)) - 1,
    p1: x.p1, vr: x.vr, rsi: x.rsi,
  })
}
writeFileSync(new URL('../../../data/research/pump-rows.json', import.meta.url), JSON.stringify(rows))
const base = (rs) => rs.filter((r) => r.pump).length / rs.length
const B1 = base(rows.filter((r) => r.d < MID)), B2 = base(rows.filter((r) => r.d >= MID))
console.log(`관측 ${rows.length}, 급등(7일 고가 +30%) 기준확률 전반 ${pct(B1, 1)}% / 후반 ${pct(B2, 1)}%`)
console.log('특징     5분위(낮음→높음): 급등리프트 전반/후반 [7일 초과수익 전반/후반 %p]')
for (const f of ['bwPct', 'range20', 'toHigh20', 'volTrend', 'obvSlopeN', 'obvDiv', 'p20', 'dd120', 'tv', 'p1', 'vr', 'rsi']) {
  const v = rows.filter((r) => r[f] != null && Number.isFinite(r[f]))
  const first = v.filter((r) => r.d < MID).map((r) => r[f]).sort((a, b) => a - b)
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => first[Math.floor(first.length * q)]) // 전반 분위로 고정
  const q = (val) => cuts.filter((c) => val > c).length
  const cells = []
  for (let j = 0; j < 5; j++) {
    const s = v.filter((r) => q(r[f]) === j), s1 = s.filter((r) => r.d < MID), s2 = s.filter((r) => r.d >= MID)
    cells.push(`${(base(s1) / B1).toFixed(2)}/${(base(s2) / B2).toFixed(2)} [${pct(mean(s1.map((r) => r.x7)), 1)}/${pct(mean(s2.map((r) => r.x7)), 1)}]`)
  }
  console.log(f.padEnd(9), cells.join('  '))
}
