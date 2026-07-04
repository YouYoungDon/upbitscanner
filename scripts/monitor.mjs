import { getDayCandles, getMinuteCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { readPositions, evalPositions } from '../lib/positions.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE, fallingKnifePenalty } from '../lib/signals.mjs'
import { detectLiquiditySweep, detectVBottom, detectPumpStart } from '../lib/smc-signals.mjs'
import { calcStochastic } from '../lib/indicators.mjs'
import { readJson, writeJson, rollingAppend, withLock } from '../lib/store.mjs'
import { appendScan } from '../lib/archive.mjs'
import { getScanUniverse, BATCH, DELAY, sleep, liquidityPenalty, upbitDominancePenalty } from '../lib/scan-universe.mjs'
import { ensureCgData } from '../lib/cg-data.mjs'
import { scorePersistence } from '../lib/persistence.mjs'
import { btcRegime, regimeLabel } from '../lib/regime.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import scoringRegistry from '../lib/scoring/features/index.mjs'
import { loadScoringConfig } from '../lib/scoring/config.mjs'
import { runScoringShadow } from '../lib/scoring/context.mjs'

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
  const { targets, nameOf, total, tradePrice, warnOf } = await getScanUniverse()
  if (!targets.length) { console.error('스캔 대상 없음 (마켓/유동성 조회 실패)'); process.exit(1) }
  console.log(`스캔 대상 ${targets.length}종목 (전체 ${total})`)

  // 코인게코 글로벌 데이터 (사이클 첫 스캐너가 갱신, 실패 시 중립 — 스캔 불사침)
  const cg = await ensureCgData(targets, { allowFetch: true })
  console.log(`코인게코 커버리지: ${(cg.coverage * 100).toFixed(0)}%`)

  // 시장 레짐: BTC 일봉 추세 (약세면 반등 매수 감점)
  const btcCandles = await getDayCandles('KRW-BTC', 200)
  const regime = btcRegime(btcCandles ? candlesToOhlcv(btcCandles) : [])
  console.log(`시장 레짐(BTC): ${regime.trend}`)

  const log = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  const priorScans = log.scans || []

  const candleMap = {}
  const buy = [], sell = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const candles = await getDayCandles(market, 200)
      if (!candles || candles.length < 60) return
      const ohlcv = candlesToOhlcv(candles)
      candleMap[market] = ohlcv
      const sig = detectSignals(ohlcv, weights)
      const pat = detectPatterns(ohlcv)
      for (const p of pat.buy) { sig.buy.push(p); sig.buyScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1) }
      for (const p of pat.sell) { sig.sell.push(p); sig.sellScore += (PATTERN_SCORE[p] || 0) * (weights[p] ?? 1) }

      const combo = applyCombos(sig.buy, sig.sell, sig.buyScore, sig.volRatio)
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
      // 레짐 게이트: BTC 약세장에선 반등 매수 신뢰도 하향
      if (regime.trend === 'bear') { finalBuyScore *= 0.85; buySignals = [...buySignals, '[레짐] BTC 약세 감점'] }
      // 유동성 차등 감점 (구간별 배수, 두 스캐너 공용 헬퍼)
      const { liqMult, lowLiq, label: liqLabel } = liquidityPenalty(tradePrice[market])
      if (liqMult < 1) { finalBuyScore *= liqMult; buySignals = [...buySignals, liqLabel] }
      // 업비트 단독 펌프 감점 (코인게코 글로벌 거래대금 대비 비중)
      const dom = upbitDominancePenalty(tradePrice[market], cg.byMarket[market]?.globalVolKrw)
      if (dom.mult < 1) { finalBuyScore *= dom.mult; buySignals = [...buySignals, dom.label] }
      // 떨어지는 칼 필터: 거래량 없는 과매도 GC + 하락배열이면 매수 감점
      const knife = fallingKnifePenalty(buySignals, sellSignals)
      if (knife.mult < 1) { finalBuyScore *= knife.mult; buySignals = [...buySignals, knife.label] }
      // 지속성 보너스 (이력 기반, 마지막 가산)
      const hasVolumeSurge = buySignals.some((s) => s.startsWith('거래량 급증'))
      const pers = scorePersistence({ market, hasVolumeSurge }, priorScans)
      finalBuyScore += pers.bonus
      if (pers.signals.length) buySignals = [...buySignals, ...pers.signals]

      const warn = warnOf[market] // 'warning'(경고) | 'caution'(주의) | undefined
      // 경고(상폐심사급)는 매수후보에서 제외. 주의는 ⚠️배지로 표시만.
      if (finalBuyScore >= BUY_THRESHOLD && warn !== 'warning') {
        const item = { market, korean_name: nameOf[market], price: sig.price, score: +finalBuyScore.toFixed(1), signals: buySignals }
        if (vbottomSL != null) item.vbottomSL = vbottomSL
        if (pumpSL != null) item.pumpSL = pumpSL
        if (lowLiq) item.lowLiquidity = true
        if (dom.share != null) item.dominance = { share: dom.share, mult: dom.mult }
        const cgE = cg.byMarket[market]
        if (cgE) item.cg = { circRatio: cgE.circRatio, athChangePct: cgE.athChangePct, rank: cgE.rank }
        if (warn) item.warn = warn
        buy.push(item)
      }
      if (sellScore >= SELL_THRESHOLD) {
        const item = { market, korean_name: nameOf[market], price: sig.price, score: +sellScore.toFixed(1), signals: sellSignals }
        if (warn) item.warn = warn // 매도/청산 신호는 유지하되 유의 표시
        sell.push(item)
      }
    }))
    await sleep(DELAY)
  }

  buy.sort((a, b) => b.score - a.score)
  sell.sort((a, b) => b.score - a.score)

  const ratio = +(buy.length / Math.max(sell.length, 1)).toFixed(2)
  const regimeInfo = { trend: regime.trend, ratio, ...regimeLabel(ratio, regime.trend) }
  const entry = { timestamp: new Date().toISOString(), buy, sell, regime: regimeInfo }
  entry.cgCoverage = cg.coverage
  // 쉐도우 스코어링(신규 API 0, 실패해도 기존 스캔 불변). 기존 buy/sell/regime는 손대지 않는다.
  const tickerMap = Object.fromEntries(Object.keys(candleMap).map((m) => [m, { acc_trade_price_24h: tradePrice[m] }]))
  const buyMarkets = buy.map((b) => b.market)
  let scoringConfig = null
  try { scoringConfig = await loadScoringConfig(readJson, scoringRegistry) } catch (e) { console.warn('[scoring] config load failed:', e.message) }
  const shadow = runScoringShadow(Object.keys(candleMap), candleMap, tickerMap, { btcTrend: regime.trend }, scoringRegistry, scoringConfig, buyMarkets)
  if (shadow.scoringError) entry.scoringError = shadow.scoringError
  else { entry.scoring = shadow.scoring; entry.scoringMeta = shadow.scoringMeta }
  // 락 안에서 fresh 재읽기 → 증가 → 쓰기. 수동 실행이 정시 실행과 겹쳐도 갱신유실 없음.
  let scanNum
  await withLock('monitor-log', async () => {
    const fresh = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
    fresh.totalScans = (fresh.totalScans || 0) + 1
    fresh.scans = rollingAppend(fresh.scans || [], entry, MAX_SCANS)
    await writeJson('monitor-log.json', fresh)
    scanNum = fresh.totalScans
  })
  appendScan(entry)

  console.log(`스캔 #${scanNum} 완료 — 매수 ${buy.length} / 매도 ${sell.length}`)
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

