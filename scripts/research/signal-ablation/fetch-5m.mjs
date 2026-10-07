// 5분봉 과거 수집(재개 가능): data/research/m5/<market>.json = [[t,o,h,l,c,value],...] 오름차순.
// 대상: 최근 60일 일 거래대금 중앙값 ≥ 5억(죽은 코인 제외). DAYS일치.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
const DAYS = Number(process.argv[2] || 60)
const dir = new URL('../../../data/research/m5/', import.meta.url)
mkdirSync(dir, { recursive: true })
const daily = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const markets = Object.entries(daily).filter(([, o]) => {
  const t = o.slice(-60).map((x) => x.tradeValue).sort((a, b) => a - b)
  return o.length >= 60 && t[Math.floor(t.length / 2)] >= 5e8
}).map(([m]) => m)
if (!markets.includes('KRW-BTC')) markets.unshift('KRW-BTC')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function get(url) {
  for (let a = 0; a < 5; a++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (r.ok) return await r.json(); if (r.status !== 429 && r.status < 500) return null } catch {}
    await sleep(500 * (a + 1))
  }
  return null
}
const startMs = Date.now() - DAYS * 86400000
let k = 0
for (const m of markets) {
  k++
  const f = new URL(`${m}.json`, dir)
  if (existsSync(f)) continue
  const rows = []
  let to = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  for (;;) {
    const c = await get(`https://api.upbit.com/v1/candles/minutes/5?market=${m}&count=200&to=${encodeURIComponent(to)}`)
    await sleep(115)
    if (!c || !c.length) break
    for (const x of c) rows.push([Date.parse(x.candle_date_time_utc + 'Z') / 1000, x.opening_price, x.high_price, x.low_price, x.trade_price, x.candle_acc_trade_price])
    const oldest = Date.parse(c.at(-1).candle_date_time_utc + 'Z')
    if (oldest < startMs || c.length < 200) break
    to = c.at(-1).candle_date_time_utc + 'Z'
  }
  const seen = new Set()
  const uniq = rows.filter((r) => !seen.has(r[0]) && seen.add(r[0])).sort((a, b) => a[0] - b[0])
  writeFileSync(f, JSON.stringify(uniq))
  if (k % 10 === 0) console.log(new Date().toISOString().slice(11, 19), k, '/', markets.length, m, uniq.length)
}
console.log('done', markets.length)
