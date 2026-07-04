// lib/scoring/features/relativeVolume.mjs
import { calcVolRatio } from '../../indicators.mjs'
export default {
  name: 'relative_volume',
  defaultGroup: 'early',
  normalizer: 'percentileVsUniverse',
  compute(ctx) {
    const vols = ctx.coin?.ohlcvDaily?.map((c) => c.volume) || []
    if (vols.length < 21) return null
    const r = calcVolRatio(vols)
    return r == null || Number.isNaN(r) ? null : +r.toFixed(3)
  },
}
