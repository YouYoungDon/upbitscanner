import { calcEMA, calcRSI, calcRSISeries, calcOBV, calcBBWidthSeries } from './indicators.mjs'

export const MIN_MOMENTUM_SCORE = 10

// RSI 다이버전스: 최근 lookback봉 로컬 피크/트로프(window) 직전 2개 비교.
// 하락(bearish): 가격 고점↑ + RSI 고점 minGap↓. 상승(bullish): 가격 저점↓ + RSI 저점 minGap↑.
export function detectDivergence(prices, rsi, { window = 3, lookback = 60, minGap = 3 } = {}) {
  const n = prices.length
  const start = Math.max(window, n - lookback)
  const peaks = [], troughs = []
  for (let i = start; i < n - window; i++) {
    const seg = prices.slice(i - window, i + window + 1)
    if (prices[i] === Math.max(...seg)) peaks.push(i)
    if (prices[i] === Math.min(...seg)) troughs.push(i)
  }
  let bearish = false, bullish = false
  if (peaks.length >= 2) {
    const [a, b] = peaks.slice(-2)
    if (rsi[a] != null && rsi[b] != null && prices[b] > prices[a] && rsi[b] < rsi[a] - minGap) bearish = true
  }
  if (troughs.length >= 2) {
    const [a, b] = troughs.slice(-2)
    if (rsi[a] != null && rsi[b] != null && prices[b] < prices[a] && rsi[b] > rsi[a] + minGap) bullish = true
  }
  return { bearish, bullish }
}

// 볼린저 밴드폭(BW%) 시리즈로 스퀴즈(수축)→발산(2봉 연속 확장) 감지.
export function calcBBSqueeze(closes, { period = 20, mult = 2, lookback = 30, sqWin = 6, pctile = 0.25 } = {}) {
  const none = { squeeze: false, expanding: false, fired: false }
  if (closes.length < period + 2) return none
  const bw = calcBBWidthSeries(closes, period, mult)
  if (bw.length < Math.max(sqWin, 3)) return none
  const recent = bw.slice(-lookback)
  const lo = Math.min(...recent), hi = Math.max(...recent)
  const threshold = lo + (hi - lo) * pctile
  const sqMin = Math.min(...bw.slice(-sqWin))
  const squeeze = sqMin <= threshold
  const expanding = bw.at(-1) > bw.at(-2) && bw.at(-2) > bw.at(-3)
  return { squeeze, expanding, fired: squeeze && expanding }
}

// MACD 히스토그램 최근 3봉 연속 증가 여부
function macdHist3Up(closes) {
  if (closes.length < 35) return false
  const f = calcEMA(closes, 12), s = calcEMA(closes, 26)
  const macdLine = closes.map((_, i) => f[i] - s[i])
  const sig = calcEMA(macdLine, 9)
  const hist = closes.map((_, i) => macdLine[i] - sig[i])
  const n = hist.length
  return hist[n - 1] > hist[n - 2] && hist[n - 2] > hist[n - 3]
}

// 추세 지속 모멘텀 점수 (MIN_SCORE=10, 이론최대 18). 그룹 A~D는 최댓값 1개, E는 누적.
export function scoreMomentum(ohlcv) {
  const signals = []
  let score = 0
  if (!Array.isArray(ohlcv) || ohlcv.length < 30) return { score: 0, signals }
  const closes = ohlcv.map((c) => c.close)
  const opens = ohlcv.map((c) => c.open)
  const highs = ohlcv.map((c) => c.high)
  const volumes = ohlcv.map((c) => c.volume)
  const n = closes.length

  const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50), ema200 = calcEMA(closes, 200)
  const e20 = ema20.at(-1), e50 = ema50.at(-1), e200 = ema200.at(-1)

  // A 추세
  if (e20 > e50 && e50 > e200) { score += 4; signals.push('EMA 완전정배열 (20>50>200)') }
  else if (e20 > e50) { score += 2; signals.push('EMA 정배열 (20>50)') }

  // B 모멘텀 (연속양봉 우선, 없으면 EMA20 기울기)
  let consec = 0
  for (let i = n - 1; i >= 0; i--) { if (closes[i] > opens[i]) consec++; else break }
  if (consec >= 5) { score += 4; signals.push(`연속양봉 ${consec}봉`) }
  else if (consec >= 3) { score += 2; signals.push(`연속양봉 ${consec}봉`) }
  else if ((e20 - ema20.at(-6)) / ema20.at(-6) >= 0.01) { score += 2; signals.push('EMA20 상승기울기') }

  // C 가격 위치 (200봉 신고가)
  const max200 = Math.max(...highs.slice(-200))
  const ratio = closes.at(-1) / max200
  if (ratio >= 0.99) { score += 4; signals.push('200봉 신고가 갱신') }
  else if (ratio >= 0.92) { score += 2; signals.push('200봉 신고가 근접') }

  // D 오실레이터 (MACD 3연속↑ + RSI 골디락스)
  const macd3up = macdHist3Up(closes)
  const rsi = calcRSI(closes, 14)
  const goldilocks = rsi != null && rsi >= 50 && rsi <= 75
  if (macd3up && goldilocks) { score += 4; signals.push('MACD 3연속↑ + RSI 골디락스') }
  else if (macd3up) { score += 2; signals.push('MACD 히스토 3연속↑') }
  else if (goldilocks) { score += 2; signals.push('RSI 골디락스 (50~75)') }

  // E 품질 보조 (누적)
  const obvEma = calcEMA(calcOBV(closes, volumes), 10)
  const obvUp = obvEma.at(-1) > obvEma.at(-6)
  const priceChg = (closes.at(-1) - closes.at(-6)) / closes.at(-6)
  const priceFlat = Math.abs(priceChg) <= 0.005
  const priceUp = priceChg > 0.005
  if (obvUp && priceFlat) { score += 2; signals.push('OBV 매집 (선행)') }
  else if (obvUp && priceUp) { score += 2; signals.push('OBV 추세확인') }
  if (calcBBSqueeze(closes).fired) { score += 2; signals.push('BB 스퀴즈 발산') }

  // 차감
  if (detectDivergence(closes, calcRSISeries(closes, 14)).bearish) { score -= 4; signals.push('RSI 하락 다이버전스 (-4)') }
  if (!obvUp && priceUp) { score -= 2; signals.push('OBV 약화 (-2)') }

  return { score, signals }
}
