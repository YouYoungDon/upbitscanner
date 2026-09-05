// 구조 리스크 스크린 — 물량 잠김(언락 오버행)·거래소 유의지정으로 매수 점수 감점(방어).
// 기존 데이터(coingecko circRatio·athChangePct·rank + 거래소 caution)만 사용, 새 fetch 없음.
// 소폰(-86%) 재발 방지. 감점만(제외 X), 최종 판단은 사용자.
import { finite } from './num.mjs'

export const OVERHANG_SEVERE = 0.3    // circRatio<0.3 = 물량 70%+ 잠김
export const OVERHANG_ELEVATED = 0.5  // circRatio<0.5 = 물량 50%+ 잠김
export const MULT_FLOOR = 0.7         // 감점 하한(방어적 캡)
export const ATH_BROKEN = -90         // ATH 대비 −90%↓ = 차트 붕괴(컨텍스트)
export const RANK_OBSCURE = 500       // rank>500 = 무명(컨텍스트)

function levelOf(mult) {
  if (mult >= 1) return 'none'
  if (mult >= 0.9) return 'low'
  if (mult >= 0.8) return 'mid'
  return 'high'
}

// { circRatio, athChangePct, rank, caution } → { mult, flags, level }.
// 감점은 언락 오버행 + 거래소 주의 2개만. ATH·rank는 컨텍스트 플래그(감점 없음).
export function structuralRisk({ circRatio, athChangePct, rank, caution } = {}) {
  let mult = 1
  const flags = []

  if (finite(circRatio)) {
    if (circRatio < OVERHANG_SEVERE) { mult *= 0.85; flags.push(`언락오버행(유통 ${Math.round(circRatio * 100)}%)`) }
    else if (circRatio < OVERHANG_ELEVATED) { mult *= 0.93; flags.push(`언락오버행(유통 ${Math.round(circRatio * 100)}%)`) }
  }
  if (caution) { mult *= 0.90; flags.push('거래소 주의') }

  mult = Math.max(mult, MULT_FLOOR)

  // 컨텍스트 플래그 — 감점 없음(약세장 알트·무명 과제외 방지). 오버행/주의와 겹치면 소폰 패턴 경보.
  if (finite(athChangePct) && athChangePct <= ATH_BROKEN) flags.push(`ATH ${Math.round(athChangePct)}%`)
  if (finite(rank) && rank > RANK_OBSCURE) flags.push(`저순위 ${rank}위`)

  return { mult: +mult.toFixed(4), flags, level: levelOf(mult) }
}
