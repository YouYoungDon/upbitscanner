import '../lib/env.mjs' // .env 로드(스케줄러 환경 캐시 미스 대비) — Telegram 알림 토큰 확보
import { getDayCandles, getMinuteCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcvAsOf, confirmedOhlcvByPeriod } from '../lib/ohlcv.mjs'
import { readPositions, evalPositions } from '../lib/positions.mjs'
import { detectSignals, detectPatterns, applyCombos, PATTERN_SCORE } from '../lib/signals.mjs'
import { detectLiquiditySweep, detectVBottom } from '../lib/smc-signals.mjs'
import { detectQuietBottom, strategyLevels } from '../lib/strategy.mjs'
import { calcStochastic } from '../lib/indicators.mjs'
import { readJson, writeJson, rollingAppend, withLock, readWeights } from '../lib/store.mjs'
import { appendScan } from '../lib/archive.mjs'
import { getScanUniverse, BATCH, DELAY, sleep } from '../lib/scan-universe.mjs'
import { ensureCgData } from '../lib/cg-data.mjs'
import { scorePersistence } from '../lib/persistence.mjs'
import { btcRegime, regimeLabel } from '../lib/regime.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import { ensureKimchi, premiumBand, splitPremiumHot, premiumHotList } from '../lib/kimchi.mjs'
import { selectPremiumAlerts, formatPremiumAlert } from '../lib/premium-alert.mjs'
import { ensureFunding } from '../lib/funding.mjs'
import { ensureEvents } from '../lib/exchange-events.mjs'
import { applyBuyModifiers } from '../lib/buy-modifiers.mjs'
import { readableSignals } from '../lib/signal-format.mjs'
import scoringRegistry from '../lib/scoring/features/index.mjs'
import { loadScoringConfig } from '../lib/scoring/config.mjs'
import { runScoringShadow } from '../lib/scoring/context.mjs'
import { newsDaemonStale } from '../lib/news/health.mjs'

const MAX_SCANS = 30
const BUY_THRESHOLD = 5
const SELL_THRESHOLD = 3

// 멀티 타임프레임: 4시간봉 Stoch 골든크로스 확인 (반등 신뢰도 보강)
async function check4hStochGC(market) {
  const candles = await getMinuteCandles(market, 240, 61)
  if (!Array.isArray(candles) || candles.length < 31) return false
  const ohlcv = confirmedOhlcvByPeriod(candlesToOhlcv(candles), Date.now(), 240 * 60)
  const stoch = calcStochastic(ohlcv.map((c) => c.high), ohlcv.map((c) => c.low), ohlcv.map((c) => c.close))
  return stoch ? stoch.k < 20 && stoch.prevK < stoch.prevD && stoch.k > stoch.d : false
}

