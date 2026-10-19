// 무작위 대조 장부 — 메인 스캔과 같은 시각, 메인 픽이 될 수 있었던 종목 중 무작위로 산다.
// "스캐너 픽 − 무작위 픽" = 같은 청산 규칙·비용·시장에서 고르는 실력만 남는다(설계 2026-10-19-paper-verdict-design.md §3.4).
import { splitPremiumHot } from './kimchi.mjs'
import { LOW_LIQUIDITY_24H } from './scan-universe.mjs'

// monitor가 스캔 기록에 남기는 후보 종목: 일봉 판정이 된 종목 중 거래대금 5억↑, 경고 아님, 국내 과열 아님
// (메인 매수 목록과 같은 제외 — 김치프 조회 실패면 과열로 빼지 않는다).
export function randomUniverse({ markets, tradePrice = {}, warnOf = {}, kimchi = null }) {
  const cand = (markets ?? []).filter((m) => (tradePrice[m] ?? 0) >= LOW_LIQUIDITY_24H && warnOf[m] !== 'warning')
  return splitPremiumHot(cand.map((market) => ({ market })), kimchi).keep.map((x) => x.market)
}

// 문자열 → 32비트 시드(FNV-1a), mulberry32 — 같은 스캔이면 언제 다시 돌려도 같은 순서.
function seedOf(s) {
  let h = 2166136261
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 스캔 → 셔플된 픽 전체(점수 0). paper의 selectEntries가 보유 종목을 빼고 앞에서 스캔당 상한만큼 자른다(안정 정렬).
// universe가 없는 예전 스캔은 빈 목록 — 사지 않는다.
export function randomPicks(scan) {
  if (!scan || !Array.isArray(scan.universe) || !scan.timestamp) return []
  const arr = [...scan.universe]
  const rnd = mulberry32(seedOf(String(scan.timestamp)))
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.map((market) => ({ market, korean_name: market.replace('KRW-', ''), price: null, score: 0, signals: ['무작위 대조'] }))
}
