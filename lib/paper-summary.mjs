// 모의매매 집계 — 터미널 리포트(scripts/research/paper-report.mjs)와 대시보드(/api/paper)가 같은 숫자를 쓰게 하는 순수 함수.
// 평균은 두 가지를 따로 낸다: tradeMean = 거래 단순 평균, dayMean = 진입일별로 묶은 평균(군집 t의 기준).
// 같은 날 진입한 거래는 시장 하나에 같이 움직이므로(10-13 09시 손절 6건 동시 발생) 판정은 dayMean·t로 한다.
import { clusteredT, maxDrawdown } from './perf-metrics.mjs'
import { baselineReturn } from './market-baseline.mjs'

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
  const start = state.params?.START_CASH ?? 500000
  const d0 = utcDay(new Date(state.startedAt).getTime()), d1 = utcDay(now) - 1
  const market = d1 > d0 ? baselineReturn(daily, d0, d1 - d0) : null
  const books = {}
  for (const [src, book] of Object.entries(state.books ?? {})) {
    const eq = (state.equity ?? []).map((p) => p[src]).filter(Number.isFinite)
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
      market, summary: summarizeTrades(book.closed, daily), open, closed,
    }
  }
  return { startedAt: state.startedAt, lastRun: state.lastRun, params: state.params, modelChanges: state.modelChanges ?? [], books, equity: state.equity ?? [] }
}
