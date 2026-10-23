// 모의매매 장부 정의 — 어느 스캔 로그에서 무엇을 사고, 몇 단계에서 처리하고, 한도가 얼마인지.
// 1단계 = 기존 3장부(50만 원·최대 10건, PAPER 값). 11-05까지 규칙 고정이라 한도 필드를 두지 않는다.
// 2단계 = 1,000만 원 XL 3장부(10-22~, 설계 docs/superpowers/specs/2026-10-22-paper-xl-books-design.md).
//   건당 금액은 그대로(5만 원 — 체결 비용 조건이 같다)이고 보유 상한만 올려 스캐너 픽을 사실상 전부 산다.
//   한 실행에서 1단계를 먼저 끝낸다 — XL 보유가 수백 건이라 청산 확인이 길어져도 기존 장부의 진입 시각이 밀리지 않게.
import { PAPER } from './paper.mjs'
import { randomPicks } from './paper-random.mjs'

export const XL = { startCash: 10_000_000, maxOpen: 200, maxPerScan: 200 }

const mainPicks = (s) => s.buy
const momentumPicks = (s) => s.picks

// rule = exitRule에 넘기는 소스 이름('main'이면 픽의 exit(12/12/7)를 쓴다).
// matchCount = 그 스캔에서 이 장부가 살 개수를 다른 장부가 산 개수에 맞춘다(무작위 대조를 같은 규모로).
export const BOOKS = [
  { key: 'main', file: 'monitor-log.json', picksOf: mainPicks, rule: 'main', phase: 1 },
  { key: 'momentum', file: 'momentum-log.json', picksOf: momentumPicks, rule: 'momentum', phase: 1 },
  { key: 'random', file: 'monitor-log.json', picksOf: randomPicks, rule: 'random', phase: 1 },
  { key: 'main_xl', file: 'monitor-log.json', picksOf: mainPicks, rule: 'main', phase: 2, ...XL },
  { key: 'momentum_xl', file: 'momentum-log.json', picksOf: momentumPicks, rule: 'momentum', phase: 2, ...XL },
  { key: 'random_xl', file: 'monitor-log.json', picksOf: randomPicks, rule: 'random', phase: 2, ...XL, matchCount: 'main_xl' },
]

export const bookByKey = (key) => BOOKS.find((b) => b.key === key)

// 장부 한도 — 정의에 없으면 PAPER 값(기존 장부).
export const limitsOf = (def) => ({
  startCash: def?.startCash ?? PAPER.START_CASH,
  maxOpen: def?.maxOpen ?? PAPER.MAX_OPEN,
  maxPerScan: def?.maxPerScan ?? PAPER.MAX_PER_SCAN,
})

// 상태에서 그 장부가 scanAt 스캔에서 산 포지션 수(보유 + 청산).
export function matchCount(state, key, scanAt) {
  const b = state?.books?.[key]
  if (!b) return 0
  return [...(b.open ?? []), ...(b.closed ?? [])].filter((p) => p.scanAt === scanAt).length
}

// 평가금 한 점 — 장부별 현금 + 보유 수량 × 가격. 가격은 이번 현재가 → 마지막으로 받은 가격(lastPrice) → 진입가 순.
// 받은 현재가는 포지션에 lastPrice로 남긴다: 상폐 종목이나 시세 조회 실패 한 번에 모든 장부가 진입가로 찍혀
// 평가금 곡선·MDD에 가짜 점이 생기지 않게(10-22 리뷰 — XL로 보유 종목이 늘며 확률이 커졌다).
export function equityPoint(books, priceOf, at) {
  const point = { at }
  for (const [src, b] of Object.entries(books ?? {})) {
    let v = b.cash
    for (const p of b.open) {
      const px = priceOf?.[p.market]
      if (Number.isFinite(px)) p.lastPrice = px
      v += p.qty * (Number.isFinite(px) ? px : p.lastPrice ?? p.entryPrice)
    }
    point[src] = Math.round(v)
  }
  return point
}
