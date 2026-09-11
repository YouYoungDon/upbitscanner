import { describe, it, expect, vi } from 'vitest'
import {
  classifyAnnouncement, parseTickers, matchMarkets, eventRiskMult, ensureEvents, applyEventDefense,
} from '../lib/exchange-events.mjs'

describe('classifyAnnouncement', () => {
  it('상폐 → delist(mult 0)', () => {
    expect(classifyAnnouncement('OO 거래지원 종료 안내')).toMatchObject({ type: 'delist', mult: 0 })
    expect(classifyAnnouncement('Binance Will Delist ABC')).toMatchObject({ type: 'delist' })
  })
  it('유의지정 → caution(×0.5)', () => {
    expect(classifyAnnouncement('샌드박스(SAND) 거래 유의 종목 지정 안내')).toMatchObject({ type: 'caution', mult: 0.5 })
  })
  it('입출금중단/마이그레이션 → halt(×0.7)', () => {
    expect(classifyAnnouncement('네트워크 전환에 따른 소폰(SOPH) 입출금 중단 안내')).toMatchObject({ type: 'halt', mult: 0.7 })
    expect(classifyAnnouncement('아르고(AERGO) 토큰 스왑 일정 안내')).toMatchObject({ type: 'halt' })
  })
  it('재개/해제 → resume — halt/caution 규칙보다 먼저 매칭', () => {
    expect(classifyAnnouncement('문빔(GLMR) 입출금 재개 안내')).toMatchObject({ type: 'resume' })
    expect(classifyAnnouncement('타이코(TAIKO) 거래 유의 종목 지정 해제 안내')).toMatchObject({ type: 'resume' })
  })
  it('신규상장 → listing(중립)', () => {
    expect(classifyAnnouncement('클러스터프로토콜(CP) 신규 거래지원 안내')).toMatchObject({ type: 'listing', mult: 1 })
  })
  it('무관 제목 → null', () => {
    expect(classifyAnnouncement('보이스피싱 예방 주간 안내')).toBeNull()
    expect(classifyAnnouncement(null)).toBeNull()
  })
})

describe('parseTickers', () => {
  it('괄호 안 단일/복수 티커', () => {
    expect(parseTickers('소폰(SOPH) 입출금 중단')).toEqual(['SOPH'])
    expect(parseTickers('아르고(AERGO), 알파쿼크(AQT) 토큰 스왑')).toEqual(['AERGO', 'AQT'])
  })
  it('마켓 표기 괄호는 오탐 안 함', () => {
    // "(KRW, BTC, USDT 마켓)"은 단일 대문자 토큰이 아니라 매칭 안 됨
    expect(parseTickers('클러스터프로토콜(CP) 신규 거래지원 안내 (KRW, BTC, USDT 마켓)')).toEqual(['CP'])
  })
  it('단독 기준통화 괄호 (BTC)/(KRW)/(USDT)는 티커로 안 잡음(오탐 방지)', () => {
    expect(parseTickers('OO 거래지원 종료 (BTC)')).toEqual([])       // BTC=마켓 기준통화, 감점 대상 아님
    expect(parseTickers('테더(USDT) 입출금 중단 안내')).toEqual([])   // USDT 제외
    expect(parseTickers('리플(XRP) 거래 유의 종목 지정 (KRW)')).toEqual(['XRP']) // KRW 제외, XRP만
  })
  it('티커 없음 → 빈 배열', () => {
    expect(parseTickers('Binance Futures Will Launch USDs-Margined XYZ')).toEqual([])
    expect(parseTickers(null)).toEqual([])
  })
})

describe('matchMarkets', () => {
  const uni = new Set(['KRW-SOPH', 'KRW-AERGO', 'KRW-BTC'])
  it('유니버스에 있는 티커만 KRW- 마켓으로', () => {
    expect(matchMarkets(['SOPH', 'AQT'], uni)).toEqual(['KRW-SOPH'])
    expect(matchMarkets(['AERGO', 'BTC'], uni)).toEqual(['KRW-AERGO', 'KRW-BTC'])
  })
  it('매칭 없음 → 빈 배열', () => {
    expect(matchMarkets(['DOGE'], uni)).toEqual([])
  })
})

describe('eventRiskMult', () => {
  it('빈 이벤트 → mult 1, label null', () => {
    expect(eventRiskMult([])).toEqual({ mult: 1, label: null })
  })
  it('가장 강한(min) 배수 채택 + 라벨', () => {
    const r = eventRiskMult([
      { type: 'halt', exchange: 'upbit', mult: 0.7 },
      { type: 'caution', exchange: 'binance', mult: 0.5 },
    ])
    expect(r.mult).toBe(0.5)
    expect(r.label).toContain('유의지정')
    expect(r.label).toContain('바이낸스')
  })
  it('상폐(0)가 최우선', () => {
    expect(eventRiskMult([{ type: 'halt', exchange: 'upbit', mult: 0.7 }, { type: 'delist', exchange: 'upbit', mult: 0 }]).mult).toBe(0)
  })
})

