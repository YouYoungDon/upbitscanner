// scripts/news-watch.mjs
// 뉴스·공지 감시 상주 데몬. 60초마다 runCycle(소스별 주기는 lib/news/cycle.mjs).
// 실행: node scripts/news-watch.mjs (작업 스케줄러 UpbitNewsWatch가 로그인 시 시작)
import '../lib/env.mjs'
import { getMarkets } from '../lib/upbit.mjs'
import { readJson, writeJson, withLock } from '../lib/store.mjs'
import { readPositions } from '../lib/positions.mjs'
import { ensureEvents } from '../lib/exchange-events.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import { fetchCoinness } from '../lib/news/sources/coinness.mjs'
import { fetchBithumbNotices } from '../lib/news/sources/bithumb.mjs'
import { fetchUpbitNews, fetchBinanceNews } from '../lib/news/sources/exchanges.mjs'
import { appendNewsLog } from '../lib/news/store.mjs'
import { runCycle } from '../lib/news/cycle.mjs'

const LOOP_MS = 60000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let marketsCache = { at: 0, list: [] }
async function cachedMarkets() {
  if (Date.now() - marketsCache.at < 3600000 && marketsCache.list.length) return marketsCache.list
  const list = await getMarkets()
  if (list && list.length) marketsCache = { at: Date.now(), list }
  return marketsCache.list
}

async function readCtx() {
  const positions = readPositions()
  const monitor = await readJson('monitor-log.json', { scans: [] })
  const momentum = await readJson('momentum-log.json', { scans: [] })
  const candidates = new Set([...(monitor.scans?.at(-1)?.buy || []), ...(momentum.scans?.at(-1)?.picks || [])].map((x) => x.market))
  return { held: new Set(positions.map((p) => p.market)), candidates, positions }
}

const deps = {
  fetchers: { coinness: fetchCoinness, upbit: fetchUpbitNews, binance: fetchBinanceNews, bithumb: fetchBithumbNotices },
  getMarkets: cachedMarkets,
  readCtx,
  ensureEvents,
  appendLog: (records) => appendNewsLog(records),
  send: sendTelegram,
  whenLabel: (ms) => new Date(ms).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }),
}

async function once() {
  await withLock('news-state', async () => {
    const state = await readJson('news-state.json', null)
    const r = await runCycle({ state, nowMs: Date.now(), deps })
    await writeJson('news-state.json', r.state)
    if (r.newCount || r.sent || r.notices.length) console.log(`${new Date().toISOString()} 새 ${r.newCount} · 알림 ${r.sent}${r.notices.length ? ' · ' + r.notices.join(' / ') : ''}`)
  })
}

console.log(`${new Date().toISOString()} news-watch 시작`)
for (;;) {
  const t0 = Date.now()
  try { await once() } catch (e) { console.error(`${new Date().toISOString()} 사이클 실패:`, e?.message || e) }
  await sleep(Math.max(1000, LOOP_MS - (Date.now() - t0)))
}
