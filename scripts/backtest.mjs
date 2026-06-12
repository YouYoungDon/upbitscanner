import { getMarkets, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { detectSignals, applyCombos } from '../lib/signals.mjs'
import { readJson } from '../lib/store.mjs'

const HOLD_DAYS = 3
const BUY_THRESHOLD = 5
const SAMPLE_LIMIT = Number(process.argv[2] || 30)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const weights = await readJson('signal-weights.json', {})
const markets = (await getMarkets()).slice(0, SAMPLE_LIMIT)

let trades = 0, wins = 0, totalRet = 0
for (const m of markets) {
  const candles = await getDayCandles(m.market, 200)
  await sleep(200)
  if (!candles || candles.length < 80) continue
  const ohlcv = candlesToOhlcv(candles)
  for (let i = 60; i < ohlcv.length - HOLD_DAYS; i++) {
    const window = ohlcv.slice(0, i + 1)
    const sig = detectSignals(window, weights)
    const combo = applyCombos(sig.buy, sig.sell, sig.buyScore)
    if (combo.buyScore >= BUY_THRESHOLD) {
      const entry = ohlcv[i].close
      const exit = ohlcv[i + HOLD_DAYS].close
      const ret = (exit - entry) / entry
      trades++
      totalRet += ret
      if (ret > 0) wins++
    }
  }
}

console.log(`백테스트 — ${markets.length}종목, 보유 ${HOLD_DAYS}일`)
console.log(`진입 ${trades}회, 승률 ${trades ? ((wins / trades) * 100).toFixed(1) : 0}%, 평균수익률 ${trades ? ((totalRet / trades) * 100).toFixed(2) : 0}%`)