describe('applyEventDefense (픽 기반 스캐너용)', () => {
  const byMarket = {
    'KRW-DEAD': { mult: 0, label: '⚠️거래소이벤트(상폐·업비트)', events: [] },
    'KRW-HALT': { mult: 0.7, label: '⚠️거래소이벤트(입출금중단·업비트)', events: [] },
  }
  it('상폐(mult 0)는 픽에서 제외', () => {
    const r = applyEventDefense([{ market: 'KRW-DEAD', score: 20 }, { market: 'KRW-OK', score: 10 }], byMarket)
    expect(r.map((p) => p.market)).toEqual(['KRW-OK'])
  })
  it('halt/caution은 score 감점 + event 부착', () => {
    const r = applyEventDefense([{ market: 'KRW-HALT', score: 20 }], byMarket)
    expect(r[0].score).toBeCloseTo(14, 5) // 20 × 0.7
    expect(r[0].event).toEqual({ mult: 0.7, label: '⚠️거래소이벤트(입출금중단·업비트)' })
  })
  it('이벤트 없는 픽은 그대로(불변)', () => {
    const p = { market: 'KRW-OK', score: 10 }
    const r = applyEventDefense([p], byMarket)
    expect(r[0]).toBe(p) // 동일 참조 — 미변경
    expect(r[0].event).toBeUndefined()
  })
  it('원본 배열 불변', () => {
    const picks = [{ market: 'KRW-HALT', score: 20 }]
    applyEventDefense(picks, byMarket)
    expect(picks[0].score).toBe(20) // 원본 미변경
  })
  it('빈 입력·빈 byMarket 안전', () => {
    expect(applyEventDefense([], byMarket)).toEqual([])
    expect(applyEventDefense([{ market: 'KRW-OK', score: 5 }])).toEqual([{ market: 'KRW-OK', score: 5 }])
  })
})

// 인메모리 상태 저장소 스텁 (store.mjs 대체)
function memStore(init = { seenIds: {}, active: {} }) {
  let data = JSON.parse(JSON.stringify(init))
  return {
    readJson: vi.fn(async () => JSON.parse(JSON.stringify(data))),
    writeJson: vi.fn(async (_n, obj) => { data = JSON.parse(JSON.stringify(obj)) }),
    withLock: vi.fn(async (_n, fn) => fn()),
    _get: () => data,
  }
}

