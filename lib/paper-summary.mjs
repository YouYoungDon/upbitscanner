// 모의매매 집계 — 터미널 리포트(scripts/research/paper-report.mjs)와 대시보드(/api/paper)가 같은 숫자를 쓰게 하는 순수 함수.
// 평균은 두 가지를 따로 낸다: tradeMean = 거래 단순 평균, dayMean = 진입일별로 묶은 평균(군집 t의 기준).
// 같은 날 진입한 거래는 시장 하나에 같이 움직이므로(10-13 09시 손절 6건 동시 발생) 판정은 dayMean·t로 한다.
import { clusteredT, maxDrawdown } from './perf-metrics.mjs'
import { baselineReturn } from './market-baseline.mjs'
import { bookByKey, limitsOf } from './paper-books.mjs'

const DAY = 86400_000
const utcDay = (ms) => Math.floor(ms / DAY)

// 청산 거래 목록 → 승률·평균(거래/진입일)·군집 t·시장 대비 초과·손익. daily = market-baseline.json의 daily.
export function summarizeTrades(trades, daily) {
  const rows = (trades ?? []).map((c) => {
    const d0 = utcDay(c.entryAt), n = utcDay(c.exitAt) - d0
    const m = n === 0 ? 0 : baselineReturn(daily, d0, n)
    return { ...c, day: d0, exc: m == null ? null : c.net - m }
  })
  const n = rows.length
  if (!n) return { n: 0 }
  const nets = rows.map((r) => r.net).sort((a, b) => a - b)
  const day = clusteredT(rows.map((r) => ({ day: r.day, v: r.net })))
  const exc = clusteredT(rows.filter((r) => r.exc != null).map((r) => ({ day: r.day, v: r.exc })))
  return {
    n,
    win: rows.filter((r) => r.net > 0).length / n,
    tradeMean: nets.reduce((a, b) => a + b, 0) / n,
    dayMean: day.mean, dayT: day.t, days: day.days,
    median: nets[Math.floor(n / 2)],
    excMean: exc.mean, excT: exc.t, excDays: exc.days,
    pnl: rows.reduce((s, r) => s + r.pnl, 0),
    byType: rows.reduce((a, r) => ({ ...a, [r.exitType]: (a[r.exitType] || 0) + 1 }), {}),
  }
}

const rel = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b - 1 : null)