async function main() {
  const weights = await readWeights()
  const strategyConfig = await readJson('strategy-config.json', null) // 없으면 전략 태깅 스킵
  // 일반 청산 레벨(백테스트로 확정) — 학습구간이 레짐 라벨 457스캔 중 456이 하락장(99.8%)
  // 이었던 점을 기억할 것(data/exit-backtest-report.json의 regime.train = {bear:456, neutral:1}).
  // 그 구간에서는 7일 단순보유 대비 우위였지만, 불장 비중이 높은 홀드아웃에서는
  // 평균수익률이 7일보유보다 3.31%p 낮았다(중앙값은 오히려 개선). 즉 참고용 기준치이며 보증이 아니다.
  const exitConfig = await readJson('exit-config.json', null) // 없으면 일반 청산 레벨 생략(스캔 불사침)
  const { targets, nameOf, total, tradePrice, warnOf } = await getScanUniverse()
  if (!targets.length) { console.error('스캔 대상 없음 (마켓/유동성 조회 실패)'); process.exit(1) }
  console.log(`스캔 대상 ${targets.length}종목 (전체 ${total})`)

  // 코인게코 글로벌 데이터 (사이클 첫 스캐너가 갱신, 실패 시 중립 — 스캔 불사침)
  const cg = await ensureCgData(targets, { allowFetch: true })
  console.log(`코인게코 커버리지: ${(cg.coverage * 100).toFixed(0)}%${cg.reason ? ` (${cg.reason})` : ''}`)

  // 펀딩비 (바이낸스 무기한, 점수 개입 — 루프 전에 조회). 실패 시 중립(mult 1) — 스캔 불사침.
  const funding = await ensureFunding(targets, {})
  console.log(`펀딩 커버리지: ${(funding.coverage * 100).toFixed(0)}%${funding.reason ? ` (${funding.reason})` : ''}`)

  // 거래소 이벤트 방어 (업비트+바이낸스 공지 — 상폐·유의·입출금중단·마이그레이션). 실패 시 중립 — 스캔 불사침.
  const events = await ensureEvents(targets, { positions: readPositions() })
  console.log(`거래소이벤트: ${Object.keys(events.byMarket).length}종목${events.reason ? ` (${events.reason})` : ''}`)

  // 시장 레짐: BTC 일봉 추세 (약세면 반등 매수 감점)
  const btcCandles = await getDayCandles('KRW-BTC', 201)
  const scanStart = Date.now()
  const regime = btcRegime(btcCandles ? confirmedOhlcvAsOf(candlesToOhlcv(btcCandles), scanStart) : [])
  console.log(`시장 레짐(BTC): ${regime.trend}`)

  const log = await readJson('monitor-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  const priorScans = log.scans || []

  const candleMap = {}
  const buy = [], sell = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const candles = await getDayCandles(market, 201)
      if (!candles || candles.length < 61) return
      const ohlcv = candlesToOhlcv(candles)
      // 신호 판정은 확정봉만. 날짜 인지 버전을 쓴다: 09:00 정각 스캔에서 아직 당일 체결이 없는 코인은
      // 마지막 봉이 '어제 확정봉'인데, 무조건 마지막을 버리는 confirmedOhlcv는 그걸 버려 그저께 봉으로 판정했다.
      const confirmed = confirmedOhlcvAsOf(ohlcv, scanStart)
      if (confirmed.length < 60) return
      candleMap[market] = confirmed // 쉐도우 스코어링 입력도 확정봉(형성봉은 시각에 따라 거래량이 출렁여 피처 오염)
      // 알림·SL/TP·스코어카드 진입가는 '지금 살 수 있는 가격'. 확정 종가는 최대 ~21시간 묵은 값이다.
      const livePrice = ohlcv.at(-1).close
      const sig = detectSignals(confirmed, weights)
      const pat = detectPatterns(confirmed)
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
      let vbottomSL
      const sweep = detectLiquiditySweep(confirmed)
      const vbottom = detectVBottom(confirmed)
      if (sweep.side === 'buy') { finalBuyScore += sweep.score; buySignals = [...buySignals, `유동성 스윕 (깊이 ${sweep.depthPct}%)`] }
      if (sweep.side === 'sell') { sellScore += sweep.score; sellSignals = [...sellSignals, `유동성 스윕 고점 (깊이 ${sweep.depthPct}%)`] }
      if (vbottom) { finalBuyScore += vbottom.score; buySignals = [...buySignals, `🎯V-Bottom (RSI${vbottom.rsi9}·꼬리${vbottom.wickRatio}%)`]; vbottomSL = vbottom.stopLoss }
      // 🚀Pump Start(+7)는 2026-10-07 제거 — 돌파+거래량 급증이라 거래량 급증 매수와 같은 이유(재생 단일 제거 악화 0/12).
      // 배수군 일괄 적용 (레짐·유동성·dominance·낙하칼·추격·펀딩·구조리스크) — lib/buy-modifiers, 순서·배수 동일.
      const cgE0 = cg.byMarket[market]
      const evE = events.byMarket[market]
      // 업비트 유의지정은 warnOf(구조리스크 ×0.90)과 유의 공지(eventRisk ×0.5) 두 경로로 들어와
      // 같은 사건을 중복 감점(×0.45)한다. 이벤트 caution이 활성이면 더 구체적·강한 그쪽이 소유하고
      // 구조리스크 caution은 억제(이벤트 만료 후엔 warnOf가 다시 담당).
      const hasEventCaution = evE?.events?.some((e) => e.type === 'caution')
      const mods = applyBuyModifiers(finalBuyScore, buySignals, {
        regimeTrend: regime.trend, tradePrice24h: tradePrice[market], globalVolKrw: cgE0?.globalVolKrw,
        sellSignals,
        fundingRate: funding.byMarket[market]?.rate,
        circRatio: cgE0?.circRatio, athChangePct: cgE0?.athChangePct, rank: cgE0?.rank,
        caution: warnOf[market] === 'caution' && !hasEventCaution,
        eventRisk: evE,
      })
      finalBuyScore = mods.score
      buySignals = mods.signals
      const { lowLiq, dom } = mods
      const fundRate = mods.funding.rate, fundMult = mods.funding.mult
      const sr = mods.structuralRisk
      // 지속성 보너스 (이력 기반, 마지막 가산)
      const pers = scorePersistence({ market }, priorScans, scanStart)
      finalBuyScore += pers.bonus
      if (pers.signals.length) buySignals = [...buySignals, ...pers.signals]
      // 조용한 바닥 전략 태깅 (표시 전용 — 점수 불변)
      let strategyLv = null
      if (strategyConfig) {
        const qb = detectQuietBottom(confirmed, strategyConfig)
        if (qb) {
          const lv = strategyLevels(livePrice, strategyConfig)
          if (lv) {
            // 풀 정밀도 저장 (vbottomSL과 동일 정책) — 0.0x원대 코인에서 toFixed(2)는 손절=목표로 붕괴
            strategyLv = { stopLoss: lv.stopLoss, takeProfit: lv.takeProfit }
            buySignals = [...buySignals, '🎯전략(조용한바닥)']
          }
        }
      }

      const warn = warnOf[market] // 'warning'(경고) | 'caution'(주의) | undefined
      // 경고(상폐심사급)는 매수후보에서 제외. 주의는 ⚠️배지로 표시만.
      if (finalBuyScore >= BUY_THRESHOLD && warn !== 'warning') {
        const item = { market, korean_name: nameOf[market], price: livePrice, priceBasis: 'live', score: +finalBuyScore.toFixed(1), signals: buySignals }
        if (vbottomSL != null) item.vbottomSL = vbottomSL
        if (lowLiq) item.lowLiquidity = true
        if (strategyLv) item.strategy = strategyLv
        if (exitConfig) {
          const el = strategyLevels(livePrice, exitConfig)
          // 풀 정밀도 저장 — 0.0x원대 코인에서 반올림하면 손절=목표로 붕괴한다.
          if (el) {
            item.exit = {
              slPct: exitConfig.slPct, tpPct: exitConfig.tpPct, holdMax: exitConfig.holdMax,
              stopLoss: el.stopLoss, takeProfit: el.takeProfit, cfgVersion: exitConfig.version,
            }
          }
        }
        if (dom.share != null) item.dominance = { share: dom.share, mult: dom.mult }
        if (fundRate != null) item.funding = { rate: fundRate, mult: fundMult }
        if (sr.flags.length) item.structuralRisk = { mult: sr.mult, flags: sr.flags, level: sr.level }
        if (evE) item.event = { mult: evE.mult, label: evE.label, types: evE.events.map((e) => ({ type: e.type, exchange: e.exchange })) }
        const cgE = cg.byMarket[market]
        if (cgE) item.cg = { circRatio: cgE.circRatio, athChangePct: cgE.athChangePct, rank: cgE.rank }
        if (warn) item.warn = warn
        buy.push(item)
      }
      if (sellScore >= SELL_THRESHOLD) {
        const item = { market, korean_name: nameOf[market], price: livePrice, priceBasis: 'live', score: +sellScore.toFixed(1), signals: sellSignals }
        if (warn) item.warn = warn // 매도/청산 신호는 유지하되 유의 표시
        sell.push(item)
      }
    }))
    await sleep(DELAY)
  }

  sell.sort((a, b) => b.score - a.score)

  // 김치 프리미엄 (라이브 업비트 vs 바이낸스) — 스캔 전 종목 + 보유 코인. 티커 1콜 + 바이낸스 1콜.
  // BTC 대비 +3%p 이상(국내 과열)은 매수 목록에서 분리한다(lib/kimchi.mjs splitPremiumHot 주석의 측정 근거).
  // 조회 실패면 아무것도 빼지 않는다.
  const held = readPositions()
  const kimchi = await ensureKimchi([...new Set(['KRW-BTC', ...Object.keys(candleMap), ...buy.map((b) => b.market), ...held.map((p) => p.market)])])
  const split = splitPremiumHot(buy, kimchi)
  buy.length = 0
  buy.push(...split.keep)
  buy.sort((a, b) => b.score - a.score)
  const premiumHot = split.hot.sort((a, b) => b.score - a.score)

  const ratio = +(buy.length / Math.max(sell.length, 1)).toFixed(2)
  const regimeInfo = { trend: regime.trend, ratio, ...regimeLabel(ratio, regime.trend) }
  const entry = { timestamp: new Date().toISOString(), buy, sell, regime: regimeInfo }
  entry.cgCoverage = cg.coverage
  if (cg.fetchedAt) entry.cgFetchedAt = cg.fetchedAt
  if (cg.reason) entry.cgReason = cg.reason
  entry.kimchi = { btcPremium: kimchi.btcPremium, band: premiumBand(kimchi.btcPremium), usdtKrw: kimchi.usdtKrw, coverage: kimchi.coverage,
    hot: premiumHotList(kimchi, nameOf) } // 전 종목 국내 과열 목록(대시보드 카드)
  entry.premiumHot = premiumHot // 매수 조건은 맞았지만 국내 과열로 빠진 코인
  if (kimchi.reason) entry.kimchi.reason = kimchi.reason
  entry.funding = { medianRate: funding.medianRate, coverage: funding.coverage }
  if (funding.reason) entry.funding.reason = funding.reason
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
    appendScan(entry)
    scanNum = fresh.totalScans
  })

  console.log(`스캔 #${scanNum} 완료 — 매수 ${buy.length} / 매도 ${sell.length}`)
  if (premiumHot.length) console.log('🇰🇷 국내 과열 제외:', premiumHot.map((b) => `${b.korean_name}(BTC+${(b.kimchi.rel * 100).toFixed(1)}%p)`).join(', '))
  console.log('매수 상위:', buy.slice(0, 5).map((b) => `${b.korean_name}(${b.score})`).join(', ') || '없음')

  await notifyTelegram(buy, { regime: regimeInfo, buyCount: buy.length, sellCount: sell.length, kimchi: entry.kimchi, funding: entry.funding, premiumHot })
  await notifyEventAlerts(events)
  await notifyPositionAlerts()
  await notifyPremiumAlerts(held, kimchi)
  await warnNewsDaemonStale()
}

