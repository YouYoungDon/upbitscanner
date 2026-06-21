import {
  calcEMA, calcRSI, calcBB, calcMACD,
  calcStochastic, calcWilliamsR, calcVolRatio,
} from './indicators.mjs'
import { detectCandlePatterns } from './candle-patterns.mjs'

// weights: { '신호라벨접두어': number }. 없으면 1.0.
function w(weights, key) {
  return weights && weights[key] != null ? weights[key] : 1
}

// 모든 신호 라벨 접두어 (가중치/적중률 집계의 단일 출처). weekly.mjs도 이걸 import.
export const SIGNAL_KEYS = [
  'MACD 골든크로스', 'MACD 반등', 'MACD 상승', 'MACD 데드크로스', 'MACD 하락전환', 'MACD 하락',
  'RSI 과매도', 'RSI 과매수', 'BB 하단 지지', 'BB 상단 돌파',
  'Stoch 과매도 골든크로스', 'Stoch 과매도', 'Stoch 과매수 데드크로스', 'Stoch 과매수',
  'Williams %R 과매도', 'Williams %R 과매수',
  'EMA 20/50 골든크로스', 'EMA 상승배열', 'EMA 20/50 데드크로스', 'EMA 하락배열',
  '거래량 급증', '쌍봉 패턴', '하락깃발 패턴', '역삼중바닥 패턴', '상승깃발 패턴', '상승삼각형 패턴',
  '박스권 돌파 패턴',
  '캔들 강세형', '캔들 약세형',
]

// 패턴별 점수 (가이드 §9). monitor/analyze가 import.
export const PATTERN_SCORE = {
  '쌍봉 패턴': 5, '역삼중바닥 패턴': 3, '상승깃발 패턴': 4, '하락깃발 패턴': 4, '상승삼각형 패턴': 5,
  '박스권 돌파 패턴': 4,
}

// 거래량 배율 → 점수 등급 (2/5/10/20x 계단)
export function volumeGrade(volR) {
  if (volR == null || volR < 2) return 0
  if (volR < 5) return 1
  if (volR < 10) return 2
  if (volR < 20) return 3
  return 4
}

