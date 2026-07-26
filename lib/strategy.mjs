// 조용한 바닥(선행 진입) 전략 — 순수 함수.
// 검증 근거: 스코어카드 6주 — 거래량 조용한 깊은 과매도 진입이 추격 대비 우위
// (docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md)
// 파라미터는 data/strategy-config.json (백테스트로만 갱신, 주간 가중치 학습과 무관).
import { calcRSI, calcStochastic, calcVolRatio } from './indicators.mjs'

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
