import { writeFileSync } from 'node:fs'
import { getMarkets, getDayCandlesBefore, candlesToOhlcv } from '../../../lib/upbit.mjs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const markets = (await getMarkets()).map((m) => m.market)
const out = {}
let i = 0
for (const m of markets) {
  let to = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const all = []
  for (let p = 0; p < 3; p++) {
    const c = await getDayCandlesBefore(m, to, 200)
    await sleep(130)
    if (!c || !c.length) break
    all.push(...c)
    if (c.length < 200) break
    to = c.at(-1).candle_date_time_utc + 'Z'
  }
  const seen = new Set()
  const uniq = all.filter((c) => !seen.has(c.candle_date_time_utc) && seen.add(c.candle_date_time_utc))
  out[m] = candlesToOhlcv(uniq.sort((a, b) => b.candle_date_time_utc.localeCompare(a.candle_date_time_utc)))
  if (++i % 40 === 0) console.log(i, '/', markets.length)
}
writeFileSync(new URL('../../../data/research/candles.json', import.meta.url), JSON.stringify(out))
console.log('markets', Object.keys(out).length, 'bars', Object.values(out).reduce((a, b) => a + b.length, 0))
