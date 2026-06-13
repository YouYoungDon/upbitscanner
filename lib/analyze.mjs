import {
  calcRSI, calcBB, calcMACD, calcStochastic, calcWilliamsR, calcVolRatio, calcEMA,
} from './indicators.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from './signals.mjs'
import { detectCandlePatterns } from './candle-patterns.mjs'

// ohlcv: 과거→최신 [{open,high,low,close,volume}]
export function analyzeMarket(ohlcv, { weights = {} } = {}) {
  const closes = ohlcv.map((c) => c.close)
  const highs = ohlcv.map((c) => c.high)
  const lows = ohlcv.map((c) => c.low)
  const volumes = ohlcv.map((c) => c.volume)
  const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50)

  const indicators = {
    price: closes.at(-1),
    rsi: calcRSI(closes),
    bb: calcBB(closes),
    macd: calcMACD(closes),
    stoch: calcStochastic(highs, lows, closes),
    wr: calcWilliamsR(highs, lows, closes),
    volRatio: calcVolRatio(volumes),
    ema20: ema20.at(-1),
    ema50: ema50.at(-1),
    recentCloses: closes.slice(-7),
  }

  const sig = detectSignals(ohlcv, weights)
  const pat = detectPatterns(ohlcv)
  let buyScore = sig.buyScore
  for (const p of pat.buy) buyScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1)
  let sellScore = sig.sellScore
  for (const p of pat.sell) sellScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1)
  const combo = applyCombos([...sig.buy, ...pat.buy], [...sig.sell, ...pat.sell], buyScore)

  return {
    indicators,
    buy: combo.buy,
    sell: [...sig.sell, ...pat.sell],
    candlePatterns: detectCandlePatterns(ohlcv),
    buyScore: combo.buyScore,
    sellScore,
  }
}
