import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson } from '../lib/store.mjs'
import { getMarkets, getDayCandles, getMinuteCandles, getTicker, candlesToOhlcv } from '../lib/upbit.mjs'
import { analyzeMarket } from '../lib/analyze.mjs'
import { buildResults, buildInsights, buildVerify, buildHistory, buildScans, findScanByTimestamp, buildMomentum } from './api.mjs'
import { createScanRunner } from './scan-job.mjs'
import { readArchive, coinHistory, ARCHIVE } from '../lib/archive.mjs'
import { readPositions, evalPositions } from '../lib/positions.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const PORT = process.env.DASHBOARD_PORT || 8787
const runner = createScanRunner()

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

// 마켓 목록 캐시 (1시간) — 거의 안 바뀌므로 매 요청마다 업비트 호출 방지
let marketsCache = { at: 0, data: null }
async function cachedMarkets() {
  if (marketsCache.data && Date.now() - marketsCache.at < 3600_000) return marketsCache.data
  const list = await getMarkets()
  if (list.length) marketsCache = { at: Date.now(), data: list }
  return marketsCache.data || []
}

// 아카이브 mtime 캐시 — 파일 안 바뀌면 재파싱 안 함
let archiveCache = { mtimeMs: 0, data: [] }
function cachedArchive() {
  let mtimeMs = 0
  try { mtimeMs = statSync(ARCHIVE).mtimeMs } catch { return [] }
  if (mtimeMs !== archiveCache.mtimeMs) archiveCache = { mtimeMs, data: readArchive() }
  return archiveCache.data
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath
  const file = join(PUBLIC, rel)
  if ((file !== PUBLIC && !file.startsWith(PUBLIC + sep)) || !existsSync(file)) { res.writeHead(404); res.end('Not found'); return }
  const data = await readFile(file)
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(data)
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const p = url.pathname

    if (p === '/api/results') {
      return sendJson(res, 200, buildResults(await readJson('monitor-log.json', { scans: [] })))
    }
    if (p === '/api/momentum') {
      return sendJson(res, 200, buildMomentum(await readJson('momentum-log.json', { scans: [] })))
    }
    if (p === '/api/positions') {
      const positions = readPositions()
      if (!positions.length) return sendJson(res, 200, { positions: [] })
      const tickers = await getTicker(positions.map((x) => x.market)) || []
      const priceOf = Object.fromEntries(tickers.map((t) => [t.market, t.trade_price]))
      return sendJson(res, 200, { positions: evalPositions(positions, priceOf) })
    }
    if (p === '/api/insights') {
      const [log, weekly] = await Promise.all([
        readJson('monitor-log.json', { scans: [] }),
        readJson('weekly-analysis.json', { weeks: [] }),
      ])
      return sendJson(res, 200, buildInsights(log, weekly))
    }
    if (p === '/api/verify') {
      const [weekly, weights] = await Promise.all([
        readJson('weekly-analysis.json', { weeks: [] }),
        readJson('signal-weights.json', {}),
      ])
      return sendJson(res, 200, buildVerify(weekly, weights))
    }
    if (p === '/api/weights') {
      return sendJson(res, 200, await readJson('signal-weights.json', {}))
    }
    if (p === '/api/history') {
      return sendJson(res, 200, buildHistory(await readJson('monitor-log.json', { scans: [] })))
    }
    if (p === '/api/scans') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100)
      const offset = Number(url.searchParams.get('offset')) || 0
      return sendJson(res, 200, buildScans(cachedArchive(), { limit, offset }))
    }
    if (p === '/api/scan-detail') {
      const ts = url.searchParams.get('timestamp')
      const scan = findScanByTimestamp(cachedArchive(), ts)
      return scan ? sendJson(res, 200, scan) : sendJson(res, 404, { error: 'not found' })
    }
    if (p === '/api/coin-history') {
      const market = url.searchParams.get('market')
      if (!market || !/^KRW-[A-Z0-9]+$/.test(market)) return sendJson(res, 400, { error: 'invalid market' })
      return sendJson(res, 200, coinHistory(cachedArchive(), market))
    }
    if (p === '/api/markets') {
      const list = await cachedMarkets()
      return sendJson(res, 200, list.map((m) => ({ market: m.market, korean_name: m.korean_name })))
    }
    if (p === '/api/analyze') {
      const market = url.searchParams.get('market')
      const tf = url.searchParams.get('tf') || 'day'
      if (!market || !/^KRW-[A-Z0-9]+$/.test(market)) return sendJson(res, 400, { error: 'invalid market' })
      const candles = tf === 'day' ? await getDayCandles(market, 200)
        : await getMinuteCandles(market, tf === '4h' ? 240 : 60, 200)
      if (!candles || candles.length < 30) return sendJson(res, 400, { error: 'no data' })
      const ohlcv = candlesToOhlcv(candles)
      const weights = await readJson('signal-weights.json', {})
      const result = analyzeMarket(ohlcv, { weights })
      return sendJson(res, 200, { market, tf, ohlcv, ...result })
    }
    if (p === '/api/scan' && req.method === 'POST') {
      return sendJson(res, 200, runner.start())
    }
    if (p.startsWith('/api/scan/')) {
      const job = runner.get(p.slice('/api/scan/'.length))
      return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'no job' })
    }
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })

    await serveStatic(res, p)
  } catch (e) {
    sendJson(res, 500, { error: String(e && e.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`대시보드: http://127.0.0.1:${PORT}`)
})
