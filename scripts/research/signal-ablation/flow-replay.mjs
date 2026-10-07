// 자금유입(flow-scan) 재생: 5분봉 과거 데이터로 라이브 판정 로직을 다시 돌려
// 경보 뒤 수익·급등/급락 확률·"이미 오른 정도"를 측정한다. 설정(유니버스·게이트·주기)별 비교.
// 한계: 1분봉이 없어 조기존(+5점)은 항상 false — 경보 레벨(alertLevel)에는 영향 없음.
//       코인게코 비중·거래소이벤트 방어는 재생 불가(제외).
import { readFileSync, readdirSync } from 'node:fs'
const R = new URL('../../../lib/', import.meta.url).href
const M = await import(R + 'moneyflow.mjs')
const dir = new URL('../../../data/research/m5/', import.meta.url)

const DAY_BARS = 288
const series = {}
for (const f of readdirSync(dir)) {
  const rows = JSON.parse(readFileSync(new URL(f, dir)))
  if (rows.length > DAY_BARS * 3) series[f.replace('.json', '')] = rows
}
const btc = series['KRW-BTC'] || [] // 없으면(수집 중) BTC 컨텍스트 중립
const btcIdx = new Map(btc.map((r, i) => [r[0], i]))

// 시각별 전 종목 평균 선행수익(초과수익 기준선): t → {h1,h4,h24 합/개수}
const H = { h1: 3600, h4: 4 * 3600, h24: 86400 }
function fwdAt(rows, i, sec) {
  const target = rows[i][0] + 300 + sec // 봉 종료 시각 + 보유기간
  let lo = i, hi = rows.length - 1
  if (rows[hi][0] < target) return null
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] < target) lo = mid + 1; else hi = mid }
  return rows[lo][4] / rows[i][4] - 1
}
function extremes(rows, i, sec) { // 다음 sec 동안 최고·최저(종가 대비)
  const end = rows[i][0] + 300 + sec
  if (rows.at(-1)[0] < end) return null
  let mx = -Infinity, mn = Infinity
  for (let k = i + 1; k < rows.length && rows[k][0] <= end; k++) { mx = Math.max(mx, rows[k][2]); mn = Math.min(mn, rows[k][3]) }
  return { up: mx / rows[i][4] - 1, dn: mn / rows[i][4] - 1 }
}
// 기준선: 1시간 격자(정시)마다 전 종목 선행수익 평균
const gridMean = new Map()
for (const rows of Object.values(series)) {
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] + 300) % 3600 !== 0) continue
    const g = gridMean.get(rows[i][0]) || { h1: [0, 0], h4: [0, 0], h24: [0, 0] }
    for (const [k, s] of Object.entries(H)) { const v = fwdAt(rows, i, s); if (v != null) { g[k][0] += Math.max(-0.5, Math.min(0.5, v)); g[k][1]++ } }
    gridMean.set(rows[i][0], g)
  }
}
const baseAt = (t, k) => { const g = gridMean.get(t - ((t + 300) % 3600)); return g && g[k][1] ? g[k][0] / g[k][1] : 0 }

// 설정
const KST_SCAN_UTC_HOURS = new Set([15, 18, 21, 0, 3, 6, 9, 12]) // KST 00·03·…·21시
const CONFIGS = {
  'C0 현행(100억·5억게이트·3시간)': { tv24: 1e10, gate: 5e8, every3h: true },
  'C1 현행로직·5분연속': { tv24: 1e10, gate: 5e8, every3h: false },
  'C2 유니버스10억·게이트5천만·연속': { tv24: 1e9, gate: 5e7, every3h: false },
  'C3 C2 + 24h상승<5%만': { tv24: 1e9, gate: 5e7, every3h: false, maxPrior24: 0.05 },
}

