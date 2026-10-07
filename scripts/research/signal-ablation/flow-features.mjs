// C2(유니버스10억·게이트5천만·5분연속) 경보의 시점 특징 → 24h 급등(+20%)/급락(−15%)·초과수익.
// 특징 분위는 전반 30일로 고정, 후반 30일에서 같은 방향이 유지되는지 확인.
import { readFileSync, readdirSync } from 'node:fs'
const R = new URL('../../../lib/', import.meta.url).href
const M = await import(R + 'moneyflow.mjs')
const dir = new URL('../../../data/research/m5/', import.meta.url)
const series = {}
for (const f of readdirSync(dir)) { const r = JSON.parse(readFileSync(new URL(f, dir))); if (r.length > 864) series[f.replace('.json', '')] = r }
const btc = series['KRW-BTC'], btcIdx = new Map(btc.map((r, i) => [r[0], i]))
function fwd(rows, i, sec) { const tg = rows[i][0] + 300 + sec; let lo = i, hi = rows.length - 1; if (rows[hi][0] < tg) return null; while (lo < hi) { const md = (lo + hi) >> 1; if (rows[md][0] < tg) lo = md + 1; else hi = md } return rows[lo][4] / rows[i][4] - 1 }
function ext(rows, i, sec) { const end = rows[i][0] + 300 + sec; if (rows.at(-1)[0] < end) return null; let mx = -Infinity, mn = Infinity; for (let k = i + 1; k < rows.length && rows[k][0] <= end; k++) { mx = Math.max(mx, rows[k][2]); mn = Math.min(mn, rows[k][3]) } return { up: mx / rows[i][4] - 1, dn: mn / rows[i][4] - 1 } }
// 정시 전 종목 평균 24h 수익(초과수익 기준)
const grid = new Map()
for (const rows of Object.values(series)) for (let i = 0; i < rows.length; i++) { if ((rows[i][0] + 300) % 3600) continue; const v = fwd(rows, i, 86400); if (v == null) continue; const g = grid.get(rows[i][0]) || [0, 0]; g[0] += Math.max(-0.5, Math.min(0.5, v)); g[1]++; grid.set(rows[i][0], g) }
const base24 = (t) => { const g = grid.get(t - ((t + 300) % 3600)); return g ? g[0] / g[1] : 0 }
const recs = []
for (const [m, rows] of Object.entries(series)) {
  if (m === 'KRW-BTC') continue
  const vals = rows.map((r) => r[5]), cls = rows.map((r) => r[4])
  let tv = 0, j0 = 0, last = -Infinity
  for (let i = 0; i < rows.length; i++) {
    tv += vals[i]; while (rows[j0][0] <= rows[i][0] - 86400) { tv -= vals[j0]; j0++ }
    if (i < 80 || rows[i][0] - rows[0][0] < 86400 || tv < 1e9 || vals[i] < 5e7) continue
    if (rows[i][0] - last < 6 * 3600) continue // 라이브 억제창과 동일: 같은 종목 6h 1건
    const o5 = rows.slice(i - 79, i + 1).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], tradeValue: r[5] }))
    const v5 = o5.map((c) => c.tradeValue), c5 = o5.map((c) => c.close)
    const ratio = M.moneyRatio(v5); if (ratio == null || ratio < 2) continue
    const ch5 = M.pctChange(c5, 1), ch15 = M.pctChange(c5, 3); if (M.isPumped(ch5, ch15)) continue
    const bi = btcIdx.get(rows[i][0]); const btcRet = bi > 0 ? (btc[bi][4] / btc[bi - 1][4] - 1) * 100 : 0
    const breakout = M.breakout20(o5)
    const level = M.alertLevel({ ratio, breakout, btcFavorable: btcRet > 0 })
    if (level !== 'strong' && level !== 'attention') continue
    const ex = ext(rows, i, 86400), f24 = fwd(rows, i, 86400)
    if (!ex || f24 == null) continue
    last = rows[i][0]
    let streak = 0; for (let k = 1; k <= 6; k++) { const r = M.moneyRatio(v5.slice(0, v5.length - k)); if (r != null && r >= 1.5) streak++ }
    const hi24 = Math.max(...rows.slice(j0, i + 1).map((r) => r[2]))
    const body = (o5.at(-1).close - o5.at(-1).open) / o5.at(-1).open
    const wick = (o5.at(-1).high - o5.at(-1).close) / o5.at(-1).close
    recs.push({
      t: rows[i][0], up: ex.up >= 0.2, dn: ex.dn <= -0.15, x24: Math.max(-0.5, Math.min(0.5, f24)) - base24(rows[i][0]),
      ratio, accel: M.moneyAcceleration(v5) ?? 1, v5m: v5.at(-1), tv24: tv, share5m: v5.at(-1) / tv, prior24: cls[i] / cls[j0] - 1,
      ch5, ch15, ch30: M.pctChange(c5, 6), toHi24: cls[i] / hi24 - 1, streak, body, wick, btcRet, hourKST: (new Date(rows[i][0] * 1000).getUTCHours() + 9) % 24,
      prior4h: cls[i] / cls[Math.max(0, i - 48)] - 1,
    })
  }
}
const ts = recs.map((r) => r.t).sort((a, b) => a - b), MID = ts[Math.floor(ts.length / 2)]
const H = [recs.filter((r) => r.t < MID), recs.filter((r) => r.t >= MID)]
const rate = (a, k) => a.filter((r) => r[k]).length / a.length
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
const B = H.map((h) => ({ up: rate(h, 'up'), dn: rate(h, 'dn'), x: mean(h.map((r) => r.x24)) }))
console.log(`C2 경보(6h 중복제거) ${recs.length}건. 기준 급등 ${(B[0].up * 100).toFixed(1)}/${(B[1].up * 100).toFixed(1)}% 급락 ${(B[0].dn * 100).toFixed(1)}/${(B[1].dn * 100).toFixed(1)}% 24h초과 ${(B[0].x * 100).toFixed(2)}/${(B[1].x * 100).toFixed(2)}%p (전반/후반)`)
console.log('특징 5분위(전반 컷): 각 칸 = 급등×/급락× [24h초과%p] 전반 | 후반')
for (const f of ['ratio', 'accel', 'v5m', 'tv24', 'share5m', 'prior24', 'prior4h', 'ch30', 'toHi24', 'streak', 'body', 'wick', 'btcRet', 'hourKST']) {
  const sorted = H[0].map((r) => r[f]).filter(Number.isFinite).sort((a, b) => a - b)
  const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => sorted[Math.floor(sorted.length * q)])
  const q = (v) => cuts.filter((c) => v > c).length
  const cells = []
  for (let j = 0; j < 5; j++) {
    cells.push(H.map((h, k) => { const s = h.filter((r) => Number.isFinite(r[f]) && q(r[f]) === j); return s.length < 20 ? '  (n<20)  ' : `${(rate(s, 'up') / B[k].up).toFixed(1)}/${(rate(s, 'dn') / B[k].dn).toFixed(1)}[${(mean(s.map((r) => r.x24)) * 100).toFixed(1)}]` }).join('|'))
  }
  console.log(f.padEnd(8), cells.join('  '))
}
