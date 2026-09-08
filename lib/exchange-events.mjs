// 거래소 이벤트 방어 스크린 — 공식 공지 제목을 분류해 매수 점수 감점/제외(방어).
// 업비트=주 소스, 바이낸스=보조. 소폰(-86%) 마이그레이션 재발 방지. 최종 판단은 사용자.

// 규칙 순서 중요: 상폐(최강) → 재개/해제(중단/유의보다 먼저) → 유의 → 입출금중단 → 신규상장.
// "유의 종목 지정 해제"가 "유의 종목 지정"보다, "입출금 재개"가 "입출금 중단"보다 먼저 매칭돼야 한다.
export const EVENT_RULES = [
  { type: 'delist',  severity: 'critical', mult: 0,   ttlDays: 90, re: /거래지원\s*종료|상장\s*폐지|디지털\s*자산.*폐지|will\s+delist|delisting/i },
  { type: 'resume',  severity: 'clear',    mult: 1,   ttlDays: 0,  re: /입출금\s*(지원)?\s*재개|거래\s*재개|유의\s*종목\s*지정\s*해제|모니터링\s*(태그)?\s*해제/i },
  { type: 'caution', severity: 'high',     mult: 0.5, ttlDays: 30, re: /유의\s*종목\s*지정|유의\s*촉구|monitoring\s*tag|투자\s*유의/i },
  { type: 'halt',    severity: 'mid',      mult: 0.7, ttlDays: 14, re: /입출금\s*(일시)?\s*중단|네트워크\s*전환|마이그레이션|토큰\s*스왑|migration|token\s*swap/i },
  { type: 'listing', severity: 'neutral',  mult: 1,   ttlDays: 0,  re: /신규\s*거래지원|추가\s*거래지원|will\s+list|seed\s*tag/i },
]

// 제목 → { type, severity, mult, ttlDays } | null. 첫 매칭 규칙 채택.
export function classifyAnnouncement(title) {
  if (typeof title !== 'string') return null
  for (const r of EVENT_RULES) {
    if (r.re.test(title)) return { type: r.type, severity: r.severity, mult: r.mult, ttlDays: r.ttlDays }
  }
  return null
}

// 제목의 괄호 안 대문자 티커 추출: "소폰(SOPH)" → ['SOPH']. 마켓표기 "(KRW, BTC 마켓)"은 미매칭.
export function parseTickers(title) {
  if (typeof title !== 'string') return []
  const out = []
  const re = /\(([A-Z0-9]{2,10})\)/g
  let m
  while ((m = re.exec(title))) out.push(m[1])
  return [...new Set(out)]
}

// 티커 → 유니버스에 존재하는 KRW- 마켓만.
export function matchMarkets(tickers, universeSet) {
  const out = []
  for (const t of tickers || []) { const m = `KRW-${t}`; if (universeSet.has(m)) out.push(m) }
  return out
}

const TYPE_KO = { delist: '상폐', caution: '유의지정', halt: '입출금중단' }
const EX_KO = { upbit: '업비트', binance: '바이낸스' }

// 종목의 활성 이벤트들 → 가장 강한(min mult) 배수 + 표시 라벨.
export function eventRiskMult(events) {
  if (!events || !events.length) return { mult: 1, label: null }
  let worst = events[0]
  for (const e of events) if (e.mult < worst.mult) worst = e
  const label = `⚠️거래소이벤트(${TYPE_KO[worst.type] || worst.type}·${EX_KO[worst.exchange] || worst.exchange})`
  return { mult: worst.mult, label }
}
