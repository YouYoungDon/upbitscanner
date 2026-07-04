import { getMarkets, getTicker } from './upbit.mjs'

// 두 스캐너(monitor·momentum) 공용 스캔 설정/유니버스 구성.
export const BATCH = 5
export const DELAY = 200
export const MIN_TRADE_PRICE_24H = 100_000_000 // 1억원 (스캔 하한)
export const LOW_LIQUIDITY_24H = 500_000_000   // 5억원 미만 = 저유동성(메인 분리)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 24h 거래대금 → 점수 배수 (구간별 차등)
export function liquidityMultiplier(tradePrice24h) {
  const v = tradePrice24h ?? 0
  if (v >= 5_000_000_000) return 1.0   // 50억+
  if (v >= 2_000_000_000) return 0.9   // 20~50억
  if (v >= 500_000_000) return 0.8     // 5~20억
  return 0.6                           // 1~5억
}

// 유동성 차등 결과(두 스캐너 공용) → { liqMult, lowLiq, label }.
// liqMult<1이면 점수 감점(적용은 호출부), label은 그때만 부여. lowLiq는 메인/저유동성 분리 플래그.
export function liquidityPenalty(tradePrice24h) {
  const tp = tradePrice24h ?? 0
  const liqMult = liquidityMultiplier(tp)
  const lowLiq = tp < LOW_LIQUIDITY_24H
  const label = liqMult < 1 ? `⚠️유동성 ×${liqMult}` : null
  return { liqMult, lowLiq, label }
}

// 업비트 단독 펌프 감지: 글로벌(코인게코) 24h 거래대금 대비 업비트 비중.
// 데이터 없으면 중립(신규 상장·미등록 코인은 위험이 아니라 미확인). share는 집계 시차 대비 1로 캡.
export function upbitDominancePenalty(upbit24hKrw, globalVolKrw) {
  if (upbit24hKrw == null || !globalVolKrw || globalVolKrw <= 0) return { mult: 1.0, share: null, label: null }
  // Math.round 기반 반올림: toFixed는 0.7995 같은 이진 경계값을 내림해 라벨(%)과 티어가 어긋남
  const share = Math.round(Math.min(1, upbit24hKrw / globalVolKrw) * 1000) / 1000
  const pct = Math.round(share * 100)
  if (share >= 0.8) return { mult: 0.8, share, label: `⚠️업비트단독 ${pct}%` }
  if (share >= 0.5) return { mult: 0.9, share, label: `⚠️업비트비중 ${pct}%` }
  return { mult: 1.0, share, label: null }
}

// 스캔 대상 유니버스: 마켓 전체 중 24h 거래대금 임계 이상인 종목.
// deps(getMarkets/getTicker/delay) 주입으로 테스트 가능. → { targets, nameOf, total }
export async function getScanUniverse({
  getMarkets: gm = getMarkets,
  getTicker: gt = getTicker,
  minTradePrice = MIN_TRADE_PRICE_24H,
  delay = DELAY,
  marketRetries = 3,
  marketRetryDelay = 2000,
} = {}) {
  // 마켓 목록은 스캔의 사활 — 실패하면 두 스캐너 모두 빈 유니버스로 process.exit(1)(로그 공백).
  // get()의 짧은 재시도(~0.9s)로 못 막는 다초 업스트림 장애를 더 긴 백오프로 흡수.
  let markets = await gm()
  for (let attempt = 0; (!markets || !markets.length) && attempt < marketRetries; attempt++) {
    await sleep(marketRetryDelay * (attempt + 1))
    markets = await gm()
  }
  if (!markets || !markets.length) return { targets: [], nameOf: {}, total: 0, warnOf: {} }
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
  // 투자유의 플래그: warning(경고)·caution(주의)인 종목만 매핑 (정상은 키 없음)
  const warnOf = {}
  for (const m of markets) {
    if (m.warning) warnOf[m.market] = 'warning'
    else if (m.caution) warnOf[m.market] = 'caution'
  }
  return { targets: codes.filter((c) => liquid.has(c)), nameOf, total: codes.length, tradePrice, warnOf }
}
