// 조용한 바닥(선행 진입) 전략 — 순수 함수.
// 검증 근거: 스코어카드 6주 — 거래량 조용한 깊은 과매도 진입이 추격 대비 우위
// (docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md)
// 파라미터는 data/strategy-config.json (백테스트로만 갱신, 주간 가중치 학습과 무관).
import { calcRSI, calcRSISeries, calcStochastic, calcVolRatio } from './indicators.mjs'

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

// 백테스트 거래 시뮬레이션. 진입은 신호봉(entryIdx) 다음봉 시가 — 룩어헤드 방지.
// 보유는 진입봉 포함 최대 holdMax봉. 한 봉에서 손절·목표 동시 도달 시 손절 우선(보수적).
// 히스토리가 끝나 청산하지 못한 거래는 null(집계 제외).
export function simulateTrade(candles, entryIdx, params) {
  const { slPct, tpPct, holdMax } = params
  const entryCandle = candles[entryIdx + 1]
  if (!entryCandle || !(entryCandle.open > 0)) return null
  const entry = entryCandle.open
  const { stopLoss, takeProfit } = strategyLevels(entry, { slPct, tpPct })
  const last = entryIdx + holdMax
  for (let i = entryIdx + 1; i <= last && i < candles.length; i++) {
    const c = candles[i]
    if (c.low <= stopLoss) return { ret: stopLoss / entry - 1, exitIdx: i, reason: 'sl' }
    if (c.high >= takeProfit) return { ret: takeProfit / entry - 1, exitIdx: i, reason: 'tp' }
    if (i === last) return { ret: c.close / entry - 1, exitIdx: i, reason: 'time' }
  }
  return null
}

// Stoch K 시리즈 (calcStochastic의 k와 프리픽스 단위로 동치 — 동치성은 테스트로 보증)
function stochKSeries(highs, lows, closes, period = 14, sk = 3) {
  const n = closes.length
  const rawK = new Array(n).fill(null)
  for (let i = period - 1; i < n; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1))
    const l = Math.min(...lows.slice(i - period + 1, i + 1))
    rawK[i] = h === l ? 50 : ((closes[i] - l) / (h - l)) * 100
  }
  const out = new Array(n).fill(null)
  for (let i = period - 1 + sk - 1; i < n; i++) {
    let s = 0
    for (let j = i - sk + 1; j <= i; j++) s += rawK[j]
    out[i] = s / sk
  }
  return out
}

// 각 인덱스에서의 시그니처 판정 배열 — detectQuietBottom(slice(0,i+1))과 동치, O(n).
// 백테스트에서 (rsiMax,stochMax,volMax) 조합당 히스토리 1회 순회로 신호일을 뽑는다.
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
  const kS = stochKSeries(highs, lows, closes)
  const first = Math.max(minCandles, 22) - 1
  for (let i = first; i < n; i++) {
    if (rsiS[i] == null || kS[i] == null || i < 20) continue
    let avg = 0
    for (let j = i - 20; j < i; j++) avg += volumes[j]
    avg /= 20
    if (avg <= 0) continue
    const volRatio = volumes[i] / avg
    out[i] = rsiS[i] <= rsiMax && kS[i] <= stochMax && volRatio <= volMax
  }
  return out
}
