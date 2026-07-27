export function calcEMA(d, p) {
  const k = 2 / (p + 1), r = [d[0]]
  for (let i = 1; i < d.length; i++) r.push(d[i] * k + r[i - 1] * (1 - k))
  return r
}

export function calcSMA(d, p) {
  const r = []
  for (let i = p - 1; i < d.length; i++)
    r.push(d.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p)
  return r
}

export function calcRSI(c, p = 14) {
  if (c.length < p + 1) return null
  let ag = 0, al = 0
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d > 0 ? (ag += d) : (al -= d) }
  ag /= p; al /= p
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al)
}

export function calcBB(c, p = 20, m = 2) {
  if (c.length < p) return null
  const sl = c.slice(-p), sma = sl.reduce((a, b) => a + b, 0) / p
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - sma) ** 2, 0) / p)
  return { upper: sma + m * std, mid: sma, lower: sma - m * std }
}

export function calcMACD(c, f = 12, s = 26, g = 9) {
  if (c.length < s + g) return null
  const mf = calcEMA(c, f), ms = calcEMA(c, s)
  const ml = c.map((_, i) => mf[i] - ms[i]), sl = calcEMA(ml, g)
  const l = c.length - 1, p = l - 1
  return { macd: ml[l], signal: sl[l], hist: ml[l] - sl[l], prevMacd: ml[p], prevSignal: sl[p], prevHist: ml[p] - sl[p] }
}

export function calcStochastic(highs, lows, closes, period = 14, sk = 3, sd = 3) {
  if (closes.length < period + sk + sd - 1) return null
  const rawK = []
  for (let i = period - 1; i < closes.length; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1))
    const l = Math.min(...lows.slice(i - period + 1, i + 1))
    rawK.push(h === l ? 50 : ((closes[i] - l) / (h - l)) * 100)
  }
  const smoothK = calcSMA(rawK, sk)
  const smoothD = calcSMA(smoothK, sd)
  const lk = smoothK.length - 1, ld = smoothD.length - 1
  return { k: smoothK[lk], d: smoothD[ld], prevK: smoothK[lk - 1], prevD: smoothD[ld - 1] }
}

export function calcWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null
  const h = Math.max(...highs.slice(-period))
  const l = Math.min(...lows.slice(-period))
  const r = h === l ? -50 : ((h - closes.at(-1)) / (h - l)) * -100
  return r === 0 ? 0 : r
}

export function calcVolRatio(volumes) {
  if (volumes.length < 21) return null
  const avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
  return avg > 0 ? volumes.at(-1) / avg : null
}

// 각 봉의 거래량 배율 배열 — 프리픽스 단위로 calcVolRatio와 동치. 20봉 미만 인덱스는 null. 롤링 합 O(n).
export function calcVolRatioSeries(volumes) {
  const n = volumes.length
  const out = new Array(n).fill(null)
  if (n < 21) return out
  let sum = 0
  for (let j = 0; j < 20; j++) sum += volumes[j]
  for (let i = 20; i < n; i++) {
    const avg = sum / 20
    out[i] = avg > 0 ? volumes[i] / avg : null
    sum += volumes[i] - volumes[i - 20]
  }
  return out
}

// 각 봉의 Stoch %K(평활) 배열 — 프리픽스 단위로 calcStochastic의 k와 동치. period+sk-2 미만 인덱스는 null.
export function calcStochasticKSeries(highs, lows, closes, period = 14, sk = 3) {
  const n = closes.length
  const out = new Array(n).fill(null)
  if (n < period + sk - 1) return out
  const rawK = []
  for (let i = period - 1; i < n; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1))
    const l = Math.min(...lows.slice(i - period + 1, i + 1))
    rawK.push(h === l ? 50 : ((closes[i] - l) / (h - l)) * 100)
  }
  const smooth = calcSMA(rawK, sk)
  // smooth[j] = rawK[j..j+sk-1] 평균 → 마지막 원소의 원 캔들 인덱스는 (period-1)+j+(sk-1)
  for (let j = 0; j < smooth.length; j++) out[period - 1 + sk - 1 + j] = smooth[j]
  return out
}

// 각 봉의 RSI 배열 (Wilder 평활). period 미만 인덱스는 null. 마지막 값은 calcRSI와 일치.
export function calcRSISeries(c, p = 14) {
  if (c.length < p + 1) return []
  const out = new Array(c.length).fill(null)
  let ag = 0, al = 0
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; d > 0 ? (ag += d) : (al -= d) }
  ag /= p; al /= p
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return out
}

// 볼린저 밴드폭(%) 시리즈: 각 봉의 (std*2*mult)/mid*100. index 0 = closes[period-1].
export function calcBBWidthSeries(closes, period = 20, mult = 2) {
  const out = []
  for (let i = period - 1; i < closes.length; i++) {
    const sl = closes.slice(i - period + 1, i + 1)
    const mid = sl.reduce((a, b) => a + b, 0) / period
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / period)
    out.push(mid > 0 ? (std * 2 * mult) / mid * 100 : 0)
  }
  return out
}

// OBV 누적 배열. 상승봉 +volume, 하락봉 -volume, 보합 유지. obv[0]=0.
export function calcOBV(closes, volumes) {
  const out = [0]
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) out.push(out[i - 1] + volumes[i])
    else if (closes[i] < closes[i - 1]) out.push(out[i - 1] - volumes[i])
    else out.push(out[i - 1])
  }
  return out
}
