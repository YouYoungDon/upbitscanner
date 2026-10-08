// 매집 신호 측정 (2026-10-08 스파이크): ① 바이낸스 테이커 순매수 ② 코인별 김치 프리미엄(BTC 대비) 변화.
// 대상: 업비트·바이낸스 동시 상장 코인. 목표: 업비트 D 종가 → D+h 종가의 시장 대비 초과수익(전 업비트 종목 평균 차감).
// 판정 4요건: 시장 대비 초과 · 진입일 군집 t(|t|≥2) · 비용 0.3%p 초과 · 전/후반 모두 같은 부호.
// 분위 컷은 전반 데이터로만 정한다(후반은 순수 검증).
// 실행: node scripts/research/accumulation/measure.mjs
import { readFileSync } from 'node:fs'
import { clusteredT } from '../../../lib/perf-metrics.mjs'
import { ROUND_TRIP_COST } from '../../../lib/costs.mjs'

const U = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url), 'utf8'))
const B = JSON.parse(readFileSync(new URL('../../../data/research/binance-1d.json', import.meta.url), 'utf8'))
// 강건성: DELAY=진입 지연일(신호 다음날 종가 진입 등), MINTV=직전 30일 평균 업비트 일거래대금 하한(원)
const DELAY = Number(process.env.DELAY ?? 0), MINTV = Number(process.env.MINTV ?? 0)
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }

// 업비트 일 단위 맵 + 횡단면 기준선
const uMap = {}
const tvMap = {}
for (const [m, o] of Object.entries(U)) { uMap[m] = new Map(o.map((c) => [Math.floor(c.time / 86400), c.close])); tvMap[m] = new Map(o.map((c) => [Math.floor(c.time / 86400), c.tradeValue ?? 0])) }
const allDays = [...new Set(Object.values(uMap).flatMap((mp) => [...mp.keys()]))].sort((a, b) => a - b)
const H = [1, 3, 7]
const fwd = (m, d, h) => { const a = uMap[m].get(d), b = uMap[m].get(d + h); return a && b ? W(b / a - 1) : null }
const base = {}
for (const d of allDays) for (const h of H) {
  const v = Object.keys(uMap).map((m) => fwd(m, d, h)).filter((x) => x != null)
  if (v.length > 50) base[`${d}|${h}`] = mean(v)
}
// 바이낸스 맵 + 동일 자산 검증(업비트/바이낸스 가격비가 BTC의 비율과 ±25% 이내)
const bMap = {}
for (const [m, k] of Object.entries(B)) bMap[m] = new Map(k.map(([d, close, q, tb]) => [d, { close, q, tb }]))
const ratioMed = (m) => median([...uMap[m].keys()].filter((d) => bMap[m].has(d)).map((d) => uMap[m].get(d) / bMap[m].get(d).close))
const btcR = ratioMed('KRW-BTC')
const coins = Object.keys(bMap).filter((m) => m !== 'KRW-BTC' && uMap[m] && Math.abs(ratioMed(m) / btcR - 1) < 0.25)
console.log(`대상 ${coins.length}종목 (가격비 불일치 제외 ${Object.keys(bMap).length - 1 - coins.length})`)

