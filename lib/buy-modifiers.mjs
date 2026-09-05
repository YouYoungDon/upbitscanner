// 매수 점수 배수군 — 레짐·유동성·dominance·낙하칼·추격·펀딩·구조리스크를 순서대로 적용.
// monitor 루프에서 추출(테스트 가능). 순수: 입력 signals 불변, 새 배열 반환.
// MTF·SMC 가산·지속성 보너스는 순서가 이 체인 밖이라 호출부(monitor)에 남는다.
import { liquidityPenalty, upbitDominancePenalty } from './scan-universe.mjs'
import { fallingKnifePenalty } from './signals.mjs'
import { fundingScoreMult, fundingSignal } from './funding.mjs'
import { structuralRisk } from './structural-risk.mjs'

// baseScore, signals(배열), ctx → { score, signals, lowLiq, dom, funding:{rate,mult}, structuralRisk }.
export function applyBuyModifiers(baseScore, signals, ctx = {}) {
  const {
    regimeTrend, tradePrice24h, globalVolKrw, sellSignals = [], volRatio, pump,
    fundingRate, circRatio, athChangePct, rank, caution,
  } = ctx
  let score = baseScore
  const sig = [...signals]

  // 레짐 게이트: BTC 약세장 반등 매수 신뢰도 하향
  if (regimeTrend === 'bear') { score *= 0.85; sig.push('[레짐] BTC 약세 감점') }
  // 유동성 차등 감점
  const { liqMult, lowLiq, label: liqLabel } = liquidityPenalty(tradePrice24h)
  if (liqMult < 1) { score *= liqMult; sig.push(liqLabel) }
  // 업비트 단독 펌프 감점 (글로벌 거래대금 대비 비중)
  const dom = upbitDominancePenalty(tradePrice24h, globalVolKrw)
  if (dom.mult < 1) { score *= dom.mult; sig.push(dom.label) }
  // 떨어지는 칼 필터
  const knife = fallingKnifePenalty(sig, sellSignals)
  if (knife.mult < 1) { score *= knife.mult; sig.push(knife.label) }
  // 추격 감점 ×0.8 (급증 후 진입). 🚀Pump Start는 면제.
  if (volRatio != null && volRatio >= 5 && !pump) { score *= 0.8; sig.push('⚠️추격주의(급등후)') }
  // 펀딩비 점수 개입: (+)과밀 감점·(−)스퀴즈 가산
  const fundMult = fundingScoreMult(fundingRate)
  if (fundMult !== 1) { score *= fundMult; sig.push(fundingSignal(fundingRate)) }
  // 구조 리스크 감점: 언락 오버행·거래소 주의
  const sr = structuralRisk({ circRatio, athChangePct, rank, caution })
  if (sr.mult < 1) { score *= sr.mult; sig.push(`⚠️구조리스크(${sr.flags.join('·')})`) }

  return { score, signals: sig, lowLiq, dom, funding: { rate: fundingRate, mult: fundMult }, structuralRisk: sr }
}