// 보유 코인 국내 과열 → 텔레그램(코인당 24시간 1회). 보유가 없으면 조용.
async function notifyPremiumAlerts(held, kimchi) {
  if (!held.length) return
  const prev = await readJson('premium-alert-state.json', {})
  const { fires, state } = selectPremiumAlerts(held, kimchi, prev, Date.now())
  if (!fires.length) return
  const msg = formatPremiumAlert(fires)
  console.log(msg)
  const TG_TOKEN = process.env.TELEGRAM_TOKEN, TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  // 전송 실패면 상태를 남기지 않아 다음 스캔에서 다시 시도한다
  if (TG_TOKEN && TG_CHAT_ID && !(await sendTelegram(msg))) return
  await writeJson('premium-alert-state.json', state)
}

// 이번 스캔에서 처음 감지된 거래소 이벤트 → 콘솔 + Telegram 즉시 경보
async function notifyEventAlerts(events) {
  const list = events?.newEvents || []
  if (!list.length) return
  const TYPE_KO = { delist: '상장폐지', caution: '유의지정', halt: '입출금중단', resume: '재개/해제' }
  const EX_KO = { upbit: '업비트', binance: '바이낸스', bithumb: '빗썸' }
  const lines = list.map((e) => `🚨 ${e.markets.map((m) => m.replace('KRW-', '')).join(',')} — ${TYPE_KO[e.type] || e.type}(${EX_KO[e.exchange] || e.exchange})\n   ${e.title}`)
  const msg = `🚨 [거래소 이벤트] ${list.length}건\n${lines.join('\n')}`
  console.log(msg)
  const TG_TOKEN = process.env.TELEGRAM_TOKEN, TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (TG_TOKEN && TG_CHAT_ID) await sendTelegram(msg)
}

