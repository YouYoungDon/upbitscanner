import { calcEMA } from './indicators.mjs'

// BTC 일봉 EMA 배열로 시장 추세 판정 (반등 스캐너의 사전 레짐 게이트).
export function btcRegime(ohlcv) {
  if (!Array.isArray(ohlcv) || ohlcv.length < 60) return { trend: 'neutral' }
  const closes = ohlcv.map((c) => c.close)
  const e20 = calcEMA(closes, 20).at(-1)
  const e50 = calcEMA(closes, 50).at(-1)
  const e200 = calcEMA(closes, 200).at(-1)
  if (e20 > e50 && e50 > e200) return { trend: 'bull' }
  if (e20 < e50) return { trend: 'bear' }
  return { trend: 'neutral' }
}

// 시장 폭(ratio=매수÷매도) + BTC 추세 → 표시용 레짐 라벨.
export function regimeLabel(ratio, trend) {
  if (trend === 'bull' && ratio >= 0.5) return { label: '확장', emoji: '🟢' }
  if (trend === 'bear' || ratio < 0.3) return { label: '수축', emoji: '🔴' }
  return { label: '중립', emoji: '🟡' }
}
