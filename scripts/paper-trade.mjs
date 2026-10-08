// 모의매매 1회 실행 — 매시 :10 스케줄(UpbitPaper). 순서: 청산 확인 → 새 스캔 진입 → 평가금 기록.
// 장부: data/paper-trades.json (git 추적 — 스냅샷 커밋으로 백업), 이벤트 원장: data/paper-trades-log.jsonl(추가 전용).
// 규칙·체결 모델은 lib/paper.mjs 주석. 판정은 scripts/research/paper-report.mjs.
import '../lib/env.mjs'
import { existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { getOrderbook, getMinuteCandles, getTicker } from '../lib/upbit.mjs'
import { readJson, writeJson, withLock, DATA_DIR } from '../lib/store.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import {
  PAPER, newBook, vwapFill, exitRule, scanExit, selectEntries, openPosition, closePosition,
} from '../lib/paper.mjs'

const FILE = 'paper-trades.json'
const LOG = join(DATA_DIR, 'paper-trades-log.jsonl')
const MAX_EQUITY_POINTS = 24 * 120 // 시간당 1점, 약 120일
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (ev) => appendFileSync(LOG, JSON.stringify({ ...ev, logAt: new Date().toISOString() }) + '\n')

// 소스별 최신 스캔 목록 → [{ at(ms), picks }]
const SOURCES = {
  main: { file: 'monitor-log.json', picksOf: (s) => s.buy },
  momentum: { file: 'momentum-log.json', picksOf: (s) => s.picks },
}

async function loadState() {
  const fresh = { version: 1, startedAt: new Date().toISOString(), params: PAPER, books: { main: newBook(), momentum: newBook() }, equity: [] }
  if (!existsSync(join(DATA_DIR, FILE))) return fresh
  const st = await readJson(FILE, null)
  // 파일이 있는데 못 읽으면 덮어쓰지 않고 멈춘다(기록 유실 방지).
  if (!st || !st.books) throw new Error(`${FILE} 읽기 실패 — 덮어쓰지 않고 중단`)
  for (const k of Object.keys(SOURCES)) st.books[k] ||= newBook()
  st.equity ||= []
  return st
}

async function hourCandles(market, sinceMs) {
  const hours = Math.min(200, Math.ceil((Date.now() - sinceMs) / 3600_000) + 2)
  const raw = await getMinuteCandles(market, 60, hours)
  if (!Array.isArray(raw)) return null
  return [...raw].reverse().map((c) => ({
    t: new Date(c.candle_date_time_utc + 'Z').getTime(), open: c.opening_price, high: c.high_price, low: c.low_price, close: c.trade_price,
  }))
}

async function checkExits(st, now) {
  const closed = []
  for (const [src, book] of Object.entries(st.books)) {
    for (const pos of [...book.open]) {
      const candles = await hourCandles(pos.market, pos.entryAt)
      await sleep(120)
      if (!candles) { console.log(`  ${src} ${pos.market} 1시간봉 조회 실패 — 다음 회차에 재확인`); continue }
      let exit = scanExit(pos, candles)
      if (!exit && now >= pos.entryAt + pos.holdMax * 86400_000) {
        const ob = (await getOrderbook([pos.market]))?.[pos.market]
        const f = ob ? vwapFill(ob.bids, { qty: pos.qty }) : null
        const last = candles.at(-1)?.close
        if (f?.filled) exit = { type: 'time', price: f.price, at: now }
        else if (last) exit = { type: 'time', price: last * (1 - PAPER.STOP_SLIP), at: now, thinBook: true }
      }
      if (!exit) continue
      const c = closePosition(book, pos, exit)
      if (exit.thinBook) c.thinBook = true
      closed.push(c)
      log({ ev: 'close', ...c })
    }
  }
  return closed
}

async function enterNew(st, now) {
  const opened = []
  for (const [src, cfg] of Object.entries(SOURCES)) {
    const book = st.books[src]
    book.lastScan ??= now - PAPER.MAX_SCAN_AGE_MS // 첫 실행: 최근 3시간 스캔만(과거 로그 전체를 stale로 세지 않게)
    const logData = await readJson(cfg.file, { scans: [] })
    const scans = (logData.scans || [])
      .map((s) => ({ at: new Date(s.timestamp).getTime(), picks: cfg.picksOf(s) || [] }))
      .filter((s) => Number.isFinite(s.at) && (book.lastScan == null || s.at > book.lastScan))
      .sort((a, b) => a.at - b.at)
    // 회차당 가장 최근 새 스캔 하나만 진입한다(정시 스캔은 3시간 간격이라 보통 하나). 수동 스캔이 겹쳐도
    // 한 번에 자본이 몰리지 않게 — 앞선 스캔은 건너뛴 것으로 센다.
    if (scans.length > 1) { book.skipped += scans.length - 1; book.lastScan = scans.at(-2).at }
    for (const scan of scans.slice(-1)) {
      book.lastScan = scan.at
      if (now - scan.at > PAPER.MAX_SCAN_AGE_MS) { book.skipped += 1; log({ ev: 'stale-scan', src, scanAt: scan.at }); continue }
      const want = selectEntries(book, scan.picks)
      if (!want.length) continue
      const books = await getOrderbook(want.map((p) => p.market))
      for (const pick of want) {
        const ob = books?.[pick.market]
        const fill = ob ? vwapFill(ob.asks, { krw: PAPER.POSITION_KRW }) : null
        if (!fill?.filled) { log({ ev: 'no-fill', src, market: pick.market }); continue }
        if (book.cash < fill.krw * (1 + PAPER.FEE)) { log({ ev: 'no-cash', src, market: pick.market }); continue }
        const pos = openPosition(book, pick, { source: src, fill, at: now, scanAt: scan.at, rule: exitRule(pick, src, fill.price) })
        opened.push(pos)
        log({ ev: 'open', ...pos })
      }
    }
  }
  return opened
}

async function markEquity(st, now) {
  const markets = [...new Set(Object.values(st.books).flatMap((b) => b.open.map((p) => p.market)))]
  const px = {}
  if (markets.length) for (const t of (await getTicker(markets)) || []) px[t.market] = t.trade_price
  const point = { at: now }
  for (const [src, b] of Object.entries(st.books)) {
    point[src] = Math.round(b.cash + b.open.reduce((s, p) => s + p.qty * (px[p.market] ?? p.entryPrice), 0))
  }
  st.equity = [...st.equity, point].slice(-MAX_EQUITY_POINTS)
  return point
}

async function main() {
  const now = Date.now()
  await withLock('paper-trades', async () => {
    const st = await loadState()
    const closed = await checkExits(st, now)
    const opened = await enterNew(st, now)
    const eq = await markEquity(st, now)
    st.lastRun = new Date(now).toISOString()
    await writeJson(FILE, st)
    const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
    for (const c of closed) console.log(`청산 ${c.source} ${c.korean_name || c.market} ${c.exitType} ${pct(c.net)}`)
    for (const o of opened) console.log(`진입 ${o.source} ${o.korean_name || o.market} @${o.entryPrice} (스캔가 ${o.scanPrice})`)
    for (const [src, b] of Object.entries(st.books)) {
      console.log(`[${src}] 보유 ${b.open.length} · 청산 ${b.closed.length} · 현금 ${Math.round(b.cash)} · 평가 ${eq[src]} (${pct(eq[src] / PAPER.START_CASH - 1)})`)
    }
  })
}

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 모의매매 실패: ${e.message}`); process.exit(1) })
