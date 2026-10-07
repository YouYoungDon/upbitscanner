// 과거 일봉 재생: 라이브와 동일하게 "확정봉 200개 창"으로 신호를 판정하고 선행수익률을 붙인다.
import { readFileSync, writeFileSync } from 'node:fs'
const R = new URL('../../../lib/', import.meta.url).href
const { detectSignals, detectPatterns, keyOf, PATTERN_SCORE } = await import(R + 'signals.mjs')
const { detectLiquiditySweep, detectVBottom } = await import(R + 'smc-signals.mjs')
const { btcRegime } = await import(R + 'regime.mjs')
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const DAY = 86400
const btc = candles['KRW-BTC']
const regimeByDay = new Map()
for (let i = 60; i < btc.length; i++) regimeByDay.set(Math.floor(btc[i].time / DAY), btcRegime(btc.slice(Math.max(0, i - 199), i + 1)).trend)
const out = []
let n = 0
for (const [m, o] of Object.entries(candles)) {
  for (let i = 60; i < o.length - 1; i++) {
    const tv = o[i].tradeValue
    if (!(tv >= 1e8)) continue // 라이브 스캔 하한(24h 1억)
    const w = o.slice(Math.max(0, i - 199), i + 1)
    const sig = detectSignals(w, {}) // 가중치 1 = 기본점수(base)
    const pat = detectPatterns(w)
    const sw = detectLiquiditySweep(w), vb = detectVBottom(w), pu = null
    const c0 = o[i].close
    const fwd = (h) => (i + h < o.length ? o[i + h].close / c0 - 1 : null)
    const mfe = (h) => { if (i + h >= o.length) return null; let hi = -Infinity; for (let k = i + 1; k <= i + h; k++) hi = Math.max(hi, o[k].high); return hi / c0 - 1 }
    const mae = (h) => { if (i + h >= o.length) return null; let lo = Infinity; for (let k = i + 1; k <= i + h; k++) lo = Math.min(lo, o[k].low); return lo / c0 - 1 }
    const d = Math.floor(o[i].time / DAY)
    out.push({
      m, d, tv, reg: regimeByDay.get(d) ?? 'neutral', vr: sig.volRatio,
      b: sig.buyItems.map((x) => [keyOf(x.label) ?? x.label, x.base, x.label]),
      s: sig.sellItems.map((x) => [keyOf(x.label) ?? x.label, x.base]),
      sl: sig.sell.filter((x) => x.startsWith('[')),
      pb: pat.buy, ps: pat.sell,
      sw: sw.side ? [sw.side, sw.score] : null, vb: vb ? vb.score : null, pu: pu ? pu.score : null,
      r1: fwd(1), r3: fwd(3), r7: fwd(7), f3: mfe(3), a3: mae(3), f7: mfe(7), a7: mae(7),
    })
    if (++n % 20000 === 0) console.log(n)
  }
}
writeFileSync(new URL('../../../data/research/obs.json', import.meta.url), JSON.stringify(out))
console.log('obs', out.length, 'days', new Set(out.map((x) => x.d)).size)
