// 뉴스·공지 → 가격 효과: data/news-log.jsonl(news-watch 누적)의 코인 매칭 항목마다, 처음 본 시각의
// 다음 확정 일봉부터 1/3/7일 초과수익(같은 날 전 종목 평균 대비)을 잰다. 그룹: kind·type·태그·중요.
// 일봉은 실행할 때 업비트에서 받는다(최근 200일). 그룹당 20건 미만은 결론을 내지 않는다.
// 실행: node scripts/research/news/news-tag-effect.mjs
import { readFileSync } from 'node:fs'
import { getMarkets, getDayCandles, candlesToOhlcv } from '../../../lib/upbit.mjs'

const DAY = 86400
const MIN_N = 20
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const W = (v) => Math.max(-0.5, Math.min(0.5, v))

const log = readFileSync(new URL('../../../data/news-log.jsonl', import.meta.url), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
// 첫 실행 백로그(공지 시각이 처음 본 시각보다 하루 넘게 앞섬)는 제외 — 처음 본 날 진입이 실제 반응 시점이 아니다.
const isBacklog = (r) => r.ts && Date.parse(r.seenAt) - Date.parse(r.ts) > 86400000
const recs = log.filter((r) => r.markets?.length && r.seenAt && !isBacklog(r))
console.log(`news-log ${log.length}건, 코인 매칭 ${recs.length}건 (${log[0]?.seenAt?.slice(0, 10)} ~ ${log.at(-1)?.seenAt?.slice(0, 10)})`)

// 전 종목 일봉(기준선용) — KRW 마켓 전체
const markets = (await getMarkets()).map((m) => m.market)
const candles = {}
for (const m of markets) {
  const c = await getDayCandles(m, 200)
  if (c) candles[m] = candlesToOhlcv(c).slice(0, -1) // 형성 중인 오늘 봉 제외
  await sleep(120)
}
const idx = Object.fromEntries(Object.entries(candles).map(([m, o]) => [m, new Map(o.map((c, i) => [Math.floor(c.time / DAY), i]))]))
const fwd = (m, d, h) => { const o = candles[m], i = idx[m]?.get(d); return o && i != null && i + h < o.length ? o[i + h].close / o[i].close - 1 : null }
const baseCache = new Map()
const base = (d, h) => {
  const k = `${d}|${h}`
  if (!baseCache.has(k)) {
    const v = Object.keys(candles).map((m) => fwd(m, d, h)).filter((x) => x != null).map(W)
    baseCache.set(k, v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)
  }
  return baseCache.get(k)
}

// 진입 = 처음 본 날(UTC)의 확정 종가 — 뉴스를 본 그날 사는 것과 가장 가까운 일봉 근사
const rows = []
for (const r of recs) {
  const d = Math.floor(Date.parse(r.seenAt) / 1000 / DAY)
  const groups = [`kind:${r.kind}`, ...(r.type ? [`type:${r.type}`] : []), ...(r.tags || []).map((t) => `tag:${t}`), ...(r.important ? ['important'] : [])]
  for (const m of r.markets) {
    const x = {}
    for (const h of [1, 3, 7]) { const v = fwd(m, d, h); x[h] = v == null ? null : W(v) - base(d, h) }
    rows.push({ groups, x })
  }
}
const by = {}
for (const r of rows) for (const g of r.groups) (by[g] ||= []).push(r)
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
console.log('그룹'.padEnd(26), '  n', '  1일', '   3일', '   7일', ' (초과수익 %p, n<20은 판단 보류)')
for (const [g, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  const cell = (h) => { const v = list.map((r) => r.x[h]).filter((z) => z != null); return v.length ? (mean(v) * 100).toFixed(2).padStart(6) : '     —' }
  console.log(g.padEnd(26), String(list.length).padStart(4), cell(1), cell(3), cell(7), list.length < MIN_N ? ' (보류)' : '')
}
