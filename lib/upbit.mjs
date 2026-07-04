const BASE = 'https://api.upbit.com/v1'
const STABLES = new Set(['USDT', 'USDC', 'DAI', 'USD1', 'TUSD', 'BUSD'])

// 429/5xx/네트워크 오류 시 지수 백오프 재시도 (4xx는 즉시 포기 — 잘못된 요청).
async function get(url, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } })
      if (r.ok) return await r.json()
      if (attempt >= retries || (r.status < 500 && r.status !== 429)) return null
    } catch {
      if (attempt >= retries) return null
    }
    await new Promise((res) => setTimeout(res, 300 * (attempt + 1)))
  }
}

export async function getMarkets() {
  // isDetails=true → market_event(투자유의/주의) 플래그 포함
  const all = await get(`${BASE}/market/all?isDetails=true`)
  if (!all) return []
  return all
    .filter((m) => {
      if (!m.market.startsWith('KRW-')) return false
      const sym = m.market.split('-')[1]
      return !STABLES.has(sym)
    })
    .map((m) => {
      const ev = m.market_event || {}
      const caution = ev.caution && Object.values(ev.caution).some(Boolean)
      return { ...m, warning: !!ev.warning, caution: !!caution }
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
    time: c.candle_date_time_utc ? Math.floor(new Date(c.candle_date_time_utc + 'Z').getTime() / 1000) : undefined,
    open: c.opening_price,
    close: c.trade_price,
    high: c.high_price,
    low: c.low_price,
    volume: c.candle_acc_trade_volume,
    tradeValue: c.candle_acc_trade_price,
  }))
}
