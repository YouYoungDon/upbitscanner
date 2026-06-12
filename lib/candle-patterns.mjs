// 일본식 캔들스틱 패턴 감지 (순수 함수). ohlcv: 과거→최신.
// 각 봉 { open?, high, low, close }. open 없으면 직전 종가를 open으로 간주.

function normalize(ohlcv) {
  return ohlcv.map((c, i) => {
    const open = c.open != null ? c.open : (i > 0 ? ohlcv[i - 1].close : c.close)
    return { open, high: c.high, low: c.low, close: c.close }
  })
}

function body(c) { return Math.abs(c.close - c.open) }
function range(c) { return c.high - c.low }
function upperWick(c) { return c.high - Math.max(c.open, c.close) }
function lowerWick(c) { return Math.min(c.open, c.close) - c.low }
function isBull(c) { return c.close > c.open }
function isBear(c) { return c.close < c.open }

function trend(cs, n) {
  if (cs.length < n + 1) return 0
  const seg = cs.slice(-(n + 1), -1)
  return seg.at(-1).close - seg[0].close
}

export function detectCandlePatterns(ohlcv) {
  const bullish = [], bearish = [], neutral = []
  if (!Array.isArray(ohlcv) || ohlcv.length < 2) return { bullish, bearish, neutral }
  const cs = normalize(ohlcv)
  const last = cs.at(-1), prev = cs.at(-2)
  const before = trend(cs, 5)
  const b = body(last), r = range(last) || 1e-9

  if (b <= r * 0.1) neutral.push('도지')
  else if (b <= r * 0.3 && upperWick(last) > b && lowerWick(last) > b) neutral.push('팽이형')

  // 망치형/교수형: 아래꼬리가 전체 범위의 60% 이상, 위꼬리가 전체 범위의 10% 이하
  if (lowerWick(last) >= r * 0.6 && upperWick(last) <= r * 0.1) {
    if (before < 0) bullish.push('망치형')
    else if (before > 0) bearish.push('교수형')
  }
  // 역망치/유성형: 위꼬리가 전체 범위의 60% 이상, 아래꼬리가 전체 범위의 10% 이하
  if (upperWick(last) >= r * 0.6 && lowerWick(last) <= r * 0.1) {
    if (before < 0) bullish.push('역망치')
    else if (before > 0) bearish.push('유성형')
  }
  if (isBull(last) && isBear(prev) && last.close >= prev.open && last.open <= prev.close)
    bullish.push('상승장악형')
  if (isBear(last) && isBull(prev) && last.open >= prev.close && last.close <= prev.open)
    bearish.push('하락장악형')
  const prevMid = (prev.open + prev.close) / 2
  if (isBear(prev) && isBull(last) && last.open < prev.close && last.close > prevMid && last.close < prev.open)
    bullish.push('관통형')
  if (isBull(prev) && isBear(last) && last.open > prev.close && last.close < prevMid && last.close > prev.open)
    bearish.push('흑운형')
  if (cs.length >= 3) {
    const a = cs.at(-3)
    if (isBear(a) && body(prev) <= body(a) * 0.5 && isBull(last) && last.close > (a.open + a.close) / 2)
      bullish.push('샛별')
    if (isBull(a) && body(prev) <= body(a) * 0.5 && isBear(last) && last.close < (a.open + a.close) / 2)
      bearish.push('석별')
  }

  return { bullish, bearish, neutral }
}
