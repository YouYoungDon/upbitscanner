// 매수 점수 배수군 — 레짐·유동성·dominance·낙하칼·펀딩·구조리스크·거래소이벤트를 순서대로 적용.
// monitor 루프에서 추출(테스트 가능). 순수: 입력 signals 불변, 새 배열 반환.
// MTF·SMC 가산·지속성 보너스는 순서가 이 체인 밖이라 호출부(monitor)에 남는다.
import { liquidityPenalty, upbitDominancePenalty } from './scan-universe.mjs'
import { fallingKnifePenalty } from './signals.mjs'
import { fundingScoreMult, fundingSignal } from './funding.mjs'
import { structuralRisk } from './structural-risk.mjs'

// baseScore, signals(배열), ctx → { score, signals, lowLiq, dom, funding:{rate,mult}, structuralRisk, eventRisk }.
export function applyBuyModifiers(baseScore, signals, ctx = {}) {
  const {
    regimeTrend, tradePrice24h, globalVolKrw, sellSignals = [],
    fundingRate, circRatio, athChangePct, rank, caution, eventRisk,
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
  // 추격 감점(volRatio>=5 ×0.8)은 2026-10-06 제거했다 — 측정상 역효과였다.
  // 기록된 픽 1,557건 분석: 이 라벨이 붙은 픽의 79%(n=126)는 가격이 오르지 않은 상태였고
  // 승률 55%·중앙값 +1.3%로 기준선(50%/+0.1%)을 오히려 상회하는데 ×0.8을 먹고 있었다.
  // 분류기로서 정밀도 21%·재현율 45% — 거래량 배율은 "추격"의 대리변수로 부적합하다.
  // 가격 상승폭 기준 대체(과열 필터)는 사전등록 규칙이 임계값 선정을 거부해 보류 상태다
  // (스펙 docs/superpowers/specs/2026-10-03-exit-rule-overextension-design.md §10).
  // 보호를 잃는 것이 아니다: 실제 가격 과열군의 55%는 이 감점이 애초에 잡지 못했다.
  // 펀딩비 점수 개입: (+)과밀 감점·(−)스퀴즈 가산
  const fundMult = fundingScoreMult(fundingRate)
  if (fundMult !== 1) { score *= fundMult; sig.push(fundingSignal(fundingRate)) }
  // 구조 리스크 감점: 언락 오버행·거래소 주의
  const sr = structuralRisk({ circRatio, athChangePct, rank, caution })
  if (sr.mult < 1) { score *= sr.mult; sig.push(`⚠️구조리스크(${sr.flags.join('·')})`) }

  // 거래소 이벤트 감점: 상폐(mult 0=제외)·유의·입출금중단 (lib/exchange-events)
  const er = eventRisk && typeof eventRisk.mult === 'number' ? eventRisk : { mult: 1, label: null }
  if (er.mult < 1) { score *= er.mult; if (er.label) sig.push(er.label) }

  return { score, signals: sig, lowLiq, dom, funding: { rate: fundingRate, mult: fundMult }, structuralRisk: sr, eventRisk: er }
}
