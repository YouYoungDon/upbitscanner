import { calcRSISeries, calcOBV, calcEMA } from './indicators.mjs'

// 1) 유동성 스윕 (SMC): 직전 lookback봉 스윙 고/저점을 당일봉이 잠깐 뚫고 종가 회귀.
export function detectLiquiditySweep(ohlcv, lookback = 20) {
  const n = ohlcv.length
  const none = { side: null, score: 0, depthPct: 0 }
  if (n < lookback + 2) return none
  const cur = ohlcv[n - 1]
  const prior = ohlcv.slice(n - 1 - lookback, n - 1)
  const lowMin = Math.min(...prior.map((c) => c.low))
  const highMax = Math.max(...prior.map((c) => c.high))
  if (cur.low < lowMin && cur.close > lowMin * 1.001) {
    const depth = (lowMin - cur.low) / lowMin
    return { side: 'buy', score: depth >= 0.01 ? 4 : 2, depthPct: +(depth * 100).toFixed(2) }
  }
  if (cur.high > highMax && cur.close < highMax * 0.999) {
    const depth = (cur.high - highMax) / highMax
    return { side: 'sell', score: depth >= 0.01 ? 4 : 2, depthPct: +(depth * 100).toFixed(2) }
  }
  return none
}

// 2) V자 반등: 투매 클라이맥스 → 긴 밑꼬리 핀바 → CHoCH 순서 충족 (신선도 ≤2봉).
export function detectVBottom(ohlcv, { rsiThreshold = 25, volMult = 3.0, wickPct = 0.60, chochWin = 2, chochVolMult = 1.5 } = {}) {
  const n = ohlcv.length
  if (n < 30) return null
  const rsi9 = calcRSISeries(ohlcv.map((c) => c.close), 9)
  for (let i = n - 2; i >= n - 5 && i >= 21; i--) {
    const sig = ohlcv[i]
    const range = sig.high - sig.low
    if (range <= 0) continue
    const r = rsi9[i]
    if (r == null || r > rsiThreshold) continue
    const avgVol = ohlcv.slice(i - 20, i).reduce((a, c) => a + c.volume, 0) / 20
    if (avgVol <= 0) continue
    const volRatio = sig.volume / avgVol
    if (volRatio < volMult) continue
    const wick = (Math.min(sig.open, sig.close) - sig.low) / range
    if (wick < wickPct) continue
    for (let j = i + 1; j <= Math.min(i + chochWin, n - 1); j++) {
      const cAvg = ohlcv.slice(j - 20, j).reduce((a, c) => a + c.volume, 0) / 20
      if (ohlcv[j].close > sig.high && cAvg > 0 && ohlcv[j].volume >= chochVolMult * cAvg) {
        const signalAge = (n - 1) - j
        if (signalAge > 2) return null
        return {
          score: signalAge === 0 ? 7 : 5,
          rsi9: +r.toFixed(1),
          volRatio: +volRatio.toFixed(1),
          wickRatio: Math.round(wick * 100),
          stopLoss: sig.low,
          signalAge,
        }
      }
    }
  }
  return null
}

// 3) 세력 발사: BB 스퀴즈 → OBV 매집 → BB 상단 종가 돌파(거래량 동반) 순서 검증.
export function detectPumpStart(ohlcv, {
  bbPeriod = 20, bbMult = 2, sqLen = 50, obvEmaLen = 20, slopeWin = 5, volLen = 20, volMult = 2.0, sqWindow = 10,
} = {}) {
  const n = ohlcv.length
  if (n < sqLen + bbPeriod + 2) return null
  const closes = ohlcv.map((c) => c.close)
  const volumes = ohlcv.map((c) => c.volume)
  const bbAt = (i) => {
    const sl = closes.slice(i - bbPeriod + 1, i + 1)
    const mid = sl.reduce((a, b) => a + b, 0) / bbPeriod
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mid) ** 2, 0) / bbPeriod)
    return { upper: mid + bbMult * std, bw: mid > 0 ? (std * 2 * bbMult) / mid * 100 : 0 }
  }
  const last = n - 1
  // ③ 발사 (현재봉): 종가 BB상단 돌파(전봉은 밴드 내) + 거래량
  const avgVol = volumes.slice(last - volLen, last).reduce((a, b) => a + b, 0) / volLen
  const volRatio = avgVol > 0 ? volumes[last] / avgVol : 0
  if (!(closes[last] > bbAt(last).upper && closes[last - 1] <= bbAt(last - 1).upper && volRatio >= volMult)) return null
  // 페이크아웃 필터: 돌파봉 OBV EMA 우상향
  const obvEma = calcEMA(calcOBV(closes, volumes), obvEmaLen)
  if (!(obvEma.at(-1) > obvEma[last - slopeWin])) return null
  // ①② 스퀴즈 + 매집: 최근 sqWindow봉 내 시점에서 BW≤직전 sqLen BW최솟값×1.05 && 가격횡보 && OBV EMA 우상향
  let boxLow = null
  for (let t = last - 1; t >= last - sqWindow && t - sqLen >= 0; t--) {
    const bwT = bbAt(t).bw
    let minPrior = Infinity
    for (let k = t - sqLen; k < t; k++) if (k >= bbPeriod - 1) minPrior = Math.min(minPrior, bbAt(k).bw)
    if (!(bwT <= minPrior * 1.05)) continue
    const priceChg = Math.abs((closes[t] - closes[t - slopeWin]) / closes[t - slopeWin])
    if (priceChg <= 0.02 && obvEma[t] > obvEma[t - slopeWin]) {
      boxLow = Math.min(...ohlcv.slice(t - slopeWin, t + 1).map((c) => c.low))
      break
    }
  }
  if (boxLow == null) return null
  return { score: 7, volRatio: +volRatio.toFixed(1), stopLoss1: ohlcv[last].low, stopLoss2: boxLow }
}
