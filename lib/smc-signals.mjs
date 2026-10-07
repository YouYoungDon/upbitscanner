import { calcRSISeries } from './indicators.mjs'

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

// 3) 세력 발사(detectPumpStart)는 2026-10-07 제거 — BB 상단 돌파+거래량 2x 급증 매수 셋업으로, 18개월 재생에서
//    3일 초과수익 −1.12%p(승률 37%), 단일 제거 시험 악화 0/12. 상승 동반 거래량 급증 매수 전반이 역방향이었다.
