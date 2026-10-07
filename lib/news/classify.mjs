// lib/news/classify.mjs
// 공식 공지(업비트·바이낸스·빗썸): 악재/해제는 기존 EVENT_RULES, 상장은 아래 규칙.
// 코인니스 뉴스: kind='news' + 키워드 태그(알림 문구·측정용, 점수 무관).
import { classifyAnnouncement, scopedOutsideKrw } from '../exchange-events.mjs'

const LISTING_RULES = [
  { source: 'upbit', type: 'upbit-krw', re: /KRW[^)]*마켓\s*디지털\s*자산\s*추가|신규\s*거래지원\s*안내\s*\([^)]*KRW/ },
  { source: 'binance', type: 'binance-futures', re: /Futures Will (Launch|List)|Will Launch .*Perpetual/i },
  { source: 'binance', type: 'binance-spot', re: /Will List|HODLer Airdrops|Launchpool|Megadrop/i },
  { source: 'bithumb', type: 'bithumb-krw', re: /원화\s*마켓\s*(추가|상장|디지털\s*자산\s*추가)/ },
]

export const NEWS_TAGS = {
  해킹: /해킹|익스플로잇|탈취|exploit|hack/i,
  규제: /SEC|소송|기소|제재|규제/,
  고래: /고래|이체|대량\s*(매수|매도|입금|출금)/,
  파트너십: /파트너십|MOU|협력|제휴/,
  언락: /언락|락업\s*해제|unlock/i,
  업그레이드: /메인넷|업그레이드|하드포크/,
  소각: /소각|바이백|buyback|burn/i,
}

export function classifyItem(item) {
  const title = item.title || ''
  if (item.source === 'coinness') {
    const tags = Object.entries(NEWS_TAGS).filter(([, re]) => re.test(title)).map(([k]) => k)
    return { kind: 'news', type: null, tags }
  }
  if (scopedOutsideKrw(title)) return { kind: 'official-other', type: null, tags: [] }
  const c = classifyAnnouncement(title)
  if (c && ['delist', 'caution', 'halt'].includes(c.type)) return { kind: 'official-risk', type: c.type, tags: [] }
  if (c && c.type === 'resume') return { kind: 'official-clear', type: 'resume', tags: [] }
  // 상장 '기념 이벤트' 공지는 상장 자체가 아니다(실제 상장 공지와 이중 알림 방지)
  const l = !/이벤트/.test(title) && LISTING_RULES.find((r) => r.source === item.source && r.re.test(title))
  if (l) return { kind: 'official-listing', type: l.type, tags: [] }
  return { kind: 'official-other', type: null, tags: [] }
}
