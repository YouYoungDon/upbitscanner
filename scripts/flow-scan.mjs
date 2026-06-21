import { getMinuteCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { getScanUniverse, BATCH, DELAY, sleep } from '../lib/scan-universe.mjs'
import { readJson, writeJson, rollingAppend } from '../lib/store.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import { shouldAlert, updateAlertState } from '../lib/flow-alert.mjs'
import {
  CONFIG, tradingValues, moneyRatio, moneyAcceleration, pctChange,
  isPumped, isEarlyZone, breakout20, near24hHigh, isConsolidationBreakout,
  emaAligned, rsiOk, scoreFlow, alertLevel,
} from '../lib/moneyflow.mjs'

const MAX_SCANS = 30
const FIVE_MIN_COUNT = 81 // 81개 조회 후 형성 중인 최신 봉 1개 제외 → 완성봉 80개
const LEVEL_EMOJI = { strong: '🔴', attention: '🟠', watch: '🟡' }

async function main() {
  const { targets, nameOf } = await getScanUniverse({ minTradePrice: CONFIG.minTradePrice24h })
  if (!targets.length) { console.error('자금유입 스캔 대상 없음'); process.exit(1) }
  console.log(`자금유입 스캔 대상 ${targets.length}종목 (24h≥${CONFIG.minTradePrice24h / 1e8}억)`)

  // BTC 5m 컨텍스트
  const btcC = await getMinuteCandles('KRW-BTC', 5, 3)
  const btcCloses = btcC ? candlesToOhlcv(btcC).map((c) => c.close) : []
  const btc5mRet = pctChange(btcCloses, 1)
  const btcFavorable = btc5mRet != null && btc5mRet > 0
  const btcBad = btc5mRet != null && btc5mRet < CONFIG.btcDropPct
  console.log(`BTC 5m: ${btc5mRet == null ? 'n/a' : btc5mRet.toFixed(2) + '%'} (${btcBad ? '약세감점' : btcFavorable ? '우호' : '중립'})`)

  // 24h 컨텍스트 티커
  const tickers = []
  for (let i = 0; i < targets.length; i += 100) { const t = await getTicker(targets.slice(i, i + 100)); if (t) tickers.push(...t); await sleep(DELAY) }
  const high24hOf = Object.fromEntries(tickers.map((t) => [t.market, t.high_price]))
  const ch24hOf = Object.fromEntries(tickers.map((t) => [t.market, (t.signed_change_rate ?? 0) * 100]))

  const picks = []
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH)
    await Promise.all(chunk.map(async (market) => {
      const c5 = await getMinuteCandles(market, 5, FIVE_MIN_COUNT)
      if (!c5 || c5.length < CONFIG.moneyWindow + 3) return
      const o5 = candlesToOhlcv(c5).slice(0, -1) // 형성 중인 최신 봉 제외(완성봉만 사용)
      const closes5 = o5.map((c) => c.close)
      const values = tradingValues(o5)
      const value5m = values.at(-1)
      if (value5m < CONFIG.min5mValue) return

      const ch5m = pctChange(closes5, 1)
      const ch15m = pctChange(closes5, 3)
      const ch30m = pctChange(closes5, 6)
      if (isPumped(ch5m, ch15m)) return

      const c1 = await getMinuteCandles(market, 1, 3)
      const closes1 = c1 ? candlesToOhlcv(c1).map((c) => c.close) : []
      const ch1m = pctChange(closes1, 1)

      const ratio = moneyRatio(values)
      const accel = moneyAcceleration(values)
      const price = closes5.at(-1)
      const breakout = breakout20(o5)
      const consol = isConsolidationBreakout(o5)
      const near24h = near24hHigh(price, high24hOf[market])
      const emaOK = emaAligned(closes5)
      const rsiOK = rsiOk(closes5)
      const early = isEarlyZone(ch1m, ch30m)
      const { score, parts } = scoreFlow({ ratio, accel, value5m, breakout, near24h, emaOK, rsiOK, early, btcFavorable, btcBad })
      const level = alertLevel({ ratio, breakout, btcFavorable })
      if (!level) return

      picks.push({
        market, korean_name: nameOf[market], price, score, level, parts,
        ratio: ratio == null ? null : +ratio.toFixed(2),
        accel: accel == null ? null : +accel.toFixed(2),
        value5m, ch1m, ch5m, ch15m, ch30m, ch24h: ch24hOf[market] ?? null,
        breakout, consol, near24h, emaOK,
        rsi: rsiOK,
      })
    }))
    await sleep(DELAY)
  }

  picks.sort((a, b) => b.score - a.score || (b.ratio ?? 0) - (a.ratio ?? 0) || (b.breakout ? 1 : 0) - (a.breakout ? 1 : 0))

  const entry = { timestamp: new Date().toISOString(), btc: { ret: btc5mRet, favorable: btcFavorable, bad: btcBad }, picks }
  const log = await readJson('flow-log.json', { started: new Date().toISOString(), totalScans: 0, scans: [] })
  log.totalScans = (log.totalScans || 0) + 1
  log.scans = rollingAppend(log.scans || [], entry, MAX_SCANS)
  await writeJson('flow-log.json', log)

  const counts = { strong: 0, attention: 0, watch: 0 }
  for (const p of picks) counts[p.level]++
  console.log(`자금유입 스캔 #${log.totalScans} — 🔴${counts.strong} 🟠${counts.attention} 🟡${counts.watch}`)
  console.log('상위:', picks.slice(0, 5).map((p) => `${p.korean_name}(${p.score})`).join(', ') || '없음')

  await notifyFlow(picks)
}

async function notifyFlow(picks) {
  const now = Date.now()
  let state = await readJson('flow-alert-state.json', {})
  const fire = picks.filter((p) => (p.level === 'strong' || p.level === 'attention') && shouldAlert({ market: p.market, score: p.score, now }, state, CONFIG))
  for (const p of fire) state = updateAlertState(state, p.market, p.score, now)
  await writeJson('flow-alert-state.json', state)
  if (!fire.length) return
  const lines = fire.map((p) => `${LEVEL_EMOJI[p.level]} ${p.korean_name}(${p.market.replace('KRW-', '')}) ${p.score}점 · 머니 ${p.ratio}x${p.accel ? ` ·가속 ${p.accel}x` : ''}${p.breakout ? ' ·돌파' : ''}`)
  const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
  await sendTelegram(`💸 자금유입 ${when}\n\n${lines.join('\n')}`)
}

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 자금유입 스캔 실패: ${e.message}`); process.exit(1) })
