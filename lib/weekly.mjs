import { newWeight } from './store.mjs'

const MIN_SAMPLES = 3
const SIGNAL_KEYS = [
  'MACD 골든크로스', 'MACD 반등', 'MACD 상승', 'MACD 데드크로스', 'MACD 하락전환', 'MACD 하락',
  'RSI 과매도', 'RSI 과매수', 'BB 하단 지지', 'BB 상단 돌파',
  'Stoch 과매도 골든크로스', 'Stoch 과매도', 'Stoch 과매수 데드크로스', 'Stoch 과매수',
  'Williams %R 과매도', 'Williams %R 과매수',
  'EMA 20/50 골든크로스', 'EMA 상승배열', 'EMA 20/50 데드크로스', 'EMA 하락배열',
  '거래량 급증', '쌍봉 패턴', '하락깃발 패턴', '역삼중바닥 패턴', '상승깃발 패턴', '상승삼각형 패턴',
]

export function judgeHit(side, signalPrice, currentPrice) {
  return side === 'buy' ? currentPrice > signalPrice : currentPrice < signalPrice
}

function keyOf(label) {
  return SIGNAL_KEYS
    .filter((k) => label.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
}

export function aggregateHitRates(records) {
  const acc = {}
  for (const rec of records) {
    for (const label of rec.signals) {
      const key = keyOf(label)
      if (!key) continue
      acc[key] ??= { count: 0, hits: 0 }
      acc[key].count++
      if (rec.hit) acc[key].hits++
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(acc)) {
    out[k] = { count: v.count, hitRate: v.count ? v.hits / v.count : 0 }
  }
  return out
}

export function updateWeights(weights, stats) {
  const out = { ...weights }
  for (const [key, { count, hitRate }] of Object.entries(stats)) {
    if (count < MIN_SAMPLES) continue
    out[key] = newWeight(out[key] ?? 1, hitRate)
  }
  return out
}
