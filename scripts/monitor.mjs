import { getMarkets, getDayCandles, getTicker, getMinuteCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from '../lib/signals.mjs'
import { calcStochastic } from '../lib/indicators.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { appendScan } from '../lib/archive.mjs'

const BATCH = 5
const DELAY = 200
const MIN_TRADE_PRICE_24H = 100_000_000 // 1억원
const MAX_SCANS = 30
const BUY_THRESHOLD = 5
const SELL_THRESHOLD = 3

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 멀티 타임프레임: 4시간봉 Stoch 골든크로스 확인 (반등 신뢰도 보강)
async function check4hStochGC(market) {
  const candles = await getMinuteCandles(market, 240, 60)
  if (!Array.isArray(candles) || candles.length < 30) return false
  const ohlcv = candlesToOhlcv(candles)
  const stoch = calcStochastic(ohlcv.map((c) => c.high), ohlcv.map((c) => c.low), ohlcv.map((c) => c.close))
  return stoch ? stoch.k < 20 && stoch.prevK < stoch.prevD && stoch.k > stoch.d : false
}

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
      let finalBuyScore = combo.buyScore
      let buySignals = combo.buy
      // 멀티 타임프레임 보너스: 일봉 GC + 4시간봉도 Stoch GC면 ×1.2
      if (finalBuyScore >= BUY_THRESHOLD && buySignals.some((s) => s.includes('골든크로스'))) {
        if (await check4hStochGC(market)) {
          finalBuyScore *= 1.2
          buySignals = [...buySignals, '[MTF] 4시간봉 Stoch GC 확인']
        }
      }
      if (finalBuyScore >= BUY_THRESHOLD) {
        buy.push({ market, korean_name: nameOf[market], price: sig.price, score: +finalBuyScore.toFixed(1), signals: buySignals })
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
  appendScan({ timestamp: log.scans.at(-1).timestamp, buy, sell })

  console.log(`스캔 #${log.totalScans} 완료 — 매수 ${buy.length} / 매도 ${sell.length}`)
  console.log('매수 상위:', buy.slice(0, 5).map((b) => `${b.korean_name}(${b.score})`).join(', ') || '없음')

  await notifyTelegram(buy)
}

// Telegram 알림 (환경변수 TELEGRAM_TOKEN, TELEGRAM_CHAT_ID 설정 시 매수 상위 5개 전송)
async function notifyTelegram(buyList) {
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID || buyList.length === 0) return
  const lines = buyList.slice(0, 5).map((b) => {
    const mtf = b.signals.includes('[MTF] 4시간봉 Stoch GC 확인') ? ' 📡MTF' : ''
    const stgc = b.signals.some((s) => s.includes('골든크로스')) ? ' 🟢GC' : ''
    return `• ${b.korean_name}(${b.market.replace('KRW-', '')}) score ${b.score.toFixed(1)}${stgc}${mtf}`
  })
  const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const msg = `🚨 업비트 스캔 ${when}\n매수 ${buyList.length}개 감지\n\n${lines.join('\n')}`
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
    })
  } catch { /* 네트워크 오류 시 무시 */ }
}

main().catch((e) => { console.error(e); process.exit(1) })
