export default {
  name: 'breakout_strength', defaultGroup: 'confirm', normalizer: 'percentileVsUniverse',
  compute(ctx) {
    const o = ctx.coin?.ohlcvDaily || []; if (o.length < 21) return null
    const prior = o.slice(-21, -1)
    const hi = Math.max(...prior.map((c) => c.high)), lo = Math.min(...prior.map((c) => c.low))
    const range = hi - lo; if (!(range > 0)) return null
    return +(((o.at(-1).close - hi) / range)).toFixed(3)
  },
}
