const BASE = 'https://api.upbit.com/v1'
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'USD1', 'TUSD', 'BUSD'])

async function get(url) {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    return r.ok ? r.json() : null
  } catch {
    return null
  }
}

export async function getMarkets() {
  const all = await get(`${BASE}/market/all?isDetails=false`)
  if (!all) return []
  return all.filter((m) => {
    if (!m.market.startsWith('KRW-')) return false
    const sym = m.market.split('-')[1]
    return !STABLES.has(sym)
  })
}

export async function getDayCandles(market, count = 200) {
  return get(`${BASE}/candles/days?market=${market}&count=${count}`)
}

// 특정 시점(toIso, ISO8601) 이전 일봉 (시간별 적중률 계산용)
export async function getDayCandlesBefore(market, toIso, count = 1) {
  return get(`${BASE}/candles/days?market=${market}&count=${count}&to=${encodeURIComponent(toIso)}`)
}

// 분봉 (멀티 타임프레임용, unit=240 → 4시간봉)
export async function getMinuteCandles(market, unit = 240, count = 60) {
  return get(`${BASE}/candles/minutes/${unit}?market=${encodeURIComponent(market)}&count=${count}`)
}

export async function getTicker(markets) {
  const list = Array.isArray(markets) ? markets.join(',') : markets
  return get(`${BASE}/ticker?markets=${list}`)
}

export function candlesToOhlcv(candles) {
  return [...candles].reverse().map((c) => ({
    open: c.opening_price,
    close: c.trade_price,
    high: c.high_price,
    low: c.low_price,
    volume: c.candle_acc_trade_volume,
  }))
}
