import { getMarkets, getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from '../lib/signals.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'

const BATCH = 5
const DELAY = 200
const MIN_TRADE_PRICE_24H = 100_000_000 // 1억원
const MAX_SCANS = 30
const BUY_THRESHOLD = 5
const SELL_THRESHOLD = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const weights = await readJson('signal-weights.json', {})
  const markets = await getMarkets()
  if (!markets.length) { console.error('마켓 조회 실패'); process.exit(1) }

  const codes = markets.map((m) => m.market)
  const tickers = []
  for (let i = 0; i < codes.length; i += 100) {
    const t = await getTicker(codes.slice(i, i + 100))
    if (t) tickers.push(...t)
    await sleep(DELAY)
  }
  const liquid = new Set(
    tickers.filter((t) => t.acc_trade_price_24h >= MIN_TRADE_PRICE_24H).map((t) => t.market),
  )
  const nameOf = Object.fromEntries(markets.map((m) => [m.market, m.korean_name]))
  const targets = codes.filter((c) => liquid.has(c))
  console.log(`스캔 대상 ${targets.length}종목 (전체 ${codes.length})`)

  const buy = [], sell = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      const sig = detectSignals(ohlcv, weights)
      const pat = detectPatterns(ohlcv)
      for (const p of pat.buy) { sig.buy.push(p); sig.buyScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1) }
      for (const p of pat.sell) { sig.sell.push(p); sig.sellScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1) }

      const combo = applyCombos(sig.buy, sig.sell, sig.buyScore)
      const finalBuyScore = combo.buyScore
      if (finalBuyScore >= BUY_THRESHOLD) {
        buy.push({ market, korean_name: nameOf[market], price: sig.price, score: +finalBuyScore.toFixed(1), signals: combo.buy })
      }
      if (sig.sellScore >= SELL_THRESHOLD) {
        sell.push({ market, korean_name: nameOf[market], price: sig.price, score: +sig.sellScore.toFixed(1), signals: sig.sell })
      }
    }))
    await sleep(DELAY)
  }

  buy.sort((a, b) => b.score - a.score)
  sell.sort((a, b) => b.score - a.score)

  const log = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  log.totalScans = (log.totalScans || 0) + 1
  log.scans = rollingAppend(log.scans || [], { timestamp: new Date().toISOString(), buy, sell }, MAX_SCANS)
  await writeJson('monitor-log.json', log)

  console.log(`스캔 #${log.totalScans} 완료 — 매수 ${buy.length} / 매도 ${sell.length}`)
  console.log('매수 상위:', buy.slice(0, 5).map((b) => `${b.korean_name}(${b.score})`).join(', ') || '없음')
}

main().catch((e) => { console.error(e); process.exit(1) })
