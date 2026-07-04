export default {
  name: 'abs_trading_value', defaultGroup: 'early', normalizer: 'fixedCurve',
  params: [[1e8, 0], [5e8, 40], [2e9, 70], [1e10, 100]],
  compute(ctx) { const v = ctx.coin?.ticker?.acc_trade_price_24h; return v == null || Number.isNaN(v) ? null : v },
}
