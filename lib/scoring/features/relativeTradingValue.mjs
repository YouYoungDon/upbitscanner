export default {
  name: 'relative_trading_value', defaultGroup: 'early', normalizer: 'percentileVsUniverse',
  compute(ctx) { const v = ctx.coin?.ticker?.acc_trade_price_24h; return v == null || Number.isNaN(v) ? null : v },
}
