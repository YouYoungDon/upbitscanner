const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
function ratioAt(tv, i) {
  const short = tv.slice(i - 2, i + 1), long = tv.slice(i - 9, i + 1)
  const l = mean(long); return l > 0 ? mean(short) / l : null
}
export default {
  name: 'money_acceleration', defaultGroup: 'early', normalizer: 'vsOwnHistory',
  compute(ctx) {
    const tv = ctx.coin?.ohlcvDaily?.map((c) => c.tradeValue) || []
    if (tv.length < 10) return null
    return ratioAt(tv, tv.length - 1)
  },
  history(ctx) {
    const tv = ctx.coin?.ohlcvDaily?.map((c) => c.tradeValue) || []
    const out = []
    for (let i = tv.length - 1; i >= 9 && out.length < 30; i--) { const r = ratioAt(tv, i); if (r != null) out.push(r) }
    return out
  },
}
