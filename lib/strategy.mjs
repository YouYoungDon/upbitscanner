// 조용한 바닥(선행 진입) 전략 — 순수 함수.
// 검증 근거: 스코어카드 6주 — 거래량 조용한 깊은 과매도 진입이 추격 대비 우위
// (docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md)
// 파라미터는 data/strategy-config.json (백테스트로만 갱신, 주간 가중치 학습과 무관).
import { calcRSI, calcRSISeries, calcStochastic, calcStochasticKSeries, calcVolRatio, calcVolRatioSeries } from './indicators.mjs'

// 확정봉 배열에서 "조용한 바닥" 시그니처 판정. 충족 시 지표값, 아니면 null.
export function detectQuietBottom(confirmed, params) {
  const { rsiMax, stochMax, volMax, minCandles = 60 } = params ?? {}
  if (!Array.isArray(confirmed) || confirmed.length < Math.max(minCandles, 22)) return null
  const closes = confirmed.map((c) => c.close)
  const highs = confirmed.map((c) => c.high)
  const lows = confirmed.map((c) => c.low)
  const volumes = confirmed.map((c) => c.volume)
  const rsi = calcRSI(closes)
  const stoch = calcStochastic(highs, lows, closes)
  const volRatio = calcVolRatio(volumes)
  if (rsi == null || stoch == null || volRatio == null) return null
  if (rsi <= rsiMax && stoch.k <= stochMax && volRatio <= volMax) {
    return { rsi, stochK: stoch.k, volRatio }
  }
  return null
}

// 진입가 기준 손절·목표가. slPct/tpPct는 양수 %.
export function strategyLevels(entryPrice, params) {
  if (!(entryPrice > 0)) return null
  const { slPct, tpPct } = params
  return {
    stopLoss: entryPrice * (1 - slPct / 100),
    takeProfit: entryPrice * (1 + tpPct / 100),
  }
}

// 한 봉에서의 청산 판정 — 손절 우선(보수적), 마지막 봉이면 종가 시간청산.
// 백테스트(simulateTrade)와 라이브 채점(scoreStrategyOutcome)이 공유하는 단일 규칙:
// 두 경로의 청산 정책이 갈라지면 백테스트-라이브 비교성이 깨진다.
function resolveExit(c, entry, stopLoss, takeProfit, isLast) {
  if (c.low <= stopLoss) return { reason: 'sl', ret: stopLoss / entry - 1 }
  if (c.high >= takeProfit) return { reason: 'tp', ret: takeProfit / entry - 1 }
  if (isLast) return { reason: 'time', ret: c.close / entry - 1 }
  return null
}

// 백테스트 거래 시뮬레이션. 진입은 신호봉(entryIdx) 다음봉 시가 — 룩어헤드 방지.
// 보유는 진입봉 포함 최대 holdMax봉. 히스토리가 끝나 청산하지 못한 거래는 null(집계 제외).
export function simulateTrade(candles, entryIdx, params) {
  const { slPct, tpPct, holdMax } = params
  const entryCandle = candles[entryIdx + 1]
  if (!entryCandle || !(entryCandle.open > 0)) return null
  const entry = entryCandle.open
  const { stopLoss, takeProfit } = strategyLevels(entry, { slPct, tpPct })
  const last = entryIdx + holdMax
  for (let i = entryIdx + 1; i <= last && i < candles.length; i++) {
    const r = resolveExit(candles[i], entry, stopLoss, takeProfit, i === last)
    if (r) return { ret: r.ret, exitIdx: i, reason: r.reason }
  }
  return null
}

// 라이브 전략픽 자동 채점 — 진입가(스캔 시점 가격) 기준 D+1..D+holdMax 확정봉으로 청산 판정.
// 백테스트 simulateTrade(다음봉 시가 진입)와 달리 라이브는 스캔가에 진입했다고 본다.
// 같은 봉 SL·TP 동시 도달 시 손절 우선(보수적). 캔들 결손일은 건너뜀.
// 반환: {reason:'sl'|'tp'|'time', ret, exitDay} | {reason:'open'}(진행 중) | {reason:'no-data'}
export function scoreStrategyOutcome(ep, confirmed, params, nowMs) {
  const { holdMax } = params
  if (!(ep.entryPrice > 0)) return { reason: 'no-data' }
  const lv = strategyLevels(ep.entryPrice, params)
  const d0 = Math.floor(Date.parse(ep.entryTs) / 1000 / 86400)
  const nowDay = Math.floor(nowMs / 1000 / 86400)
  const byDay = new Map((confirmed ?? []).map((c) => [Math.floor(c.time / 86400), c]))
  for (let i = d0 + 1; i <= d0 + holdMax; i++) {
    const c = byDay.get(i)
    if (!c) continue
    const r = resolveExit(c, ep.entryPrice, lv.stopLoss, lv.takeProfit, i === d0 + holdMax)
    if (r) return { reason: r.reason, ret: r.ret, exitDay: i - d0 }
  }
  // 시간청산 유예: D+holdMax 봉 자체가 결손(거래정지·무거래)이면 유예 3일 내 첫 봉 종가로 청산.
  // 무거래 기간엔 가격이 움직이지 않았으므로 재개 첫 봉 종가가 경제적으로 정확한 청산가.
  for (let i = d0 + holdMax + 1; i <= d0 + holdMax + 3; i++) {
    const c = byDay.get(i)
    if (c) return { reason: 'time', ret: c.close / ep.entryPrice - 1, exitDay: i - d0 }
  }
  return nowDay > d0 + holdMax + 3 ? { reason: 'no-data' } : { reason: 'open' }
}

// 각 인덱스에서의 시그니처 판정 배열 — detectQuietBottom(slice(0,i+1))과 동치, O(n).
// 백테스트에서 (rsiMax,stochMax,volMax) 조합당 히스토리 1회 순회로 신호일을 뽑는다.
// 지표 시리즈는 indicators.mjs의 공용 함수 사용 (점 계산 함수와의 동치성은 indicators 테스트가 보증).
export function quietBottomSeries(confirmed, params) {
  const { rsiMax, stochMax, volMax, minCandles = 60 } = params ?? {}
  const n = Array.isArray(confirmed) ? confirmed.length : 0
  const out = new Array(n).fill(false)
  if (n === 0) return out
  const closes = confirmed.map((c) => c.close)
  const highs = confirmed.map((c) => c.high)
  const lows = confirmed.map((c) => c.low)
  const volumes = confirmed.map((c) => c.volume)
  const rsiS = calcRSISeries(closes)
  const kS = calcStochasticKSeries(highs, lows, closes)
  const vS = calcVolRatioSeries(volumes)
  const first = Math.max(minCandles, 22) - 1
  for (let i = first; i < n; i++) {
    if (rsiS[i] == null || kS[i] == null || vS[i] == null) continue
    out[i] = rsiS[i] <= rsiMax && kS[i] <= stochMax && vS[i] <= volMax
  }
  return out
}
