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
//  체결 모델 v2(2026-10-15~, FILL_MODEL): 익절선은 업비트 호가 단위로 올려서 판정·체결하고, 봉 안에서 손절선을
//    건드리면 그 시간의 1분봉에서 처음 건드린 분의 종가와 손절가(호가 내림) 중 낮은 값으로 체결한다(급락 꼬리에서
//    손절가에 다 팔렸다고 보는 v1의 낙관 제거 — 10-15 재측정 평균 -0.15%, 1원대 코인 최대 -0.69%).
//    진입은 스캔 직후 바로 돈다(lib/paper-trigger.mjs) — v1은 매시 :10에만 돌아 모멘텀이 중앙값 60분 늦게 샀다.

export const PAPER = {
  START_CASH: 500_000,     // 장부별 가상 자본
  POSITION_KRW: 50_000,    // 1건 금액
  MAX_OPEN: 10,            // 동시 보유 상한
  MAX_PER_SCAN: 3,         // 스캔 1회당 신규 진입 상한(점수순)
  FEE: 0.0005,             // 업비트 KRW 수수료(편도)
  STOP_SLIP: 0.002,        // 손절 시장가 추가 슬리피지
  MAX_SCAN_AGE_MS: 3 * 3600_000, // 이보다 오래된 스캔은 진입 안 함(지금 가격으로 옛 신호를 사지 않는다)
  DEFAULT_RULE: { slPct: 12, tpPct: 12, holdMax: 7 }, // 메인 general-exit-v1과 같은 값
  // 체결 모델 버전(위 주석). 체결·청산 규칙을 바꾸면 반드시 올린다 — 리포트가 포지션별 fillModel로만 나누므로,
  // 올리지 않고 규칙을 바꾸면 두 규칙이 한 통계에 섞인다. 바뀌면 paper-trade가 state.modelChanges에 시각을 남긴다.
  FILL_MODEL: 2,
}

// 업비트 KRW 마켓 호가 단위(가격대별). 2026-10-15 상장 296개 종목의 /orderbook/instruments tick_size와 전부 일치 확인.
// API는 "지금 가격"의 단위만 주므로 손절·익절선처럼 다른 가격대에 있는 값은 이 표로 계산한다.
const TICK_BANDS = [
  [1_000_000, 1000], [500_000, 500], [100_000, 100], [50_000, 50], [10_000, 10], [5_000, 5], [100, 1],
  [10, 0.1], [1, 0.01], [0.1, 0.001], [0.01, 0.0001], [0.001, 0.00001], [0.0001, 0.000001],
  [0.00001, 0.0000001], [0, 0.00000001],
]
// 비정상 값(NaN·음수)은 null — 한 포지션의 깨진 값 때문에 실행 전체가 죽지 않게.
export const upbitTick = (price) => (Number.isFinite(price) && price >= 0 ? TICK_BANDS.find(([min]) => price >= min)[1] : null)

// 호가 단위로 내림/올림. 부동소수 오차로 이미 호가 위에 있는 값이 한 칸 밀리지 않게 정수 칸 수를 반올림 보정한다.
const steps = (v, tick) => { const n = v / tick; const r = Math.round(n); return Math.abs(n - r) < 1e-9 ? r : n }
const onTick = (n, tick) => Number((n * tick).toFixed(Math.max(0, -Math.floor(Math.log10(tick)) + 2)))
export const tickFloor = (v, tick) => onTick(Math.floor(steps(v, tick)), tick)
export const tickCeil = (v, tick) => onTick(Math.ceil(steps(v, tick)), tick)
// 지정가 익절은 선 위 첫 호가에, 손절 판정 기준가는 선 아래 첫 호가에 — 각자 그 가격대의 호가 단위로.
const tpLevel = (tp) => { const t = upbitTick(tp); return t ? tickCeil(tp, t) : tp }
const stopLevel = (sl) => { const t = upbitTick(sl); return t ? tickFloor(sl, t) : sl }