// news-watch 데몬 생존 점검: 10분 넘게 사이클이 없으면 하루 1회 경고(설치 전이면 조용).
async function warnNewsDaemonStale() {
  const st = await readJson('news-state.json', null)
  const health = await readJson('news-watch-health.json', {})
  const r = newsDaemonStale(st, health, Date.now())
  if (!r.warn) return
  console.log('⚠️ 뉴스 데몬 정지 — 마지막 사이클', st.lastLoopAt)
  if (await sendTelegram(`⚠️ 뉴스 데몬 정지 — 마지막 사이클 ${st.lastLoopAt}\n작업 스케줄러 UpbitNewsWatch 상태를 확인하세요.`)) await writeJson('news-watch-health.json', r.health)
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
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* 무시 */ }
}

// Telegram 알림 — 매수 상위 5종을 근거·경고와 함께 전송 (HTML)
async function notifyTelegram(buyList, ctx = {}) {
  const TG_TOKEN = process.env.TELEGRAM_TOKEN
  const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!TG_TOKEN || !TG_CHAT_ID || buyList.length === 0) return
  const main = buyList.filter((b) => !b.lowLiquidity)
  if (main.length === 0) return // 메인 매수 없으면 빈 알림 발송 안 함(저유동성 후보만)
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fmt = (n) => (Math.abs(n) >= 1 ? Number(n).toLocaleString('ko-KR') : Number(n).toPrecision(3))

  const readable = main.map((b) => readableSignals(b.signals)) // 픽당 1회만 파싱(블록·tip 공용)
  const blocks = main.slice(0, 5).map((b, i) => {
    const { reasons, warns, strategy } = readable[i]
    const tkr = b.market.replace('KRW-', '')
    const head = `<b>${i + 1}. ${esc(b.korean_name)}</b> (${tkr}) · ${b.score.toFixed(1)}점 · ${fmt(b.price)}원`
    const lines = [head]
    if (reasons.length) lines.push(`  📈 ${esc(reasons.join(', '))}`)
    if (strategy && b.strategy) lines.push(`  🎯 조용한바닥 · 손절 ${fmt(b.strategy.stopLoss)} / 목표 ${fmt(b.strategy.takeProfit)}`)
    else if (b.vbottomSL != null) lines.push(`  🎯 V바텀 손절 ${fmt(b.vbottomSL)}`)
    else if (b.exit) lines.push(`  📐 청산 · 손절 ${fmt(b.exit.stopLoss)} / 목표 ${fmt(b.exit.takeProfit)} (${b.exit.holdMax}일)`)
    if (warns.length) lines.push(`  ⚠️ ${esc(warns.join(' · '))}`)
    if (b.kimchi?.flag === 'overheat') lines.push(`  🇰🇷 국내 과열(추격 위험) · 김치프 ${(b.kimchi.premium * 100).toFixed(1)}%`)
    else if (b.kimchi?.flag === 'discount') lines.push(`  💧 국내 디스카운트 · 김치프 ${(b.kimchi.premium * 100).toFixed(1)}%`)
    return lines.join('\n')
  })

  const now = new Date()
  const datePart = now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' })
  const timePart = now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
  const r = ctx.regime || {}
  const marketLine = r.ratio != null
    ? `${r.emoji || ''} 시장심리 ${r.ratio} (${r.label || r.trend || '-'}) · 매수 ${ctx.buyCount}/매도 ${ctx.sellCount}`
    : `매수 ${ctx.buyCount ?? main.length}건`
  const k = ctx.kimchi
  const kBand = { overheat: '과열🔴', discount: '디스카운트🔵', normal: '보통🟡' }[k?.band] || ''
  const kimchiLine = k && k.btcPremium != null
    ? `\n🇰🇷 김치프리미엄 ${k.btcPremium >= 0 ? '+' : ''}${(k.btcPremium * 100).toFixed(2)}% ${kBand}`
    : ''
  const f = ctx.funding
  const fundingLine = f && f.medianRate != null
    ? `\n⚡ 시장 펀딩 ${f.medianRate >= 0 ? '+' : ''}${(f.medianRate * 100).toFixed(4)}% (중앙값)`
    : ''
  const lowN = buyList.length - main.length
  const lowLine = (lowN > 0 ? `\n<i>저유동성 후보 ${lowN}개는 별도(알림 제외)</i>` : '') +
    (ctx.premiumHot?.length ? `\n<i>🇰🇷 국내 과열(BTC 대비 +3%p↑) ${ctx.premiumHot.length}개 제외: ${ctx.premiumHot.slice(0, 3).map((b) => esc(b.korean_name)).join(', ')}</i>` : '')
  const tip = readable.some((r) => r.warns.some((w) => w.includes('추격')))
    ? '\n\n💡 ⚠️추격주의는 급등 후 진입 — 통계상 불리(관망 권장)'
    : ''
  const header = `🔔 <b>업비트 매수 신호</b>\n🗓 <b>${esc(datePart)}</b>  ⏰ <b>${esc(timePart)}</b>`
  const msg = `${header}\n━━━━━━━━━━━━━━\n${esc(marketLine)}${kimchiLine}${fundingLine}${lowLine}\n\n${blocks.join('\n\n')}${tip}`
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch { /* 네트워크 오류 시 무시 */ }
}

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 반등 스캔 실패: ${e.message}`); process.exit(1) })
