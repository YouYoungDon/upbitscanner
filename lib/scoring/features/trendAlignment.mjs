import { calcEMA } from '../../indicators.mjs'
export default {
  name: 'trend_alignment', defaultGroup: 'confirm', normalizer: 'fixedCurve',
  params: [[0, 0], [1, 40], [2, 70], [3, 100]],
  compute(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []; if (closes.length < 60) return null
    const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50)
    const e20 = ema20.at(-1), e50 = ema50.at(-1), e20prev = ema20.at(-6)
    if ([e20, e50, e20prev].some((v) => v == null || Number.isNaN(v))) return null
    const slopeUp = (e20 - e20prev) / e20prev > 0.005
    return (e20 > e50 ? 1 : 0) + (closes.at(-1) > e20 ? 1 : 0) + (slopeUp ? 1 : 0)
  },
}
