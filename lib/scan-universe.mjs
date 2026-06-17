import { getMarkets, getTicker } from './upbit.mjs'

// 두 스캐너(monitor·momentum) 공용 스캔 설정/유니버스 구성.
export const BATCH = 5
export const DELAY = 200
export const MIN_TRADE_PRICE_24H = 100_000_000 // 1억원 (스캔 하한)
export const LOW_LIQUIDITY_24H = 300_000_000   // 3억원 미만 = 저유동성 경고
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 스캔 대상 유니버스: 마켓 전체 중 24h 거래대금 임계 이상인 종목.
// deps(getMarkets/getTicker/delay) 주입으로 테스트 가능. → { targets, nameOf, total }
export async function getScanUniverse({
  getMarkets: gm = getMarkets,
  getTicker: gt = getTicker,
  minTradePrice = MIN_TRADE_PRICE_24H,
  delay = DELAY,
} = {}) {
  const markets = await gm()
  if (!markets || !markets.length) return { targets: [], nameOf: {}, total: 0 }
  const codes = markets.map((m) => m.market)
  const tickers = []
  for (let i = 0; i < codes.length; i += 100) {
    const t = await gt(codes.slice(i, i + 100))
    if (t) tickers.push(...t)
    await sleep(delay)
  }
  const liquid = new Set(tickers.filter((t) => t.acc_trade_price_24h >= minTradePrice).map((t) => t.market))
  const nameOf = Object.fromEntries(markets.map((m) => [m.market, m.korean_name]))
  const tradePrice = Object.fromEntries(tickers.map((t) => [t.market, t.acc_trade_price_24h]))
  return { targets: codes.filter((c) => liquid.has(c)), nameOf, total: codes.length, tradePrice }
}
