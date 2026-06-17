import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { scoreMomentum, MIN_MOMENTUM_SCORE } from '../lib/momentum.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { getScanUniverse, BATCH, DELAY, sleep, LOW_LIQUIDITY_24H } from '../lib/scan-universe.mjs'
import { sendTelegram } from '../lib/notify.mjs'

const MAX_SCANS = 30

async function main() {
  const { targets, nameOf, total, tradePrice } = await getScanUniverse()
  if (!targets.length) { console.error('스캔 대상 없음 (마켓/유동성 조회 실패)'); process.exit(1) }
  console.log(`모멘텀 스캔 대상 ${targets.length}종목 (전체 ${total})`)

  const picks = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      let { score, signals } = scoreMomentum(ohlcv)
      const lowLiq = (tradePrice[market] ?? Infinity) < LOW_LIQUIDITY_24H
      if (lowLiq) { score = +(score * 0.9).toFixed(1); signals = [...signals, '⚠️저유동성'] }
      if (score >= MIN_MOMENTUM_SCORE) {
        const pick = { market, korean_name: nameOf[market], price: ohlcv.at(-1).close, score, signals }
        if (lowLiq) pick.lowLiquidity = true
        picks.push(pick)
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

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 모멘텀 스캔 실패: ${e.message}`); process.exit(1) })
