// 김치 프리미엄 — 업비트(KRW) vs 바이낸스(USDT) 가격 괴리. 표시·경고 전용(점수 미개입).
// 환율 = 업비트 KRW-USDT 시세(외부 FX 없음). 바이낸스는 매 스캔 신선 조회(가격 드리프트 방지).
import { getTicker } from './upbit.mjs'
import { fetchBinancePrices } from './binance.mjs'

// 게이지 밴드(BTC 프리미엄) · 코인 플래그(BTC 대비 상대) 임계
export const OVERHEAT_PCT = 0.03
export const DISCOUNT_PCT = -0.01
export const COIN_FLAG_PCT = 0.03

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// KRW / (USDT * 환율) - 1. 입력 하나라도 비유한/≤0이면 null.
export function computePremium(krwPrice, binanceUsdt, usdtKrw) {
  if (!finite(krwPrice) || krwPrice <= 0) return null
  if (!finite(binanceUsdt) || binanceUsdt <= 0) return null
  if (!finite(usdtKrw) || usdtKrw <= 0) return null
  return krwPrice / (binanceUsdt * usdtKrw) - 1
}

// 'KRW-BTC' → 'BTCUSDT'
export function mapToBinance(market) {
  return market.replace(/^KRW-/, '') + 'USDT'
}

// 게이지 밴드 분류. null → null.
export function premiumBand(pct) {
  if (!finite(pct)) return null
  if (pct >= OVERHEAT_PCT) return 'overheat'
  if (pct <= DISCOUNT_PCT) return 'discount'
  return 'normal'
}

// 코인 플래그: BTC 프리미엄 대비 상대(베이스라인 보정). 둘 중 하나 null → null.
export function coinFlag(coinPremium, btcPremium) {
  if (!finite(coinPremium) || !finite(btcPremium)) return null
  const diff = coinPremium - btcPremium
  if (diff >= COIN_FLAG_PCT) return 'overheat'
  if (diff <= -COIN_FLAG_PCT) return 'discount'
  return null
}

// 스캐너 진입점. krwPrices: {market: 업비트 현재가}. 어떤 실패에도 스캔 불사침.
// 반환: { byMarket:{market:{premium,binanceUsdt}}, btcPremium, usdtKrw, coverage, fetchedAt, reason? }
export async function ensureKimchi(krwPrices, { now = Date.now(), deps = {} } = {}) {
  const d = { fetchBinancePrices, getTicker, ...deps }
  const markets = Object.keys(krwPrices || {})
  const neutral = (reason, usdtKrw = null) => ({
    byMarket: {}, btcPremium: null, usdtKrw, coverage: 0, reason,
    fetchedAt: new Date(now).toISOString(),
  })
  try {
    if (!markets.length) return neutral('no-targets')
    const [prices, rateRows] = await Promise.all([
      d.fetchBinancePrices(),
      d.getTicker(['KRW-USDT']),
    ])
    if (!prices) return neutral('binance-fail')
    const usdtKrw = rateRows?.find?.((r) => r.market === 'KRW-USDT')?.trade_price ?? null
    if (!finite(usdtKrw) || usdtKrw <= 0) return neutral('no-fx')
    const byMarket = {}
    for (const m of markets) {
      const usdt = prices.get(mapToBinance(m))
      const premium = computePremium(krwPrices[m], usdt, usdtKrw)
      if (premium != null) byMarket[m] = { premium, binanceUsdt: usdt }
    }
    return {
      byMarket,
      btcPremium: byMarket['KRW-BTC']?.premium ?? null,
      usdtKrw,
      coverage: markets.length ? Object.keys(byMarket).length / markets.length : 0,
      fetchedAt: new Date(now).toISOString(),
    }
  } catch {
    return neutral('error')
  }
}
