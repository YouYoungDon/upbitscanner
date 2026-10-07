// lib/news/match.mjs
// 뉴스·공지 → 업비트 KRW 마켓. 제목만 본다(본문은 언급이 넓어 오탐이 많다 — 본문의 코인은 소스 codes가 담당).
import { parseTickers } from '../exchange-events.mjs'

// 일반 영단어와 겹치는 티커 — 영문 단독 매칭에서 제외(괄호·소스 코드 매칭은 허용).
export const AMBIGUOUS_TICKERS = new Set(['ONE', 'GAS', 'MOVE', 'AI', 'ME', 'IQ', 'T', 'ID', 'CAT', 'BIG', 'JOE', 'MAX', 'NOT', 'OPEN', 'POND', 'SIGN', 'SAFE', 'TRUMP', 'HUNT', 'GO', 'LA', 'ZK', 'XAI', 'USD'])

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function buildMatcher(markets) {
  const byTicker = new Map(markets.map((m) => [m.market.replace('KRW-', ''), m.market]))
  const ko = markets
    .filter((m) => (m.korean_name || '').length >= 3)
    .map((m) => ({ market: m.market, re: new RegExp(`(?<![가-힣])${escapeRe(m.korean_name)}(?![가-힣])`) }))
  const en = [...byTicker.entries()]
    .filter(([t]) => t.length >= 3 && !AMBIGUOUS_TICKERS.has(t))
    .map(([t, market]) => ({ market, re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(t)}(?![A-Za-z0-9])`) }))

  return (item) => {
    const via = {}
    const add = (market, how) => { if (market && !via[market]) via[market] = how }
    for (const c of item.codes || []) add(byTicker.get(c), 'code')
    const title = item.title || ''
    for (const t of parseTickers(title)) add(byTicker.get(t), 'paren')
    for (const k of ko) if (k.re.test(title)) add(k.market, 'ko')
    for (const e of en) if (e.re.test(title)) add(e.market, 'en')
    return { markets: Object.keys(via), via }
  }
}