// paper-trades.json 상태 + 시장 기준선 + 현재가 → 대시보드 화면용 묶음. 장부 파일은 읽기만 한다.
export function buildPaperView(state, daily, priceOf, now = Date.now()) {
  const baseStart = state.params?.START_CASH ?? 500000
  const d0 = utcDay(new Date(state.startedAt).getTime()), d1 = utcDay(now) - 1
  // 시장 기준선은 일 단위(UTC, 09:00 KST 종가)라 어제 마감까지만 있다. 장부도 그 시점 평가금으로 비교해야
  // 오늘 장중 움직임이 한쪽에만 들어가지 않는다(2026-10-19 리뷰). 시작점도 같게: 시장은 0일 마감부터라
  // 장부도 0일 마감(그 시점 이전 마지막 평가금, 없으면 원금)부터 잰다 — 첫날 장중 등락(10-08 −0.5~−0.9%)이 섞이지 않게.
  // 0일은 장부마다 다르다: 나중에 생긴 장부(random, 10-19~)는 book.startedAt부터 — 실험 시작일로 재면 기간이 어긋난다.
  const marketEnd = (d1 + 1) * DAY
  const books = {}
  for (const [src, book] of Object.entries(state.books ?? {})) {
    const start = book.startCash ?? baseStart // XL 장부(10-22~)는 1,000만 원
    const b0 = book.startedAt ? utcDay(new Date(book.startedAt).getTime()) : d0
    const market = d1 > b0 ? baselineReturn(daily, b0, d1 - b0) : null
    const marketStart = (b0 + 1) * DAY
    const eq = (state.equity ?? []).map((p) => p[src]).filter(Number.isFinite)
    const lastAt = (t) => (state.equity ?? []).filter((p) => p.at <= t && Number.isFinite(p[src])).at(-1)?.[src]
    const atStart = lastAt(marketStart) ?? start, atEnd = lastAt(marketEnd)
    const rets = eq.slice(1).map((v, i) => v / eq[i] - 1)
    const open = book.open.map((p) => {
      const price = priceOf[p.market] ?? null
      return {
        market: p.market, name: p.korean_name, entryAt: p.entryAt, entryPrice: p.entryPrice, price,
        stopLoss: p.stopLoss, takeProfit: p.takeProfit, holdMax: p.holdMax, score: p.score, signals: p.signals,
        ret: rel(price, p.entryPrice), toStop: rel(p.stopLoss, price), toTake: rel(p.takeProfit, price),
        heldDays: (now - p.entryAt) / DAY,
      }
    })
    // 손절선까지 남은 거리가 짧은 순(toStop은 음수라 큰 값이 가까움). 가격 없는 건 맨 뒤.
    open.sort((a, b) => (b.toStop ?? -Infinity) - (a.toStop ?? -Infinity))
    const closed = [...book.closed].sort((a, b) => b.exitAt - a.exitAt).map((c) => {
      const price = priceOf[c.market] ?? null
      return {
        market: c.market, name: c.korean_name, entryAt: c.entryAt, exitAt: c.exitAt, exitType: c.exitType,
        entryPrice: c.entryPrice, exitPrice: c.exitPrice, net: c.net, pnl: c.pnl,
        holdNow: rel(price, c.entryPrice), afterExit: rel(price, c.exitPrice),
      }
    })
    books[src] = {
      cash: book.cash, skipped: book.skipped,
      equity: eq.at(-1) ?? start, ret: (eq.at(-1) ?? start) / start - 1,
      mdd: rets.length ? maxDrawdown(rets).mdd : null,
      market, vsMarket: market == null || atEnd == null ? null : atEnd / atStart - 1 - market, marketAsOf: marketEnd,
      startCash: start, maxOpen: limitsOf(bookByKey(src)).maxOpen,
      summary: summarizeTrades(book.closed, daily), open, closed,
    }
  }
  return { startedAt: state.startedAt, lastRun: state.lastRun, params: state.params, modelChanges: state.modelChanges ?? [], books, equity: state.equity ?? [] }
}

// 장부 파일 + 시장 기준선 + 현재가 → buildPaperView. 대시보드(/api/paper)와 봇(/모의)이 같이 쓴다(두 경로가 어긋나지 않게).
// listedMarkets: 현재 상장 마켓 목록 — 상폐 마켓이 하나라도 섞이면 업비트 ticker 요청 전체가 실패하므로 거른다.
// 목록 조회가 실패(빈 배열)하면 거르지 않는다(전부 버리면 현재가가 하나도 안 붙는다).
export async function loadPaperView({ readJson, getTicker, listedMarkets = null, now = Date.now() }) {
  const state = await readJson('paper-trades.json', null)
  if (!state || !state.books) return { empty: true }
  const daily = (await readJson('market-baseline.json', { daily: {} })).daily || {}
  const listed = listedMarkets ? new Set(await listedMarkets()) : null
  const wanted = [...new Set(Object.values(state.books).flatMap((b) => [...b.open, ...b.closed].map((x) => x.market)))]
    .filter((m) => !listed?.size || listed.has(m))
  const tickers = []
  for (let i = 0; i < wanted.length; i += 100) {
    const t = await getTicker(wanted.slice(i, i + 100))
    if (Array.isArray(t)) tickers.push(...t)
  }
  const view = buildPaperView(state, daily, Object.fromEntries(tickers.map((t) => [t.market, t.trade_price])), now)
  view.pricesMissing = wanted.length > 0 && tickers.length === 0
  return view
}
