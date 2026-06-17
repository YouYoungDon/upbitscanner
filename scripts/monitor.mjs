import { getDayCandles, getMinuteCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { readPositions, evalPositions } from '../lib/positions.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from '../lib/signals.mjs'
import { detectLiquiditySweep, detectVBottom, detectPumpStart } from '../lib/smc-signals.mjs'
import { calcStochastic } from '../lib/indicators.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { appendScan } from '../lib/archive.mjs'
import { getScanUniverse, BATCH, DELAY, sleep, LOW_LIQUIDITY_24H } from '../lib/scan-universe.mjs'
import { btcRegime, regimeLabel } from '../lib/regime.mjs'

const MAX_SCANS = 30
const BUY_THRESHOLD = 5
const SELL_THRESHOLD = 3

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
  const { targets, nameOf, total, tradePrice } = await getScanUniverse()
  if (!targets.length) { console.error('스캔 대상 없음 (마켓/유동성 조회 실패)'); process.exit(1) }
  console.log(`스캔 대상 ${targets.length}종목 (전체 ${total})`)

  // 시장 레짐: BTC 일봉 추세 (약세면 반등 매수 감점)
  const btcCandles = await getDayCandles('KRW-BTC', 200)
  const regime = btcRegime(btcCandles ? candlesToOhlcv(btcCandles) : [])
  console.log(`시장 레짐(BTC): ${regime.trend}`)

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
      // 고강도 SMC 신호 (드물지만 강력 — combo/MTF와 별개의 가산 점수)
      let sellScore = sig.sellScore, sellSignals = sig.sell
      let vbottomSL, pumpSL
      const sweep = detectLiquiditySweep(ohlcv)
      const vbottom = detectVBottom(ohlcv)
      const pump = detectPumpStart(ohlcv)
      if (sweep.side === 'buy') { finalBuyScore += sweep.score; buySignals = [...buySignals, `유동성 스윕 (깊이 ${sweep.depthPct}%)`] }
      if (sweep.side === 'sell') { sellScore += sweep.score; sellSignals = [...sellSignals, `유동성 스윕 고점 (깊이 ${sweep.depthPct}%)`] }
      if (vbottom) { finalBuyScore += vbottom.score; buySignals = [...buySignals, `🎯V-Bottom (RSI${vbottom.rsi9}·꼬리${vbottom.wickRatio}%)`]; vbottomSL = vbottom.stopLoss }
      if (pump) { finalBuyScore += pump.score; buySignals = [...buySignals, `🚀Pump Start (vol ${pump.volRatio}x)`]; pumpSL = pump.stopLoss1 }
      // 레짐 게이트: BTC 약세장에선 반등 매수 신뢰도 하향 (약세 역행 매수 억제)
      if (regime.trend === 'bear') { finalBuyScore *= 0.85; buySignals = [...buySignals, '[레짐] BTC 약세 감점'] }
      // 저유동성 감점: 24h 거래대금 3억 미만은 슬리피지·조작 위험
      const lowLiq = (tradePrice[market] ?? Infinity) < LOW_LIQUIDITY_24H
      if (lowLiq) { finalBuyScore *= 0.9; buySignals = [...buySignals, '⚠️저유동성'] }

      if (finalBuyScore >= BUY_THRESHOLD) {
        const item = { market, korean_name: nameOf[market], price: sig.price, score: +finalBuyScore.toFixed(1), signals: buySignals }
        if (vbottomSL != null) item.vbottomSL = vbottomSL
        if (pumpSL != null) item.pumpSL = pumpSL
        if (lowLiq) item.lowLiquidity = true
        buy.push(item)
      }
      if (sellScore >= SELL_THRESHOLD) {
        sell.push({ market, korean_name: nameOf[market], price: sig.price, score: +sellScore.toFixed(1), signals: sellSignals })
      }
    }))
    await sleep(DELAY)
  }

  buy.sort((a, b) => b.score - a.score)
  sell.sort((a, b) => b.score - a.score)

  const ratio = +(buy.length / Math.max(sell.length, 1)).toFixed(2)
  const regimeInfo = { trend: regime.trend, ratio, ...regimeLabel(ratio, regime.trend) }
  const entry = { timestamp: new Date().toISOString(), buy, sell, regime: regimeInfo }
  const log = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  log.totalScans = (log.totalScans || 0) + 1
  log.scans = rollingAppend(log.scans || [], entry, MAX_SCANS)
  await writeJson('monitor-log.json', log)
  appendScan(entry)

  console.log(`스캔 #${log.totalScans} 완료 — 매수 ${buy.length} / 매도 ${sell.length}`)
  console.log('매수 상위:', buy.slice(0, 5).map((b) => `${b.korean_name}(${b.score})`).join(', ') || '없음')

  await notifyTelegram(buy)
  await notifyPositionAlerts()
}

// 보유 포지션(data/positions.json) 중 손절선 도달 종목 경고 (콘솔 + Telegram)
async function notifyPositionAlerts() {
  const positions = readPositions()
  if (!positions.length) return
  const tickers = await getTicker(positions.map((p) => p.market)) || []
  const priceOf = Object.fromEntries(tickers.map((t) => [t.market, t.trade_price]))
  const hit = evalPositions(positions, priceOf).filter((p) => p.hitSL)
  if (!hit.length) return
  console.log('⚠️ 손절선 도달:', hit.map((p) => `${p.korean_name}(${p.price}≤${p.stopLoss})`).join(', '))
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID) return
  const lines = hit.map((p) => `• ${p.korean_name}(${p.market.replace('KRW-', '')}) ${p.price} ≤ SL ${p.stopLoss} (${p.plPct}%)`)
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: `⚠️ 손절선 도달\n\n${lines.join('\n')}` }),
    })
  } catch { /* 무시 */ }
}

// Telegram 알림 (환경변수 TELEGRAM_TOKEN, TELEGRAM_CHAT_ID 설정 시 매수 상위 5개 전송)
async function notifyTelegram(buyList) {
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID || buyList.length === 0) return
  const lines = buyList.slice(0, 5).map((b) => {
    const mtf = b.signals.includes('[MTF] 4시간봉 Stoch GC 확인') ? ' 📡MTF' : ''
    const stgc = b.signals.some((s) => s.includes('골든크로스')) ? ' 🟢GC' : ''
    const sl = b.vbottomSL != null ? ` 🎯SL:${b.vbottomSL}` : b.pumpSL != null ? ` 🚀SL:${b.pumpSL}` : ''
    return `• ${b.korean_name}(${b.market.replace('KRW-', '')}) score ${b.score.toFixed(1)}${stgc}${mtf}${sl}`
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
