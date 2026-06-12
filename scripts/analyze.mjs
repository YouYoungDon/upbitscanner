import { getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import {
  calcRSI, calcBB, calcMACD, calcStochastic, calcWilliamsR, calcVolRatio, calcEMA,
} from '../lib/indicators.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from '../lib/signals.mjs'

const market = process.argv[2] || 'KRW-BTC'

const [candles, ticker] = await Promise.all([
  getDayCandles(market, 200),
  getTicker([market]),
])
if (!candles || !ticker) { console.error('조회 실패:', market); process.exit(1) }

const ohlcv = candlesToOhlcv(candles)
const closes = ohlcv.map((c) => c.close)
const highs = ohlcv.map((c) => c.high)
const lows = ohlcv.map((c) => c.low)
const volumes = ohlcv.map((c) => c.volume)
const price = ticker[0].trade_price
const chg = (ticker[0].signed_change_rate * 100).toFixed(2)

const rsi = calcRSI(closes), bb = calcBB(closes), mac = calcMACD(closes)
const stoch = calcStochastic(highs, lows, closes), wr = calcWilliamsR(highs, lows, closes)
const volR = calcVolRatio(volumes)
const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50), l = ema20.length - 1

console.log(`\n=== ${market} ===`)
console.log('현재가:', price, `(${chg}%)`)
console.log('RSI:', rsi?.toFixed(1))
console.log('BB lower:', bb?.lower.toFixed(4), 'mid:', bb?.mid.toFixed(4), 'upper:', bb?.upper.toFixed(4))
console.log('MACD hist:', mac?.hist.toFixed(4), 'prevHist:', mac?.prevHist.toFixed(4))
console.log('Stoch K:', stoch?.k.toFixed(1), 'D:', stoch?.d.toFixed(1), 'prevK:', stoch?.prevK.toFixed(1), 'prevD:', stoch?.prevD.toFixed(1))
console.log('WR:', wr?.toFixed(1))
console.log('EMA20:', ema20[l].toFixed(4), 'EMA50:', ema50[l].toFixed(4))
console.log('VolRatio:', volR?.toFixed(2) + 'x')
console.log('최근 7일 종가:', closes.slice(-7).map((v) => v.toFixed(4)).join(' → '))

const sig = detectSignals(ohlcv, {})
const pat = detectPatterns(ohlcv)
// monitor.mjs와 동일하게 패턴 점수를 buyScore에 더한 뒤 콤보 보정 (점수 일관성 유지)
let buyScoreWithPatterns = sig.buyScore
for (const p of pat.buy) buyScoreWithPatterns += PATTERN_SCORE[p] || 0
const combo = applyCombos([...sig.buy, ...pat.buy], [...sig.sell, ...pat.sell], buyScoreWithPatterns)
console.log('\n매수 신호:', combo.buy.join(', ') || '없음')
console.log('매도 신호:', [...sig.sell, ...pat.sell].join(', ') || '없음')
console.log('매수 점수:', combo.buyScore.toFixed(1), '/ 매도 점수:', sig.sellScore.toFixed(1))