const out = Object.fromEntries(Object.keys(CONFIGS).map((k) => [k, []]))
const baseline = [] // 모든 평가 가능한 정시 봉(C2 유니버스) — 급등/급락 기준확률
for (const [m, rows] of Object.entries(series)) {
  if (m === 'KRW-BTC') continue
  const values = rows.map((r) => r[5]), closes = rows.map((r) => r[4])
  let tvSum = 0, j0 = 0
  for (let i = 0; i < rows.length; i++) {
    tvSum += values[i]
    while (rows[j0][0] <= rows[i][0] - 86400) { tvSum -= values[j0]; j0++ }
    if (i < 80 || rows[i][0] - rows[0][0] < 86400) continue
    const t = rows[i][0]
    const isScanSlot = (t + 300) % 10800 === 0 && KST_SCAN_UTC_HOURS.has(new Date((t + 300) * 1000).getUTCHours())
    const onHour = (t + 300) % 3600 === 0
    const prior24 = closes[i] / closes[j0] - 1
    if (onHour && tvSum >= 1e9) {
      const ex = extremes(rows, i, 86400)
      if (ex) baseline.push({ up: ex.up, dn: ex.dn, prior24 })
    }
    // 라이브 판정(최근 81봉 창 = 완성봉 80개)
    const o5 = rows.slice(Math.max(0, i - 79), i + 1).map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], tradeValue: r[5] }))
    const vals = o5.map((c) => c.tradeValue), cl5 = o5.map((c) => c.close)
    const ch5m = M.pctChange(cl5, 1), ch15m = M.pctChange(cl5, 3)
    const ratio = M.moneyRatio(vals)
    if (ratio == null || ratio < 2) continue // alertLevel null — 빠른 탈출
    if (M.isPumped(ch5m, ch15m)) continue
    const bi = btcIdx.get(t)
    const btcRet = bi != null && bi > 0 ? (btc[bi][4] / btc[bi - 1][4] - 1) * 100 : null
    const btcFavorable = btcRet != null && btcRet > 0, btcBad = btcRet != null && btcRet < M.CONFIG.btcDropPct
    const breakout = M.breakout20(o5)
    const level = M.alertLevel({ ratio, breakout, btcFavorable })
    if (level !== 'strong' && level !== 'attention') continue // 텔레그램 경보 대상만
    let high24 = -Infinity; for (let k = j0; k <= i; k++) high24 = Math.max(high24, rows[k][2])
    const { score } = M.scoreFlow({
      ratio, accel: M.moneyAcceleration(vals), value5m: vals.at(-1), breakout,
      near24h: M.near24hHigh(cl5.at(-1), high24), emaOK: M.emaAligned(cl5), rsiOK: M.rsiOk(cl5), early: false, btcFavorable, btcBad,
    })
    let rec = null
    for (const [name, c] of Object.entries(CONFIGS)) {
      if (tvSum < c.tv24 || vals.at(-1) < c.gate) continue
      if (c.every3h && !isScanSlot) continue
      if (c.maxPrior24 != null && prior24 >= c.maxPrior24) continue
      if (!rec) {
        const ex = extremes(rows, i, 86400)
        rec = { m, t, level, score, prior24, tv24: tvSum, ex, px: closes[i] }
        for (const [k, s] of Object.entries(H)) { const v = fwdAt(rows, i, s); rec[k] = v == null ? null : Math.max(-0.5, Math.min(0.5, v)) - baseAt(t, k) }
      }
      out[name].push(rec)
    }
  }
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const pct = (v, d = 2) => (v * 100).toFixed(d)
// 같은 종목 6시간 내 재경보는 1건으로(라이브 억제창과 동일) — 독립 사건 수
function dedup(list) {
  const last = {}, res = []
  for (const r of [...list].sort((a, b) => a.t - b.t)) { if (last[r.m] != null && r.t - last[r.m] < 6 * 3600) continue; last[r.m] = r.t; res.push(r) }
  return res
}
const any = Object.values(series)[0]
const days = (any.at(-1)[0] - any[0][0]) / 86400
const bUp = baseline.filter((b) => b.up >= 0.2).length / baseline.length, bDn = baseline.filter((b) => b.dn <= -0.15).length / baseline.length
console.log(`종목 ${Object.keys(series).length - 1}, 기간 ${days.toFixed(0)}일. 기준(정시·24h≥10억): 24h내 +20% ${pct(bUp, 1)}% / −15% ${pct(bDn, 1)}%`)
for (const [name, list0] of Object.entries(out)) {
  const list = dedup(list0)
  const f = (k) => list.map((r) => r[k]).filter((v) => v != null)
  const ex = list.filter((r) => r.ex)
  const up = ex.filter((r) => r.ex.up >= 0.2).length / ex.length, dn = ex.filter((r) => r.ex.dn <= -0.15).length / ex.length
  console.log(`\n${name}: 경보 ${list.length}건 (${(list.length / days).toFixed(1)}/일)`)
  console.log(`  초과수익 1h ${pct(mean(f('h1')))} / 4h ${pct(mean(f('h4')))} / 24h ${pct(mean(f('h24')))}%p   (24h 중앙 ${pct(med(f('h24')))})`)
  console.log(`  24h 내 +20% 급등 ${pct(up, 1)}% (×${(up / bUp).toFixed(1)}) / −15% 급락 ${pct(dn, 1)}% (×${(dn / bDn).toFixed(1)})`)
  console.log(`  경보 시점 이미 24h 상승: 중앙 ${pct(med(list.map((r) => r.prior24)), 1)}%, +20%↑ 이미 오른 경보 비율 ${pct(list.filter((r) => r.prior24 >= 0.2).length / list.length, 0)}%`)
}

// ── 급등 이벤트 재현율: '아직 안 오른(24h<+5%)' 시점에서 24h 내 고가 +25% → 이상적 진입점.
// 이벤트 후 24h 안에 경보가 떴는지, 떴다면 이벤트가 대비 +10% 이내(일찍)인지 그 이상(늦게)인지.
const events = []
for (const [m, rows] of Object.entries(series)) {
  if (m === 'KRW-BTC') continue
  let j0 = 0, lastEv = -Infinity
  for (let i = 0; i < rows.length; i++) {
    while (rows[j0][0] <= rows[i][0] - 86400) j0++
    if (rows[i][0] - rows[0][0] < 86400 || rows[i][0] - lastEv < 86400) continue
    if (rows[i][4] / rows[j0][4] - 1 >= 0.05) continue
    const ex = extremes(rows, i, 86400)
    if (ex && ex.up >= 0.25) { events.push({ m, t: rows[i][0], px: rows[i][4] }); lastEv = rows[i][0] }
  }
}
console.log(`\n급등 이벤트(24h<+5% 상태에서 24h 내 고가 +25%): ${events.length}건`)
for (const [name, list] of Object.entries(out)) {
  const by = {}; for (const r of list) (by[r.m] ||= []).push(r)
  let early = 0, late = 0
  for (const e of events) {
    const hits = (by[e.m] || []).filter((r) => r.t >= e.t - 3600 && r.t <= e.t + 86400)
    if (!hits.length) continue
    if (hits.some((r) => r.px <= e.px * 1.10)) early++; else late++
  }
  console.log(`  ${name.padEnd(30)} 일찍 잡음 ${early} (${pct(early / events.length, 0)}%) · 늦게 잡음 ${late} (${pct(late / events.length, 0)}%) · 놓침 ${events.length - early - late}`)
}
