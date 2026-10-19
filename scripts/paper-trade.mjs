// 모의매매 1회 실행 — 매시 :10 스케줄(UpbitPaper) + 스캔 직후(lib/paper-trigger.mjs, 인자 --after-scan <소스>).
// 순서: 청산 확인 → 새 스캔 진입 → 평가금 기록.
// 장부: data/paper-trades.json (git 추적 — 스냅샷 커밋으로 백업), 이벤트 원장: data/paper-trades-log.jsonl(추가 전용).
// 규칙·체결 모델은 lib/paper.mjs 주석. 판정은 scripts/research/paper-report.mjs.
import '../lib/env.mjs'
import { existsSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { getOrderbook, getMinuteCandles, getTicker } from '../lib/upbit.mjs'
import { readJson, writeJson, withLock, DATA_DIR } from '../lib/store.mjs'
import { sendTelegram } from '../lib/notify.mjs'
import {
  PAPER, ensureBooks, vwapFill, exitRule, scanExit, stopFill, entryHourExit, selectEntries, openPosition, closePosition,
} from '../lib/paper.mjs'
import { randomPicks } from '../lib/paper-random.mjs'

const FILE = 'paper-trades.json'
const LOG = join(DATA_DIR, 'paper-trades-log.jsonl')
const MAX_EQUITY_POINTS = 24 * 120 // 매시 1점 + 스캔 직후 실행분(시간당 약 1.6점) → 실제 보관은 약 75일. 판정(11-05)까지는 충분
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (ev) => appendFileSync(LOG, JSON.stringify({ ...ev, logAt: new Date().toISOString() }) + '\n')

// 소스별 최신 스캔 목록 → [{ at(ms), picks }]
const SOURCES = {
  main: { file: 'monitor-log.json', picksOf: (s) => s.buy },
  momentum: { file: 'momentum-log.json', picksOf: (s) => s.picks },
  // 무작위 대조: 메인과 같은 스캔·같은 규칙, 픽만 무작위(lib/paper-random.mjs). universe 없는 예전 스캔은 빈 목록.
  random: { file: 'monitor-log.json', picksOf: randomPicks },
}

async function loadState() {
  const nowIso = new Date().toISOString()
  if (!existsSync(join(DATA_DIR, FILE))) {
    return { version: 1, fillModel: PAPER.FILL_MODEL, startedAt: nowIso, params: PAPER, books: ensureBooks({}, Object.keys(SOURCES), nowIso), equity: [] }
  }
  const st = await readJson(FILE, null)
  // 파일이 있는데 못 읽으면 덮어쓰지 않고 멈춘다(기록 유실 방지).
  if (!st || !st.books) throw new Error(`${FILE} 읽기 실패 — 덮어쓰지 않고 중단`)
  ensureBooks(st.books, Object.keys(SOURCES), nowIso)
  st.equity ||= []
  // 체결 모델이나 실험 설정이 바뀐 시각과 이전 설정을 남긴다 — 리포트가 변경 전/후를 나눠 본다
  // (실험 중간 규칙 변경이라 그대로 섞으면 안 된다). 포지션마다 fillModel도 따로 기록돼 있다.
  if ((st.fillModel ?? 1) !== PAPER.FILL_MODEL || JSON.stringify(st.params) !== JSON.stringify(PAPER)) {
    st.modelChanges = [...(st.modelChanges || []), { at: Date.now(), fillModel: PAPER.FILL_MODEL, prevParams: st.params }]
    st.fillModel = PAPER.FILL_MODEL
    st.params = PAPER
  }
  return st
}

// 업비트 캔들 원본(최신→오래된) → [{ t(ms 시작), open, high, low, close }] 오래된→최신
const toBars = (raw) => [...raw].reverse().map((c) => ({
  t: new Date(c.candle_date_time_utc + 'Z').getTime(), open: c.opening_price, high: c.high_price, low: c.low_price, close: c.trade_price,
}))

async function hourCandles(market, sinceMs) {
  const hours = Math.min(200, Math.ceil((Date.now() - sinceMs) / 3600_000) + 2)
  const raw = await getMinuteCandles(market, 60, hours)
  return Array.isArray(raw) ? toBars(raw) : null
}

// 시간 [hourStart, hourStart+1h) 의 1분봉. 실패 시 null.
async function minuteBars(market, hourStart) {
  const raw = await getMinuteCandles(market, 1, 60, new Date(hourStart + 3600_000).toISOString())
  await sleep(120)
  return Array.isArray(raw) ? toBars(raw).filter((m) => m.t >= hourStart && m.t < hourStart + 3600_000) : null
}

const HOUR = 3600_000
const hourOf = (ms) => Math.floor(ms / HOUR) * HOUR

// 봉 안 손절 → 그 시간 1분봉으로 체결가를 다시 잡는다(stopFill). 조회 실패면 손절가(호가 내림).
async function refineStop(pos, exit) {
  const minutes = await minuteBars(pos.market, exit.at)
  const hit = minutes?.find((m) => m.low <= pos.stopLoss)
  return { ...exit, price: stopFill(pos.stopLoss, minutes), at: hit?.t ?? exit.at, minuteFill: !!hit }
}

// v2: 진입한 시간의 남은 분을 1분봉으로 확인. 그 시간이 다 지나고 아무 일 없으면 다시 보지 않게 표시한다.
// 조회에 실패하면 { pending: true } — 그 뒤 시간봉으로 넘어가면 진입 시간의 손절을 놓치고 더 늦은(좋은) 청산이
// 기록될 수 있어서, 이 포지션은 이번 회차를 통째로 건너뛰고 다음 회차에 다시 본다.
async function checkEntryHour(pos, now) {
  if (pos.entryHourChecked) return null
  const h = hourOf(pos.entryAt)
  const bars = await minuteBars(pos.market, h)
  if (!bars) return { pending: true }
  const exit = entryHourExit(pos, bars)
  if (exit) return { ...exit, minuteFill: true }
  if (now >= h + HOUR) pos.entryHourChecked = true // 거래 없는 분은 1분봉이 없다 — 빈 결과도 "아무 일 없음"
  return null
}

async function checkExits(st, now) {
  const closed = []
  for (const [src, book] of Object.entries(st.books)) {
    for (const pos of [...book.open]) {
      const candles = await hourCandles(pos.market, pos.entryAt)
      await sleep(120)
      if (!candles) { console.log(`  ${src} ${pos.market} 1시간봉 조회 실패 — 다음 회차에 재확인`); continue }
      // 체결 모델은 포지션을 산 때의 것을 따른다(v1 포지션에 v2 규칙을 섞지 않는다)
      const v2 = (pos.fillModel ?? 1) >= 2
      let exit = v2 ? await checkEntryHour(pos, now) : null
      if (exit?.pending) { console.log(`  ${src} ${pos.market} 진입 시간 1분봉 조회 실패 — 다음 회차에 재확인`); continue }
      if (!exit) exit = scanExit(pos, candles, v2)
      if (exit?.intraBar) exit = await refineStop(pos, exit)
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
      if (exit.minuteFill != null) c.minuteFill = exit.minuteFill
      closed.push(c)
      log({ ev: 'close', ...c })
    }
  }
  return closed
}

async function enterNew(st, now) {
  const opened = []
  const logs = {} // main·random이 같은 monitor-log(약 10MB)를 쓴다 — 한 번만 읽고, 두 장부가 같은 스냅샷을 본다
  for (const [src, cfg] of Object.entries(SOURCES)) {
    const book = st.books[src]
    book.lastScan ??= now - PAPER.MAX_SCAN_AGE_MS // 첫 실행: 최근 3시간 스캔만(과거 로그 전체를 stale로 세지 않게)
    const logData = (logs[cfg.file] ??= await readJson(cfg.file, { scans: [] }))
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
      const fillAt = Date.now() // 진입 시각은 호가를 받은 순간 — 청산 확인이 오래 걸려도 진입 전 분이 진입 뒤로 세지지 않게
      for (const pick of want) {
        const ob = books?.[pick.market]
        const fill = ob ? vwapFill(ob.asks, { krw: PAPER.POSITION_KRW }) : null
        if (!fill?.filled) { log({ ev: 'no-fill', src, market: pick.market }); continue }
        if (book.cash < fill.krw * (1 + PAPER.FEE)) { log({ ev: 'no-cash', src, market: pick.market }); continue }
        const pos = openPosition(book, pick, { source: src, fill, at: fillAt, scanAt: scan.at, rule: exitRule(pick, src, fill.price) })
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
  const i = process.argv.indexOf('--after-scan')
  if (i >= 0) console.log(`${new Date().toISOString()} 스캔 직후 실행 (${process.argv[i + 1] || '?'})`)
  // 스캔 직후 실행과 매시 :10 실행이 겹칠 수 있다. 앞 실행이 느려도 강제로 끼어들지 않고(장부 덮어쓰기 방지)
  // 5분 기다린 뒤에도 바쁘면 이번 회차를 건너뛴다 — 다음 회차가 같은 스캔(3시간 이내)을 이어서 처리한다.
  // 하트비트(1분)로 락을 갱신해서, API가 느려 20분(staleMs)을 넘겨도 살아 있는 실행의 락은 탈취되지 않는다.
  try {
    await withLock('paper-trades', run, { timeoutMs: 5 * 60_000, staleMs: 20 * 60_000, onTimeout: 'throw', heartbeatMs: 60_000 })
  } catch (e) {
    if (e.code !== 'LOCK_TIMEOUT') throw e
    console.log(`${new Date().toISOString()} 다른 모의매매 실행이 진행 중 — 이번 회차 건너뜀`)
  }
}

async function run() {
  const now = Date.now() // 잠금을 잡은 뒤의 시각 — 기다린 동안의 시간이 진입 시각에 섞이지 않게
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
}

main().catch(async (e) => { console.error(e); await sendTelegram(`❌ 모의매매 실패: ${e.message}`); process.exit(1) })
