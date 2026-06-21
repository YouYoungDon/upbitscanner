import { calcEMA, calcRSI } from './indicators.mjs'

export const CONFIG = {
  minTradePrice24h: 10_000_000_000, // 유니버스 24h 하한 (100억)
  moneyWindow: 20,                  // 머니비율 직전 평균 봉 수
  min5mValue: 500_000_000,          // 5m 현재 거래대금 게이트 (5억)
  value5mBonus: 1_000_000_000,      // 5m 거래대금 보너스 임계 (10억)
  accelStrong: 1.5,                 // 머니가속도 보너스 임계
  exclude5mPct: 8,                  // 5m 변화 > +8% 하드배제
  exclude15mPct: 15,                // 15m 변화 > +15% 하드배제
  early1mMin: 0.5, early1mMax: 2.5, // 조기존 1m 범위(%)
  early30mMax: 10,                  // 조기존 30m 상한(%)
  breakoutLookback: 20,             // 돌파 직전 N개 5분봉
  near24hPct: 2,                    // 24h 고가 근접(%)
  consolRangePct: 3,                // consolidation 레인지 타이트(%)
  rsiMin: 50, rsiMax: 75,
  btcDropPct: -1,                   // BTC 5m < -1% → 감점
  btcPenalty: 0.8,
  suppressMs: 6 * 60 * 60 * 1000,   // 중복 억제창(6시간)
  reAlertRatio: 1.3,                // 점수 30%↑ 재알림
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length

export function tradingValues(ohlcv) {
  return (ohlcv || []).map((c) => c.tradeValue ?? 0)
}

export function moneyRatio(values, window = CONFIG.moneyWindow) {
  if (!values || values.length < window + 1) return null
  const avg = mean(values.slice(-1 - window, -1))
  if (!avg) return null
  return values.at(-1) / avg
}

function ratioAt(values, i, window) {
  if (i - window < 0) return null
  const avg = mean(values.slice(i - window, i))
  if (!avg) return null
  return values[i] / avg
}

export function moneyAcceleration(values, window = CONFIG.moneyWindow) {
  if (!values || values.length < window + 2) return null
  const last = values.length - 1
  const cur = ratioAt(values, last, window)
  const prev = ratioAt(values, last - 1, window)
  if (cur == null || prev == null || !prev) return null
  return cur / prev
}

export function pctChange(closes, nBack) {
  if (!closes || closes.length < nBack + 1) return null
  const base = closes.at(-1 - nBack)
  if (!base) return null
  return (closes.at(-1) / base - 1) * 100
}

export function isPumped(ch5m, ch15m) {
  return (ch5m != null && ch5m > CONFIG.exclude5mPct) || (ch15m != null && ch15m > CONFIG.exclude15mPct)
}

export function isEarlyZone(ch1m, ch30m) {
  return ch1m != null && ch30m != null &&
    ch1m >= CONFIG.early1mMin && ch1m <= CONFIG.early1mMax && ch30m < CONFIG.early30mMax
}
