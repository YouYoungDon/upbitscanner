// 펀딩비 점수 신호 — 바이낸스 무기한선물 펀딩비를 매수 점수에 개입(단기 반전).
// 매수 스캐너 기준: (+)펀딩=롱 과밀→감점, (−)펀딩=숏 과밀 스퀴즈연료→가산. 비대칭(방어>공격).
import { mapToBinance } from './kimchi.mjs'
import { fetchFundingRates } from './binance.mjs'

export const FUND_EXTREME = 0.0010
export const FUND_ELEVATED = 0.0005

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// 점수 배수. rate null/비유한 → 1(무개입). 감점 세게(0.82), 가산 약하게(≤1.06).
export function fundingScoreMult(rate) {
  if (!finite(rate)) return 1
  if (rate >= FUND_EXTREME) return 0.82
  if (rate >= FUND_ELEVATED) return 0.92
  if (rate <= -FUND_EXTREME) return 1.06
  if (rate <= -FUND_ELEVATED) return 1.04
  return 1
}

// 시그널 라벨. 정상대는 null.
export function fundingSignal(rate) {
  if (!finite(rate)) return null
  if (rate >= FUND_EXTREME) return '⚡펀딩 과열'
  if (rate >= FUND_ELEVATED) return '⚡펀딩 경계'
  if (rate <= -FUND_EXTREME) return '⚡펀딩 스퀴즈연료(강)'
  if (rate <= -FUND_ELEVATED) return '⚡펀딩 스퀴즈연료'
  return null
}

function median(nums) {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// 스캐너 진입점. markets: 펀딩 조회할 업비트 마켓 리스트. 어떤 실패에도 스캔 불사침.
// 반환: { byMarket:{market:{rate,markPrice}}, medianRate, coverage, fetchedAt, reason? }
export async function ensureFunding(markets, { now = Date.now(), deps = {} } = {}) {
  const d = { fetchFundingRates, ...deps }
  const list = [...new Set(markets || [])]
  const neutral = (reason) => ({
    byMarket: {}, medianRate: null, coverage: 0, reason,
    fetchedAt: new Date(now).toISOString(),
  })
  try {
    if (!list.length) return neutral('no-targets')
    const rates = await d.fetchFundingRates()
    if (!rates) return neutral('binance-fail')
    const byMarket = {}
    for (const m of list) {
      const f = rates.get(mapToBinance(m))
      if (f && finite(f.rate)) byMarket[m] = { rate: f.rate, markPrice: f.markPrice ?? null }
    }
    return {
      byMarket,
      medianRate: median(Object.values(byMarket).map((v) => v.rate)),
      coverage: list.length ? Object.keys(byMarket).length / list.length : 0,
      fetchedAt: new Date(now).toISOString(),
    }
  } catch {
    return neutral('error')
  }
}
