function tightAt(o, i, N = 10) {
  const seg = o.slice(i - N + 1, i + 1); if (seg.length < N) return null
  const hi = Math.max(...seg.map((c) => c.high)), lo = Math.min(...seg.map((c) => c.low))
  const m = seg.reduce((x, c) => x + c.close, 0) / seg.length
  return m > 0 ? -((hi - lo) / m) : null
}
export default {
  name: 'consolidation', defaultGroup: 'early', normalizer: 'vsOwnHistory',
  compute(ctx) { const o = ctx.coin?.ohlcvDaily || []; return o.length < 10 ? null : tightAt(o, o.length - 1) },
  history(ctx) { const o = ctx.coin?.ohlcvDaily || []; const out = []; for (let i = o.length - 1; i >= 9 && out.length < 40; i--) { const t = tightAt(o, i); if (t != null) out.push(t) } return out },
}
