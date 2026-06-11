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

export async function getTicker(markets) {
  const list = Array.isArray(markets) ? markets.join(',') : markets
  return get(`${BASE}/ticker?markets=${list}`)
}

export function candlesToOhlcv(candles) {
  return [...candles].reverse().map((c) => ({
    close: c.trade_price,
    high: c.high_price,
    low: c.low_price,
    volume: c.candle_acc_trade_volume,
  }))
}