// 봉 안 손절 체결가: 1분봉(오래된→최신)에서 처음 손절선을 건드린 분의 종가와 손절가(호가 내림) 중 낮은 값.
// 그 분이 손절선 아래에서 갭으로 시작했으면 시가가 더 낮을 수 있어 그것도 후보로 넣는다.
// 1분봉이 없거나 터치가 안 보이면 손절가(호가 내림). STOP_SLIP은 closePosition이 따로 뺀다.
export function stopFill(stop, minutes) {
  const level = stopLevel(stop)
  const hit = (minutes || []).find((m) => m.low <= stop)
  if (!hit) return level
  const cands = [level, hit.close, hit.open <= stop ? hit.open : null].filter(Number.isFinite)
  return Math.min(...cands)
}

export const newBook = () => ({ cash: PAPER.START_CASH, open: [], closed: [], skipped: 0, lastScan: null })

// 소스마다 장부를 보장한다. 새로 만든 장부엔 시작 시각을 남긴다 — 실험 도중 생긴 장부(random, 10-19~)는
// 시장 대비를 자기 시작일부터 재야 한다(paper-summary). 장부 파일이 없을 때(books 없음)도 같은 경로로 만든다.
// startCashOf(key)가 값을 주면 그 자본으로 만들고 startCash를 남긴다(1,000만 원 XL 장부, 10-22~). 없으면 PAPER.START_CASH.
export function ensureBooks(books, keys, nowIso, startCashOf = () => undefined) {
  const out = books ?? {}
  for (const k of keys) {
    if (out[k]) continue
    const cash = startCashOf(k)
    out[k] = cash != null ? { ...newBook(), cash, startCash: cash, startedAt: nowIso } : { ...newBook(), startedAt: nowIso }
  }
  return out
}

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
// v2(체결 모델 2로 산 포지션)면 익절선을 호가 단위로 올리고, 봉 안 손절에 intraBar: true를 붙인다 —
// 호출자가 그 시간 1분봉으로 stopFill 체결가를 다시 잡는다. v1 포지션은 예전 규칙 그대로(실험 기간 혼합 방지).
export function scanExit(pos, candles, v2 = false) {
  const tp = v2 ? tpLevel(pos.takeProfit) : pos.takeProfit
  for (const c of candles || []) {
    if (c.t <= pos.entryAt) continue // 진입이 포함된 봉과 그 이전 봉
    if (c.open <= pos.stopLoss) return { type: 'sl', price: c.open, at: c.t }
    // 걸어 둔 지정가 매도는 갭 상승이어도 자기 가격(tp)에 체결된다. v1은 예전 규칙(시가) 그대로 둔다.
    if (c.open >= tp) return { type: 'tp', price: v2 ? tp : c.open, at: c.t }
    if (c.low <= pos.stopLoss) return v2 ? { type: 'sl', price: pos.stopLoss, at: c.t, intraBar: true } : { type: 'sl', price: pos.stopLoss, at: c.t }
    if (c.high >= tp) return { type: 'tp', price: tp, at: c.t }
  }
  return null
}

// v2: 진입한 시간의 남은 분(진입이 포함된 분은 제외)을 1분봉으로 확인한다. 스캔 직후(:01~:03) 사므로 그 시간 봉을
// 통째로 건너뛰면 거의 한 시간 동안의 손절·익절을 놓친다. 손절은 그 분의 종가와 손절가(호가 내림) 중 낮은 값.
export function entryHourExit(pos, minuteBars) {
  const e = scanExit(pos, minuteBars, true) // 분 시작 ≤ 진입 시각인 분(진입이 포함된 분)은 scanExit가 건너뛴다
  if (!e) return null
  return e.intraBar ? { type: 'sl', price: stopFill(pos.stopLoss, minuteBars.filter((m) => m.t === e.at)), at: e.at } : e
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
    kimchiRel: pick.kimchi?.rel ?? null, fillModel: PAPER.FILL_MODEL,
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