// 라벨에서 가장 긴 매칭 접두어의 가중치 키를 찾는다.
export function keyOf(label) {
  return SIGNAL_KEYS
    .filter((k) => label.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
}
function weightFor(weights, label) {
  const key = keyOf(label)
  return key ? w(weights, key) : 1
}

export function detectSignals(ohlcv, weights = {}) {
  const closes = ohlcv.map((c) => c.close)
  const highs = ohlcv.map((c) => c.high)
  const lows = ohlcv.map((c) => c.low)
  const volumes = ohlcv.map((c) => c.volume)
  const price = closes.at(-1)

  const buy = [], sell = []
  let buyScore = 0, sellScore = 0
  const addBuy = (label, score) => { buy.push(label); buyScore += score * weightFor(weights, label) }
  const addSell = (label, score) => { sell.push(label); sellScore += score * weightFor(weights, label) }

  const rsi = calcRSI(closes)
  const bb = calcBB(closes)
  const macd = calcMACD(closes)
  const stoch = calcStochastic(highs, lows, closes)
  const wr = calcWilliamsR(highs, lows, closes)
  const volR = calcVolRatio(volumes)
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const li = closes.length - 1

  if (rsi != null) {
    if (rsi < 30) addBuy(`RSI 과매도 (${rsi.toFixed(0)})`, 3)
    else if (rsi > 70) addSell(`RSI 과매수 (${rsi.toFixed(0)})`, 3)
  }
  if (bb) {
    if (price <= bb.lower * 1.005) addBuy('BB 하단 지지', 2)
    else if (price >= bb.upper * 0.995) addSell('BB 상단 돌파', 2)
  }
  if (macd) {
    if (macd.prevMacd <= macd.prevSignal && macd.macd > macd.signal) addBuy('MACD 골든크로스', 3)
    else if (macd.prevMacd >= macd.prevSignal && macd.macd < macd.signal) addSell('MACD 데드크로스', 3)
    if (macd.prevHist < 0 && macd.hist > 0) addBuy('MACD 반등', 2)
    else if (macd.prevHist > 0 && macd.hist < 0) addSell('MACD 하락전환', 2)
    if (macd.macd > macd.signal && macd.signal > 0) addBuy('MACD 상승', 1)
    else if (macd.macd < macd.signal && macd.signal < 0) addSell('MACD 하락', 1)
  }
  if (stoch) {
    if (stoch.k < 20 && stoch.prevK < stoch.prevD && stoch.k > stoch.d)
      addBuy(`Stoch 과매도 골든크로스 (${stoch.k.toFixed(0)})`, 3)
    else if (stoch.k > 80 && stoch.prevK > stoch.prevD && stoch.k < stoch.d)
      addSell(`Stoch 과매수 데드크로스 (${stoch.k.toFixed(0)})`, 3)
    else if (stoch.k < 20) addBuy(`Stoch 과매도 (${stoch.k.toFixed(0)})`, 2)
    else if (stoch.k > 80) addSell(`Stoch 과매수 (${stoch.k.toFixed(0)})`, 2)
  }
  if (wr != null) {
    if (wr <= -85) addBuy(`Williams %R 과매도 (${wr.toFixed(0)})`, 1)
    else if (wr >= -15) addSell(`Williams %R 과매수 (${wr.toFixed(0)})`, 1)
  }
  if (ema20.length && ema50.length) {
    const e20 = ema20[li], e50 = ema50[li], pe20 = ema20[li - 1], pe50 = ema50[li - 1]
    if (pe20 <= pe50 && e20 > e50) addBuy('EMA 20/50 골든크로스', 2)
    else if (pe20 >= pe50 && e20 < e50) addSell('EMA 20/50 데드크로스', 2)
    if (e20 > e50 * 1.005) addBuy('EMA 상승배열', 2)
    else if (e20 < e50 * 0.995) addSell('EMA 하락배열', 2)
  }
  if (volR != null && volR >= 2 && volumes.length >= 2) {
    const grade = volumeGrade(volR)
    const up = closes.at(-1) >= closes.at(-2) * 1.02   // 매수: +2% 이상 상승 동반
    const down = closes.at(-1) < closes.at(-2)
    if (up) addBuy(`거래량 급증 (${volR.toFixed(1)}x)`, grade)
    else if (down) addSell(`거래량 급증 (${volR.toFixed(1)}x)`, grade)
  }

  // 캔들스틱 패턴 (강세=매수+2, 약세=매도+2). 라벨에 패턴명 부기.
  const cp = detectCandlePatterns(ohlcv)
  if (cp.bullish.length) addBuy(`캔들 강세형 (${cp.bullish.join(',')})`, 2)
  if (cp.bearish.length) addSell(`캔들 약세형 (${cp.bearish.join(',')})`, 2)

  // 매도: 데드크로스 발생 시 익절 타이밍 태그 (점수 영향 없음, 정보 라벨)
  if (sell.some((s) => s.includes('데드크로스'))) sell.push('[익절] Stoch DC — 매도 타이밍')

  return { buy, sell, buyScore, sellScore, price, volRatio: volR }
}

// 거래량 배율 → 콤보 보너스 배수
export function volComboMult(volR) {
  if (volR == null) return 1.3
  if (volR >= 20) return 1.6
  if (volR >= 10) return 1.45
  return 1.3
}

export function applyCombos(buy, sell, buyScore, volRatio = null) {
  let bs = buyScore
  const out = [...buy]
  const hasStochGC = out.some((s) => s.includes('골든크로스'))
  const hasRSI = out.some((s) => s.startsWith('RSI 과매도'))
  const hasBB = out.includes('BB 하단 지지')
  const hasStoch = out.some((s) => s.startsWith('Stoch 과매도') && !s.includes('골든크로스'))
  const hasWR = out.some((s) => s.startsWith('Williams %R 과매도'))
  const hasVol = out.some((s) => s.startsWith('거래량 급증'))

  if (!hasStochGC && hasRSI && hasBB && hasStoch && hasWR) {
    bs *= 0.55
    out.push('[콤보] 과매도 함정 페널티')
  }
  if (hasStochGC) {
    bs *= 1.4
    out.push('[콤보] 반등확인 보너스')
  }
  if (hasVol) {
    bs *= volComboMult(volRatio)
    out.push('[콤보] 거래량확인 보너스')
  }
  return { buyScore: bs, buy: out }
}

// 차트 패턴 감지 (가이드 §9). ohlcv: 과거→최신.
export function detectPatterns(ohlcv) {
  const buy = [], sell = []
  const closes = ohlcv.map((c) => c.close)
  const highs = ohlcv.map((c) => c.high)
  const lows = ohlcv.map((c) => c.low)
  const n = closes.length
  if (n < 30) return { buy, sell }
  const price = closes.at(-1)

  // 쌍봉 (Double Top): 최근 30봉 내 두 고점 차 <1.5%, 사이 골짜기, 현재가 ≤ 평균×0.99
  const win = 30
  const seg = highs.slice(-win)
  const segLow = lows.slice(-win)
  const idx1 = seg.indexOf(Math.max(...seg.slice(0, win / 2)))
  const idx2 = (win / 2) + seg.slice(win / 2).indexOf(Math.max(...seg.slice(win / 2)))
  if (idx1 >= 0 && idx2 > idx1) {
    const h1 = seg[idx1], h2 = seg[idx2]
    const valley = Math.min(...segLow.slice(idx1, idx2 + 1))
    const avgTop = (h1 + h2) / 2
    if (Math.abs(h1 - h2) / avgTop < 0.015 && valley < avgTop * 0.97 && price <= avgTop * 0.99)
      sell.push('쌍봉 패턴')
  }

  // 역삼중바닥 (Triple Bottom): 세 저점 편차 <1.5%, 저점끼리 5봉 이상 떨어짐, 현재가 > 평균×1.02
  const lo = lows.slice(-win)
  const sorted = [...lo].map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 3)
  if (sorted.length === 3) {
    const vals = sorted.map((s) => s[0])
    const avg = vals.reduce((a, b) => a + b, 0) / 3
    const dev = Math.max(...vals.map((v) => Math.abs(v - avg) / avg))
    // 세 저점이 인접 캔들이면 하나의 골짜기일 뿐 → 5봉 이상 간격 요구 (오탐 방지)
    const [i0, i1, i2] = sorted.map((s) => s[1]).sort((a, b) => a - b)
    const separated = i1 - i0 >= 5 && i2 - i1 >= 5
    if (dev < 0.015 && separated && price > avg * 1.02) buy.push('역삼중바닥 패턴')
  }

  // 상승깃발: 직전 16봉 +8%↑ 후 -2%~+0.3% 횡보
  if (n >= 20) {
    const polePast = closes[n - 20], poleNow = closes[n - 4]
    const poleGain = (poleNow - polePast) / polePast
    const consol = (price - poleNow) / poleNow
    if (poleGain >= 0.08 && consol >= -0.02 && consol <= 0.003) buy.push('상승깃발 패턴')
  }

  // 하락깃발: 직전 16봉 -6%↓ 후 -0.5%~+2.5% 횡보
  if (n >= 20) {
    const polePast = closes[n - 20], poleNow = closes[n - 4]
    const poleDrop = (poleNow - polePast) / polePast
    const consol = (price - poleNow) / poleNow
    if (poleDrop <= -0.06 && consol >= -0.005 && consol <= 0.025) sell.push('하락깃발 패턴')
  }

  // 상승삼각형: 최근 30봉 고점 편차 <1.5%, 저점 상승 추세
  const segH = highs.slice(-win)
  const avgH = segH.reduce((a, b) => a + b, 0) / win
  const devH = Math.max(...segH.map((v) => Math.abs(v - avgH) / avgH))
  const firstHalfLow = Math.min(...lows.slice(-win, -win / 2))
  const secondHalfLow = Math.min(...lows.slice(-win / 2))
  if (devH < 0.015 && secondHalfLow > firstHalfLow) buy.push('상승삼각형 패턴')

  // 박스권 돌파 (Box Breakout): 최근 20봉 범위가 좁고(±5%), 마지막 종가가 상단 1% 돌파
  if (n >= 25) {
    const boxHighs = highs.slice(-21, -1), boxLows = lows.slice(-21, -1)
    const boxTop = Math.max(...boxHighs), boxBottom = Math.min(...boxLows)
    const boxRange = (boxTop - boxBottom) / boxBottom
    if (boxRange < 0.05 && closes[n - 1] > boxTop * 1.01) buy.push('박스권 돌파 패턴')
  }

  return { buy, sell }
}
