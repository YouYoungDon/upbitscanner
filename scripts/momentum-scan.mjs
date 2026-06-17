import { getMarkets, getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { scoreMomentum, MIN_MOMENTUM_SCORE } from '../lib/momentum.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'

const BATCH = 5
const DELAY = 200
const MIN_TRADE_PRICE_24H = 100_000_000 // 1억원
const MAX_SCANS = 30

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
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
  console.log(`모멘텀 스캔 대상 ${targets.length}종목 (전체 ${codes.length})`)

  const picks = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      const { score, signals } = scoreMomentum(ohlcv)
      if (score >= MIN_MOMENTUM_SCORE) {
        picks.push({ market, korean_name: nameOf[market], price: ohlcv.at(-1).close, score, signals })
      }
    }))
    await sleep(DELAY)
  }

  picks.sort((a, b) => b.score - a.score)

  const log = await readJson('momentum-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  log.totalScans = (log.totalScans || 0) + 1
  log.scans = rollingAppend(log.scans || [], { timestamp: new Date().toISOString(), picks }, MAX_SCANS)
  await writeJson('momentum-log.json', log)

  console.log(`모멘텀 스캔 #${log.totalScans} 완료 — 추세지속 ${picks.length}종목`)
  console.log('상위:', picks.slice(0, 5).map((p) => `${p.korean_name}(${p.score})`).join(', ') || '없음')

  await notifyTelegram(picks)
}

// Telegram 알림 (TELEGRAM_TOKEN, TELEGRAM_CHAT_ID 설정 시 추세지속 상위 5개 전송)
async function notifyTelegram(picks) {
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID || picks.length === 0) return
  const lines = picks.slice(0, 5).map((p) => `• ${p.korean_name}(${p.market.replace('KRW-', '')}) score ${p.score}`)
  const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const msg = `🚀 모멘텀 스캔 ${when}\n추세지속 ${picks.length}개\n\n${lines.join('\n')}`
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
    })
  } catch { /* 네트워크 오류 시 무시 */ }
}

main().catch((e) => { console.error(e); process.exit(1) })