describe('ensureEvents', () => {
  const markets = ['KRW-SOPH', 'KRW-BTC']
  const sophHalt = [{ id: 'upbit:6548', title: '네트워크 전환에 따른 소폰(SOPH) 입출금 중단 안내', ts: '2026-09-07T12:20:00+09:00' }]

  const mkDeps = (over = {}) => ({
    ...memStore(),
    fetchUpbitAnnouncements: vi.fn(async () => sophHalt),
    fetchBinanceAnnouncements: vi.fn(async () => null),
    ...over,
  })

  it('업비트 halt → byMarket 감점 + newEvents', async () => {
    const r = await ensureEvents(markets, { now: 1_000_000_000_000, deps: mkDeps() })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7)
    expect(r.byMarket['KRW-SOPH'].label).toContain('입출금중단')
    expect(r.newEvents).toHaveLength(1)
    expect(r.newEvents[0].markets).toEqual(['KRW-SOPH'])
  })

  it('dedup: 같은 상태 재조회 → newEvents 비어야 함', async () => {
    const deps = mkDeps()
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    const r2 = await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    expect(r2.newEvents).toHaveLength(0)
    expect(r2.byMarket['KRW-SOPH'].mult).toBe(0.7) // 활성은 유지
  })

  it('resume가 활성 이벤트 상쇄', async () => {
    const deps = mkDeps()
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => [{ id: 'upbit:6600', title: '소폰(SOPH) 입출금 재개 안내', ts: '2026-09-20T10:00:00+09:00' }])
    const r = await ensureEvents(markets, { now: 1_000_100_000_000, deps })
    expect(r.byMarket['KRW-SOPH']).toBeUndefined() // 재개로 제거
  })

  it('단계적 마이그레이션: 오래된 resume가 같은 스캔의 새 halt를 지우지 않음(ts 방어)', async () => {
    // 소폰류 단계적 마이그레이션 시나리오: 오래된 "입출금 재개"(T1)가 여전히 fetch 윈도우 안에
    // 남아있는 상태에서 새 "입출금 중단"(T2>T1)이 발생 — resume가 시점 무관하게 active를
    // 통째로 지우면 매 스캔 halt가 사라진다(final-review Important 결함).
    const oldResume = { id: 'upbit:6500', title: '소폰(SOPH) 입출금 재개 안내', ts: '2026-09-01T00:00:00+09:00' } // T1
    const newHalt = { id: 'upbit:6548', title: '네트워크 전환에 따른 소폰(SOPH) 입출금 중단 안내', ts: '2026-09-07T12:20:00+09:00' } // T2 > T1
    // 실제 공지 피드는 역시간순(최신 우선)이라 halt가 먼저 온다 — 이 순서여야 정렬/게이트 로직이
    // 실제로 검증됨(resume가 먼저 오면 무조건삭제 버그도 "우연히" 통과해버리는 가짜 가드가 된다).
    const deps = mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => [newHalt, oldResume]) })
    const r = await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7) // 새 halt가 살아남아야 함
    // 2차 재조회(둘 다 여전히 in-window)에도 halt 유지
    const r2 = await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    expect(r2.byMarket['KRW-SOPH'].mult).toBe(0.7)
  })

  it('재개는 무관한 종류(유의지정)를 지우지 않음 — 종류별 해제', async () => {
    // 입출금 재개(halt 해제)가 같은 종목의 유의지정(caution)까지 ts만 보고 삭제하던 결함 방지.
    const deps = mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => [{ id: 'upbit:8000', title: '소폰(SOPH) 거래 유의 종목 지정 안내', ts: '2026-09-01T00:00:00+09:00' }]) })
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => [{ id: 'upbit:8001', title: '소폰(SOPH) 입출금 재개 안내', ts: '2026-09-20T00:00:00+09:00' }])
    const r = await ensureEvents(markets, { now: 1_000_100_000_000, deps })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.5) // 유의지정은 입출금 재개와 무관 → 유지
  })

  it('ts 불명(null, 바이낸스) 활성 이벤트는 재개로 안 지워짐 — 만료로만 정리', async () => {
    // finite-ts 재개가 순서 판단 불가한 null-ts halt를 오삭제하던 결함 방지(방어 우선).
    const deps = mkDeps({
      fetchUpbitAnnouncements: vi.fn(async () => null),
      fetchBinanceAnnouncements: vi.fn(async () => [{ id: 'binance:900', title: 'Sophon (SOPH) Network Migration', ts: null }]),
    })
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => [{ id: 'upbit:901', title: '소폰(SOPH) 입출금 재개 안내', ts: '2026-09-20T00:00:00+09:00' }])
    deps.fetchBinanceAnnouncements = vi.fn(async () => null)
    const r = await ensureEvents(markets, { now: 1_000_100_000_000, deps })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7) // null-ts halt 보존
  })

  it('만료된 활성 이벤트 청소', async () => {
    // 14일 지난 halt는 자동 제거
    const deps = mkDeps()
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => []) // 신규 없음
    const r = await ensureEvents(markets, { now: 1_000_000_000_000 + 15 * 86400000, deps })
    expect(r.byMarket['KRW-SOPH']).toBeUndefined()
  })

  it('바이낸스 실패·업비트 성공 → 정상 동작(degrade)', async () => {
    const r = await ensureEvents(markets, { now: 1_000_000_000_000, deps: mkDeps({ fetchBinanceAnnouncements: vi.fn(async () => null) }) })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7)
  })

  it('둘 다 실패 → neutral(스캔 무중단)', async () => {
    const r = await ensureEvents(markets, {
      now: 1, deps: mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => null), fetchBinanceAnnouncements: vi.fn(async () => null) }),
    })
    expect(r.byMarket).toEqual({})
    expect(r.reason).toBeTruthy()
  })

  it('둘 다 실패해도 저장된 활성 이벤트로 계속 방어(소실 방지) — 만료 전엔 유지, 만료 후엔 청소', async () => {
    const deps = mkDeps() // 1차: 업비트 halt 저장
    await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    deps.fetchUpbitAnnouncements = vi.fn(async () => null)
    deps.fetchBinanceAnnouncements = vi.fn(async () => null)
    // 2차: 둘 다 실패, 만료 전(14일 이내) → 저장된 방어가 사라지면 안 됨
    const r = await ensureEvents(markets, { now: 1_000_000_000_000, deps })
    expect(r.byMarket['KRW-SOPH'].mult).toBe(0.7)
    expect(r.reason).toBe('fetch-fail')
    expect(r.newEvents).toHaveLength(0)
    // 3차: 둘 다 실패, 만료 후(15일 이상) → 이제는 청소되어야 함
    const r2 = await ensureEvents(markets, { now: 1_000_000_000_000 + 15 * 86400000, deps })
    expect(r2.byMarket['KRW-SOPH']).toBeUndefined()
    expect(r2.reason).toBe('fetch-fail')
  })

  it('유니버스 밖 종목 이벤트는 무시, 보유 포지션은 포함', async () => {
    const deps = mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => [{ id: 'upbit:7000', title: '도지코인(DOGE) 입출금 중단 안내', ts: '2026-09-07T00:00:00+09:00' }]) })
    const r1 = await ensureEvents(['KRW-SOPH'], { now: 1_000_000_000_000, deps })
    expect(r1.byMarket['KRW-DOGE']).toBeUndefined() // 유니버스 밖
    const deps2 = mkDeps({ fetchUpbitAnnouncements: vi.fn(async () => [{ id: 'upbit:7000', title: '도지코인(DOGE) 입출금 중단 안내', ts: '2026-09-07T00:00:00+09:00' }]) })
    const r2 = await ensureEvents(['KRW-SOPH'], { now: 1_000_000_000_000, positions: [{ market: 'KRW-DOGE' }], deps: deps2 })
    expect(r2.byMarket['KRW-DOGE'].mult).toBe(0.7) // 보유 포지션이면 포함
  })
})
