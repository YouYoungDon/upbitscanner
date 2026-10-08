// 김치 프리미엄 — 업비트(KRW) vs 바이낸스(USDT) 가격 괴리. 표시·경고 전용(점수 미개입).
// 환율 = 업비트 KRW-USDT 시세(외부 FX 없음). 바이낸스는 매 스캔 신선 조회(가격 드리프트 방지).
import { getTicker } from './upbit.mjs'
import { fetchBinancePrices } from './binance.mjs'
import { finite } from './num.mjs'

// 게이지 밴드(BTC 프리미엄) · 코인 플래그(BTC 대비 상대) 임계
export const OVERHEAT_PCT = 0.03
export const DISCOUNT_PCT = -0.01
export const COIN_FLAG_PCT = 0.03

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

// 스캐너 진입점. markets: 프리미엄 산출할 업비트 마켓 리스트(게이지용 'KRW-BTC' 포함 권장).
// 라이브 업비트 시세(getTicker)를 직접 조회 — 확정 종가가 아닌 현재가로 시점 정합. 어떤 실패에도 스캔 불사침.
// 반환: { byMarket:{market:{premium,binanceUsdt}}, btcPremium, usdtKrw, coverage, fetchedAt, reason? }
export async function ensureKimchi(markets, { now = Date.now(), deps = {} } = {}) {
  const d = { fetchBinancePrices, getTicker, ...deps }
  const list = [...new Set(markets || [])]
  const neutral = (reason) => ({
    byMarket: {}, btcPremium: null, usdtKrw: null, coverage: 0, reason,
    fetchedAt: new Date(now).toISOString(),
  })
  try {
    if (!list.length) return neutral('no-targets')
    const [prices, rows] = await Promise.all([
      d.fetchBinancePrices(),
      d.getTicker([...list, 'KRW-USDT']), // 1콜로 현재가 + 환율
    ])
    if (!prices) return neutral('binance-fail')
    const krwOf = Object.fromEntries((rows || []).map((r) => [r.market, r.trade_price]))
    const usdtKrw = krwOf['KRW-USDT'] ?? null
    if (!finite(usdtKrw) || usdtKrw <= 0) return neutral('no-fx')
    const byMarket = {}
    for (const m of list) {
      const usdt = prices.get(mapToBinance(m))
      const premium = computePremium(krwOf[m], usdt, usdtKrw)
      if (premium != null) byMarket[m] = { premium, binanceUsdt: usdt }
    }
    return {
      byMarket,
      btcPremium: byMarket['KRW-BTC']?.premium ?? null,
      usdtKrw,
      coverage: list.length ? Object.keys(byMarket).length / list.length : 0,
      fetchedAt: new Date(now).toISOString(),
    }
  } catch {
    return neutral('error')
  }
}

// 국내 과열 분리 — BTC 대비 코인 프리미엄이 COIN_FLAG_PCT(+3%p) 이상인 항목을 매수 목록에서 뺀다.
// 근거(2026-10-08, scripts/research/accumulation): 이 조건의 코인은 하루 늦게 진입하고 거래대금 50억↑로
// 좁혀도 3일 −2.3~−3.8%p, 7일 −4.0~−6.5%p(시장 대비, 모든 칸 t ≤ −2.2). 한국 돈 쏠림은 매집이 아니라 늦은 추격.
// 정도가 아니라 해당 여부를 측정했으므로 감점이 아니라 분리한다. 모든 항목에 kimchi{premium, rel, flag?}를 붙이고,
// 프리미엄 조회 실패(BTC 프리미엄 없음)면 아무것도 빼지 않는다(기존 동작 유지). 입력은 바꾸지 않는다.
// 티커 충돌 방어: 업비트와 바이낸스에서 같은 티커가 다른 코인이면(실측 2026-10-08: PROS 17배, DATA 수백 배)
// 프리미엄이 수천 %로 나온다. 진짜 프리미엄이 BTC 대비 ±100%p를 넘는 일은 사실상 없으므로 그 이상은 판단하지 않는다.
export const MISMATCH_REL = 1

export function splitPremiumHot(items, kimchi) {
  const keep = [], hot = []
  const btc = kimchi?.btcPremium
  for (const it of items ?? []) {
    const p = kimchi?.byMarket?.[it.market]?.premium
    if (!finite(p) || !finite(btc)) { keep.push(it); continue }
    if (Math.abs(p - btc) >= MISMATCH_REL) { keep.push({ ...it, kimchi: { mismatch: true } }); continue }
    const flag = coinFlag(p, btc)
    const out = { ...it, kimchi: { premium: p, rel: p - btc, ...(flag ? { flag } : {}) } }
    ;(flag === 'overheat' ? hot : keep).push(out)
  }
  return { keep, hot }
}

// 전 종목 국내 과열 목록 — BTC 대비 높은 순. BTC 자신과 USDT(환율 기준)는 제외.
export function premiumHotList(kimchi, nameOf = {}, limit = 15) {
  const btc = kimchi?.btcPremium
  if (!finite(btc)) return []
  return Object.entries(kimchi?.byMarket ?? {})
    .filter(([m, v]) => m !== 'KRW-BTC' && m !== 'KRW-USDT' && coinFlag(v.premium, btc) === 'overheat' &&
      Math.abs(v.premium - btc) < MISMATCH_REL)
    .map(([m, v]) => ({ market: m, korean_name: nameOf[m] ?? m.replace('KRW-', ''), premium: v.premium, rel: v.premium - btc }))
    .sort((a, b) => b.rel - a.rel)
    .slice(0, limit)
}
