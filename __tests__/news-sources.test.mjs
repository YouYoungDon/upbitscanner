// __tests__/news-sources.test.mjs
import { describe, it, expect, vi } from 'vitest'
import { parseCoinness, fetchCoinness } from '../lib/news/sources/coinness.mjs'
import { parseBithumbNotices, fetchBithumbNotices } from '../lib/news/sources/bithumb.mjs'
import { fetchUpbitNews, fetchBinanceNews } from '../lib/news/sources/exchanges.mjs'

const cn = [
  { id: 1171041, title: '익명 고래, $380만 ETH 매수', content: '본문', publishAt: '2026-10-07T21:51:40.528+09:00', isImportant: false, originCodes: ['ETH'], quickOrderCode: 'ETH', link: null },
  { id: 1171032, title: '서클, USDC·EURC 도입', content: null, publishAt: '2026-10-07T21:29:44.138+09:00', isImportant: true, originCodes: ['usdc', 'EURC'], quickOrderCode: null, link: 'https://x' },
]
const bt = [
  { categories: ['입출금'], title: '세이(SEI) 입출금 일시 중지 안내 (10/08 오후 6시~)', pc_url: 'https://feed.bithumb.com/notice/1655212', published_at: '2026-10-07 17:00:00' },
  { categories: ['거래유의'], title: '자이(XAI) 거래유의종목 지정', pc_url: 'https://feed.bithumb.com/notice/1655198', published_at: '2026-10-07 12:00:00' },
]
const okFetch = (body) => vi.fn(async () => ({ ok: true, json: async () => body }))

describe('코인니스', () => {
  it('NewsItem으로 정규화(코드 대문자, 중요 플래그, ISO 시각)', () => {
    const r = parseCoinness(cn)
    expect(r[0]).toEqual({ id: 'coinness:1171041', source: 'coinness', title: '익명 고래, $380만 ETH 매수', body: '본문', ts: '2026-10-07T12:51:40.528Z', url: null, important: false, codes: ['ETH'] })
    expect(r[1].important).toBe(true)
    expect(r[1].codes).toEqual(['USDC', 'EURC'])
  })
  it('fetch 성공 → 배열, 실패/비정상 → null', async () => {
    expect(await fetchCoinness({ fetchImpl: okFetch(cn) })).toHaveLength(2)
    expect(await fetchCoinness({ fetchImpl: vi.fn(async () => ({ ok: false })) })).toBe(null)
    expect(await fetchCoinness({ fetchImpl: vi.fn(async () => { throw new Error('net') }) })).toBe(null)
    expect(await fetchCoinness({ fetchImpl: okFetch({ not: 'array' }) })).toBe(null)
  })
})

describe('빗썸', () => {
  it('id는 URL 끝 번호, 시각은 KST → ISO, categories 보존', () => {
    const r = parseBithumbNotices(bt)
    expect(r[0]).toMatchObject({ id: 'bithumb:1655212', source: 'bithumb', ts: '2026-10-07T08:00:00.000Z', categories: ['입출금'], codes: [], important: false })
  })
  it('fetch 실패 → null', async () => {
    expect(await fetchBithumbNotices({ fetchImpl: vi.fn(async () => ({ ok: false })) })).toBe(null)
    expect(await fetchBithumbNotices({ fetchImpl: okFetch(bt) })).toHaveLength(2)
  })
})

describe('업비트·바이낸스 래퍼', () => {
  it('기존 페처 결과 {id,title,ts} → NewsItem, null은 null', async () => {
    const up = await fetchUpbitNews({ fetchAnn: async () => [{ id: 'upbit:5', title: 'T', ts: '2026-10-06T00:00:00+09:00' }] })
    expect(up[0]).toMatchObject({ id: 'upbit:5', source: 'upbit', title: 'T', ts: '2026-10-05T15:00:00.000Z', codes: [], important: false })
    expect(await fetchUpbitNews({ fetchAnn: async () => null })).toBe(null)
    const bn = await fetchBinanceNews({ fetchAnn: async () => [{ id: 'binance:9', title: 'Binance Will List X (X)', ts: null }] })
    expect(bn[0]).toMatchObject({ id: 'binance:9', source: 'binance', ts: null })
  })
})
