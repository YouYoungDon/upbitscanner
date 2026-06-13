import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson } from '../lib/store.mjs'
import { getDayCandles, getMinuteCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { analyzeMarket } from '../lib/analyze.mjs'
import { buildResults, buildInsights, buildVerify } from './api.mjs'
import { createScanRunner } from './scan-job.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const PORT = process.env.DASHBOARD_PORT || 8787
const runner = createScanRunner()

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

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
