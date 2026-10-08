// 모의매매(페이퍼 트레이딩) — 스캐너 픽을 실제 호가로 가상 체결해 기록한다. 돈은 안 쓴다.
// 목적: 2026-11-05 점검에서 "기계적으로 따라 사면 실제로 얼마나 남나"를 백테스트가 아닌
// 실시간 체결 기준으로 본다(호가 스프레드·호가 깊이·스캔→체결 지연·수수료 포함).
// 판정은 scripts/research/paper-report.mjs(시장 대비 초과·진입일 군집 t)로 한다.
//
// 체결 모델
//  - 진입: 호가창 매도 물량(ask)을 POSITION_KRW만큼 위에서부터 훑은 평균가. 물량이 모자라면 건너뜀.
//  - 손절/익절: 1시간봉 고저로 터치 판정. 진입이 포함된 봉은 건너뛴다(진입 전 가격이 섞여 있다).
//    같은 봉에서 둘 다 닿으면 손절(보수적). 봉 시가가 이미 선을 넘었으면(갭) 시가 체결.
//    손절은 시장가로 던진다고 보고 STOP_SLIP을 더 깎는다. 익절은 지정가라 슬리피지 없음.
//  - 기한 청산: holdMax일이 지나면 호가창 매수 물량(bid)에 보유 수량을 훑은 평균가.
//  - 수수료: 업비트 KRW 마켓 0.05%를 매수·매도 양쪽에.

export const PAPER = {
  START_CASH: 500_000,     // 장부별 가상 자본
  POSITION_KRW: 50_000,    // 1건 금액
  MAX_OPEN: 10,            // 동시 보유 상한
  MAX_PER_SCAN: 3,         // 스캔 1회당 신규 진입 상한(점수순)
  FEE: 0.0005,             // 업비트 KRW 수수료(편도)
  STOP_SLIP: 0.002,        // 손절 시장가 추가 슬리피지
  MAX_SCAN_AGE_MS: 3 * 3600_000, // 이보다 오래된 스캔은 진입 안 함(지금 가격으로 옛 신호를 사지 않는다)
  DEFAULT_RULE: { slPct: 12, tpPct: 12, holdMax: 7 }, // 메인 general-exit-v1과 같은 값
}

export const newBook = () => ({ cash: PAPER.START_CASH, open: [], closed: [], skipped: 0, lastScan: null })

// levels [{price,size}] 를 앞에서부터 훑는다. {krw} = 그 금액만큼 사기, {qty} = 그 수량만큼 팔기.
export function vwapFill(levels, { krw, qty } = {}) {
  let gotQty = 0, gotKrw = 0
  for (const { price, size } of levels || []) {
    if (!(price > 0) || !(size > 0)) continue
    if (krw != null) {
      const take = Math.min(size, (krw - gotKrw) / price)
      gotQty += take; gotKrw += take * price
      if (gotKrw >= krw - 1e-9) break
    } else {
      const take = Math.min(size, qty - gotQty)
      gotQty += take; gotKrw += take * price
      if (gotQty >= qty - 1e-12) break
    }
  }
  const filled = krw != null ? gotKrw >= krw - 1e-6 : gotQty >= qty - 1e-9
  return { filled, price: gotQty > 0 ? gotKrw / gotQty : null, qty: gotQty, krw: gotKrw }
}

// 픽 → 체결가 기준 손절·목표·보유일. 스캔가 기준 비율을 그대로 체결가에 옮긴다.
export function exitRule(pick, source, fillPrice) {
  if (pick.strategy && pick.price > 0) {
    return {
      stopLoss: fillPrice * (pick.strategy.stopLoss / pick.price),
      takeProfit: fillPrice * (pick.strategy.takeProfit / pick.price),
      holdMax: 7, rule: 'strategy',
    }
  }
  const e = source === 'main' && pick.exit ? pick.exit : null
  const { slPct, tpPct, holdMax } = e || PAPER.DEFAULT_RULE
  return { stopLoss: fillPrice * (1 - slPct / 100), takeProfit: fillPrice * (1 + tpPct / 100), holdMax, rule: e ? 'exit' : 'default' }
}

// candles: 1시간봉 오래된→최신 [{t(ms 시작), open, high, low}]. 진입 봉 이후 첫 터치를 찾는다.
export function scanExit(pos, candles) {
  for (const c of candles || []) {
    if (c.t <= pos.entryAt) continue // 진입이 포함된 봉과 그 이전 봉
    if (c.open <= pos.stopLoss) return { type: 'sl', price: c.open, at: c.t }
    if (c.open >= pos.takeProfit) return { type: 'tp', price: c.open, at: c.t }
    if (c.low <= pos.stopLoss) return { type: 'sl', price: pos.stopLoss, at: c.t }
    if (c.high >= pos.takeProfit) return { type: 'tp', price: pos.takeProfit, at: c.t }
  }
  return null
}

export const netReturn = (entry, exit) => (exit * (1 - PAPER.FEE)) / (entry * (1 + PAPER.FEE)) - 1

// 스캔 픽 → 이번에 살 후보(점수순, 이미 보유·저유동성 제외, 스캔당·빈 슬롯 상한).
export function selectEntries(book, picks, { maxPerScan = PAPER.MAX_PER_SCAN, maxOpen = PAPER.MAX_OPEN } = {}) {
  const held = new Set(book.open.map((p) => p.market))
  const room = Math.max(0, Math.min(maxPerScan, maxOpen - book.open.length))
  return [...(picks || [])]
    .filter((p) => p && p.market && !held.has(p.market) && !p.lowLiquidity)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, room)
}

export function openPosition(book, pick, { source, fill, at, scanAt, rule }) {
  const cost = fill.krw * (1 + PAPER.FEE)
  const pos = {
    id: `${source}:${pick.market}:${at}`, source, market: pick.market, korean_name: pick.korean_name,
    score: pick.score, signals: pick.signals || [], scanAt, scanPrice: pick.price,
    entryAt: at, entryPrice: fill.price, qty: fill.qty, krw: fill.krw,
    stopLoss: rule.stopLoss, takeProfit: rule.takeProfit, holdMax: rule.holdMax, rule: rule.rule,
    kimchiRel: pick.kimchi?.rel ?? null,
  }
  book.cash -= cost
  book.open.push(pos)
  return pos
}

// exit {type:'sl'|'tp'|'time', price, at}. 손절은 STOP_SLIP 추가 차감.
export function closePosition(book, pos, exit) {
  const exitPrice = exit.type === 'sl' ? exit.price * (1 - PAPER.STOP_SLIP) : exit.price
  const proceeds = pos.qty * exitPrice * (1 - PAPER.FEE)
  book.cash += proceeds
  book.open = book.open.filter((p) => p !== pos)
  const closed = {
    ...pos, exitType: exit.type, exitAt: exit.at, exitPrice,
    gross: exitPrice / pos.entryPrice - 1, net: netReturn(pos.entryPrice, exitPrice),
    pnl: proceeds - pos.krw * (1 + PAPER.FEE),
  }
  book.closed.push(closed)
  return closed
}
