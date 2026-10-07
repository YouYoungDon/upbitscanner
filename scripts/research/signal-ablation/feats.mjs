// obs에 연속 특성 추가: p1(당일 등락), p5, p20, rsi, k(stoch), e20(EMA20 괴리), vr(이미 있음)
import { readFileSync, writeFileSync } from 'node:fs'
const R = new URL('../../../lib/', import.meta.url).href
const { calcRSI, calcStochastic, calcEMA } = await import(R + 'indicators.mjs')
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const obs = JSON.parse(readFileSync(new URL('../../../data/research/obs.json', import.meta.url)))
const idx = {}
for (const [m, o] of Object.entries(candles)) { idx[m] = new Map(o.map((c, i) => [Math.floor(c.time / 86400), i])) }
for (const x of obs) {
  const o = candles[x.m], i = idx[x.m].get(x.d)
  const w = o.slice(Math.max(0, i - 199), i + 1), cl = w.map((c) => c.close)
  x.p1 = cl.at(-1) / cl.at(-2) - 1
  x.p5 = cl.at(-1) / cl.at(-6) - 1
  x.p20 = cl.length > 20 ? cl.at(-1) / cl.at(-21) - 1 : null
  x.rsi = calcRSI(cl)
  x.k = calcStochastic(w.map((c) => c.high), w.map((c) => c.low), cl)?.k ?? null
  x.e20 = cl.at(-1) / calcEMA(cl, 20).at(-1) - 1
  x.hl = (w.at(-1).high - w.at(-1).close) / w.at(-1).close // 윗꼬리(종가 대비)
}
writeFileSync(new URL('../../../data/research/obs.json', import.meta.url), JSON.stringify(obs))
console.log('done', obs.length)
