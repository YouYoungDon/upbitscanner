function median(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null }
export default {
  name: 'liquidity', defaultGroup: 'early', normalizer: 'fixedCurve',
  params: [[1e8, 0], [3e8, 40], [1e9, 70], [5e9, 100]],
  compute(ctx) { const tv = ctx.coin?.ohlcvDaily?.map((c) => c.tradeValue) || []; return tv.length < 20 ? null : median(tv.slice(-20)) },
}
