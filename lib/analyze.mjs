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

  // 차트 패턴을 분해 항목으로 추가 (base = PATTERN_SCORE, weight = 가중치)
  const patItem = (p) => {
    const base = PATTERN_SCORE[p] || 0, weight = weights[p] ?? 1
    return { label: p, base, weight, score: base * weight }
  }
  const buyItems = [...sig.buyItems, ...pat.buy.map(patItem)]
  const sellItems = [...sig.sellItems, ...pat.sell.map(patItem)]
  const buySubtotal = buyItems.reduce((a, x) => a + x.score, 0)
  const sellScore = sellItems.reduce((a, x) => a + x.score, 0)

  const combo = applyCombos([...sig.buy, ...pat.buy], [...sig.sell, ...pat.sell], buySubtotal, sig.volRatio)

  return {
    indicators,
    buy: combo.buy,
    sell: [...sig.sell, ...pat.sell],
    candlePatterns: detectCandlePatterns(ohlcv),
    buyScore: combo.buyScore,
    sellScore,
    scoreBreakdown: {
      buy: { items: buyItems, subtotal: buySubtotal, combos: combo.combos, total: combo.buyScore },
      sell: { items: sellItems, subtotal: sellScore, combos: [], total: sellScore },
    },
  }
}
