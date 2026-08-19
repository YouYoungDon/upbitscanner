// 텔레그램 명령형 봇 — getUpdates 롱폴링. 조회 전용. chat_id 화이트리스트.
// 실행: npm run bot (또는 작업 스케줄러 로그인 시 시작)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getMarkets, getDayCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcvAsOf } from '../lib/ohlcv.mjs'
import { analyzeMarket } from '../lib/analyze.mjs'
import { detectQuietBottom } from '../lib/strategy.mjs'
import { readJson, readWeights } from '../lib/store.mjs'
import { buildScorecard } from '../server/api.mjs'
import {
  parseCommand, resolveSymbol,
  formatCoin, formatStatus, formatStrategy, formatPositions, formatScorecard, formatHelp, formatNotFound,
} from '../lib/bot-commands.mjs'

const TOKEN = process.env.TELEGRAM_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID
const API = `https://api.telegram.org/bot${TOKEN}`
const LOCAL = 'http://127.0.0.1:8787'
const __dirname = dirname(fileURLToPath(import.meta.url))

if (!TOKEN || !CHAT_ID) { console.error('TELEGRAM_TOKEN/CHAT_ID 미설정 — 봇 종료'); process.exit(0) }

async function tg(method, body) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    })
    return await r.json()
  } catch { return null }
}

async function send(text) {
  await tg('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
}

// 로컬 8787 우선, 실패 시 null (호출부가 파일 폴백)
async function localApi(path) {
  try {
    const r = await fetch(`${LOCAL}${path}`, { signal: AbortSignal.timeout(3_000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function handleCoin(arg) {
  const markets = await getMarkets()
  if (!markets.length) return '업비트 응답 없음, 잠시 후 재시도'
  const res = resolveSymbol(arg, markets)
  if (res.notFound) return formatNotFound(arg, res.suggestions)
  const candles = await getDayCandles(res.market, 120)
  if (!candles) return '업비트 캔들 조회 실패, 잠시 후 재시도'
  const confirmed = confirmedOhlcvAsOf(candlesToOhlcv(candles), Date.now())
  const weights = await readWeights()
  const a = analyzeMarket(confirmed, { weights })
  const cfg = await readJson('strategy-config.json', null)
  const quietBottom = cfg ? detectQuietBottom(confirmed, cfg) : null
  // 실시간가 조회(확정 종가가 아니라 지금 가격 표시·90일 위치 계산에 사용)
  const [tk] = await getTicker([res.market]) || []
  const price = tk?.trade_price ?? a.indicators.price
  const lows = confirmed.map((c) => c.low), highs = confirmed.map((c) => c.high)
  const min = Math.min(...lows.slice(-90)), max = Math.max(...highs.slice(-90))
  // 실시간가가 확정 90일 범위를 벗어날 수 있어 0~100으로 클램프(신저점이면 0%)
  const pos90 = max > min ? Math.max(0, Math.min(100, ((price - min) / (max - min)) * 100)) : 0
  const mk = markets.find((m) => m.market === res.market)
  const cautions = mk?.caution ? ['주의지정'] : []
  return formatCoin({
    korean_name: res.korean_name, market: res.market, price,
    indicators: a.indicators, quietBottom,
    designation: { warning: !!mk?.warning, cautions }, pos90,
  })
}

async function handleStatus() {
  const api = await localApi('/api/results')
  if (api && !api.empty) {
    const regime = api.regime || {}
    return formatStatus({
      ratio: regime.ratio ?? null, trend: regime.trend ?? 'neutral',
      buyCount: api.kpi?.buyCount ?? (api.buy || []).length,
      sellCount: api.kpi?.sellCount ?? (api.sell || []).length,
      topBuy: api.buy || [],
    })
  }
  // 파일 폴백: 아카이브 최신 스캔
  const log = await readJson('monitor-log.json', { scans: [] })
  const scan = log.scans?.at(-1)
  if (!scan) return '스캔 데이터 없음'
  const regime = scan.regime || {}
  const buy = (scan.buy || []).filter((b) => !b.lowLiquidity)
  return formatStatus({
    ratio: regime.ratio ?? null, trend: regime.trend ?? 'neutral',
    buyCount: (scan.buy || []).length, sellCount: (scan.sell || []).length,
    topBuy: buy,
  })
}

// 로컬 API 우선, 실패 시 파일을 buildScorecard로 가공(전략·지평선 계산이 API와 동일하게 나오도록)
async function scorecardData() {
  return await localApi('/api/scorecard') || buildScorecard(await readJson('scorecard.json', { episodes: [] }))
}

async function handleStrategy() {
  const sc = await scorecardData()
  const s = sc.strategy || null
  if (!s) return '🎯 전략 에피소드 없음'
  const openList = (sc.episodes || []).filter((e) => e.strategyOutcome?.reason === 'open').slice(0, 8)
  return formatStrategy({ ...s, openList })
}

async function handlePositions() {
  const p = await localApi('/api/positions')
  const list = Array.isArray(p) ? p : (p?.positions || [])
  return formatPositions(list)
}

async function handleScorecard() {
  const sc = await scorecardData()
  if (!sc || sc.empty) return '📊 스코어카드 데이터 없음'
  return formatScorecard({ ...sc.horizons, total: sc.total, pendingCount: sc.pendingCount })
}

function handleScan() {
  // 기존 스캔 스크립트를 그대로 실행 — monitor.mjs가 자체 리치 알림을 발송한다.
  const child = spawn(process.execPath, [join(__dirname, 'monitor.mjs')], {
    cwd: join(__dirname, '..'), stdio: 'ignore', detached: true, env: process.env,
  })
  child.unref()
}

async function dispatch(cmd, arg) {
  switch (cmd) {
    case 'scan': await send('⏳ 스캔 중… (완료되면 결과 알림이 옵니다)'); handleScan(); return null
    case 'coin': return arg ? await handleCoin(arg) : '사용법: /코인 SOPH'
    case 'status': return await handleStatus()
    case 'strategy': return await handleStrategy()
    case 'positions': return await handlePositions()
    case 'scorecard': return await handleScorecard()
    default: return formatHelp()
  }
}

async function loop() {
  console.log('텔레그램 봇 시작 — 롱폴링')
  // 시작 시 밀린 메시지 건너뛰기(스팸 방지): 최신 offset 확보
  let offset = 0
  const init = await tg('getUpdates', { timeout: 0, offset: -1 })
  if (init?.result?.length) offset = init.result.at(-1).update_id + 1
  for (;;) {
    const upd = await tg('getUpdates', { timeout: 25, offset })
    if (upd?.error_code === 409) { // 다른 봇 인스턴스가 동시에 폴링 중 — 충돌 명시
      console.error('⚠️ getUpdates 409 충돌 — 다른 봇 인스턴스가 실행 중일 수 있음. 15초 후 재시도')
      await new Promise((r) => setTimeout(r, 15_000)); continue
    }
    if (!upd?.ok) { await new Promise((r) => setTimeout(r, 5_000)); continue }
    for (const u of upd.result) {
      offset = u.update_id + 1
      const msg = u.message
      if (!msg || !msg.text) continue
      if (String(msg.chat.id) !== String(CHAT_ID)) { console.log('무시(비인가 chat):', msg.chat.id); continue }
      const parsed = parseCommand(msg.text)
      if (!parsed) continue
      try {
        const reply = await dispatch(parsed.cmd, parsed.arg)
        if (reply) await send(reply)
      } catch (e) {
        console.error('명령 처리 오류:', e.message)
        await send('⚠️ 처리 중 오류가 났어요. 잠시 후 다시 시도해주세요.')
      }
    }
  }
}

loop()