// 특징 계산 (D까지의 확정 데이터만)
const prem = (m, d) => { const u = uMap[m].get(d), b = bMap[m].get(d), ub = uMap['KRW-BTC'].get(d), bb = bMap['KRW-BTC'].get(d); return u && b && ub && bb ? (u / b.close) / (ub / bb.close) - 1 : null }
const rows = []
for (const m of coins) {
  for (const d of [...bMap[m].keys()]) {
    if (!uMap[m].has(d)) continue
    const win = (a, z) => { const r = []; for (let i = a; i <= z; i++) { const x = bMap[m].get(d - i); if (!x || !(x.q > 0)) return null; r.push(x) } return r }
    const w7 = win(0, 6), wBase = win(7, 59), w30 = win(0, 29)
    if (!w7 || !wBase || !w30) continue
    const tbr = (x) => x.tb / x.q
    const f = {}
    f.tbr7 = mean(w7.map(tbr)) - mean(wBase.map(tbr))                                  // 최근 7일 테이커 매수 비율 − 평소
    f.cvd7 = w7.reduce((s, x) => s + (2 * x.tb - x.q), 0) / mean(w30.map((x) => x.q))   // 7일 순매수 / 평균 일거래대금
    const p0 = prem(m, d), p3 = prem(m, d - 3), p7 = prem(m, d - 7)
    const pHist = []; for (let i = 7; i <= 59; i++) { const p = prem(m, d - i); if (p != null) pHist.push(p) }
    if (p0 != null && p3 != null) f.drp3 = p0 - p3                                        // 3일간 코인 프리미엄 상승
    if (p0 != null && p7 != null) f.drp7 = p0 - p7                                        // 7일간
    if (p0 != null && pHist.length > 30) f.rpx = p0 - median(pHist)                        // 평소 대비 프리미엄 초과
    if (p0 != null) f.rpl = p0                                                            // BTC 대비 프리미엄 수준(현행 플래그 기준)
    const u7 = uMap[m].get(d - 7)
    const flat = u7 ? Math.abs(uMap[m].get(d) / u7 - 1) < 0.05 : false                   // 7일 등락 ±5% 이내 = 횡보
    if (MINTV) { let s = 0; for (let i = 0; i < 30; i++) s += tvMap[m].get(d - i) ?? 0; if (s / 30 < MINTV) continue }
    const e = d + DELAY
    const x = {}; for (const h of H) { const v = fwd(m, e, h), b0 = base[`${e}|${h}`]; x[h] = v == null || b0 == null ? null : v - b0 }
    rows.push({ m, d, f, flat, x })
  }
}
const days = [...new Set(rows.map((r) => r.d))].sort((a, b) => a - b)
const MID = days[Math.floor(days.length / 2)]
const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10)
console.log(`진입 지연 ${DELAY}일 · 거래대금 하한 ${MINTV / 1e8}억`)
console.log(`관측 ${rows.length} · 기간 ${iso(days[0])}~${iso(days.at(-1))} · 분할 ${iso(MID)} · 비용 ${ROUND_TRIP_COST * 100}%`)

const q = (k, p) => { const v = rows.filter((r) => r.d < MID && r.f[k] != null).map((r) => r.f[k]).sort((a, b) => a - b); return v[Math.floor(v.length * p)] }
const cell = (sel, h, half) => {
  const rs = sel.filter((r) => (half === '전' ? r.d < MID : r.d >= MID) && r.x[h] != null)
  const s = clusteredT(rs.map((r) => ({ day: r.d, v: r.x[h] })))
  return { ...s, n: rs.length }
}
const fmt = (s) => s.mean == null ? '   —' : `${(s.mean * 100).toFixed(2).padStart(6)}(t${s.t == null ? '—' : s.t.toFixed(1)})`
const verdict = (cells) => {
  // 4요건: 전·후반 같은 부호, 둘 다 |t|≥2, 양(+)이면 초과가 비용 이상
  const [a, b] = cells
  if (a.mean == null || b.mean == null || a.t == null || b.t == null) return '표본부족'
  if (Math.sign(a.mean) !== Math.sign(b.mean)) return '부호엇갈림'
  if (Math.abs(a.t) < 2 || Math.abs(b.t) < 2) return '유의X'
  if (a.mean > 0 && Math.min(a.mean, b.mean) < ROUND_TRIP_COST) return '비용미달'
  return a.mean > 0 ? '✅통과(매수)' : '⛔통과(회피)'
}
const report = (name, sel) => {
  const parts = [], vs = []
  for (const h of H) { const c = ['전', '후'].map((hf) => cell(sel, h, hf)); parts.push(`${h}일 ${fmt(c[0])} ${fmt(c[1])}`); vs.push(`${h}일:${verdict(c)}`) }
  console.log(`${name.padEnd(30)} n=${String(sel.length).padStart(6)} | ${parts.join(' | ')}\n${''.padEnd(30)}   → ${vs.join(' ')}`)
}
console.log('\n형식: 초과수익 %p(일군집 t) 전반 후반')
for (const k of ['tbr7', 'cvd7', 'drp3', 'drp7', 'rpx']) {
  const hi = q(k, 0.8), lo = q(k, 0.2)
  report(`${k} 상위20%`, rows.filter((r) => r.f[k] != null && r.f[k] >= hi))
  report(`${k} 하위20%`, rows.filter((r) => r.f[k] != null && r.f[k] <= lo))
  report(`${k} 상위20% + 횡보(매집형)`, rows.filter((r) => r.f[k] != null && r.f[k] >= hi && r.flat))
}
report('현행 플래그: BTC 대비 +3%↑', rows.filter((r) => r.f.rpl != null && r.f.rpl >= 0.03))
report('현행 플래그: BTC 대비 −3%↓', rows.filter((r) => r.f.rpl != null && r.f.rpl <= -0.03))
report('기준: 횡보 전체', rows.filter((r) => r.flat))
