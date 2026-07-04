import { calcBBWidthSeries } from '../../indicators.mjs'
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
export default {
  name: 'vol_expansion_on_breakout', defaultGroup: 'confirm', normalizer: 'vsOwnHistory',
  compute(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    const bw = calcBBWidthSeries(closes, 20, 2); if (bw.length < 20 || closes.length < 6) return null
    const up = closes.at(-1) > closes.at(-6)
    return up ? +(bw.at(-1) / mean(bw.slice(-20))).toFixed(3) : 0
  },
  history(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    const bw = calcBBWidthSeries(closes, 20, 2); const out = []
    for (let i = bw.length - 1; i >= 19 && out.length < 30; i--) out.push(bw[i] / mean(bw.slice(i - 19, i + 1)))
    return out
  },
}
