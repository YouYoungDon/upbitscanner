import { calcBBWidthSeries } from '../../indicators.mjs'
export default {
  name: 'vol_compression', defaultGroup: 'early', normalizer: 'vsOwnHistory',
  compute(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    const bw = calcBBWidthSeries(closes, 20, 2); if (!bw.length) return null
    const v = bw.at(-1); return v == null || Number.isNaN(v) ? null : -v
  },
  history(ctx) {
    const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
    return calcBBWidthSeries(closes, 20, 2).slice(-40).map((v) => -v)
  },
}