// Telegram 알림 (환경변수 TELEGRAM_TOKEN, TELEGRAM_CHAT_ID 설정 시 메인 매수 상위 5개 전송)
async function notifyTelegram(buyList) {
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID || buyList.length === 0) return
  const main = buyList.filter((b) => !b.lowLiquidity)
  if (main.length === 0) return // 메인 매수 없으면 빈 알림 발송 안 함(저유동성 후보만 있을 때)
  const lowN = buyList.length - main.length
  const lines = main.slice(0, 5).map((b) => {
    const mtf = b.signals.includes('[MTF] 4시간봉 Stoch GC 확인') ? ' 📡MTF' : ''
    const stgc = b.signals.some((s) => s.includes('골든크로스')) ? ' 🟢GC' : ''
    const sl = b.vbottomSL != null ? ` 🎯SL:${b.vbottomSL}` : b.pumpSL != null ? ` 🚀SL:${b.pumpSL}` : ''
    return `• ${b.korean_name}(${b.market.replace('KRW-', '')}) score ${b.score.toFixed(1)}${stgc}${mtf}${sl}`
  })
  const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  const lowLine = lowN > 0 ? `\n\n⚠️ 저유동성 후보 ${lowN}개(별도)` : ''
  const msg = `🚨 업비트 스캔 ${when}\n메인 매수 ${main.length}개${lowLine}\n\n${lines.join('\n')}`
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
    })
  } catch { /* 네트워크 오류 시 무시 */ }
}

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 반등 스캔 실패: ${e.message}`); process.exit(1) })
