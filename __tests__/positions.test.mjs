import { describe, it, expect } from 'vitest'
import { evalPositions, validatePosition, upsertPosition, deletePosition } from '../lib/positions.mjs'

describe('evalPositions', () => {
  const pos = [{ market: 'KRW-A', korean_name: '에이', entry: 100, stopLoss: 90, takeProfit: 130 }]
  it('손익률/손절거리 산출, SL 위', () => {
    const r = evalPositions(pos, { 'KRW-A': 110 })[0]
    expect(r.plPct).toBe(10)
    expect(r.toSLPct).toBeCloseTo(22.22, 1)
    expect(r.hitSL).toBe(false)
    expect(r.hitTP).toBe(false)
  })
  it('SL 도달 감지', () => {
    expect(evalPositions(pos, { 'KRW-A': 89 })[0].hitSL).toBe(true)
  })
  it('TP 도달 감지', () => {
    expect(evalPositions(pos, { 'KRW-A': 135 })[0].hitTP).toBe(true)
  })
  it('현재가 없으면 null', () => {
    const r = evalPositions(pos, {})[0]
    expect(r.price).toBe(null)
    expect(r.plPct).toBe(null)
    expect(r.hitSL).toBe(false)
  })
})

describe('validatePosition', () => {
  const markets = [{ market: 'KRW-SOPH', korean_name: '소폰' }]
  it('정상 입력 정규화 + korean_name 마켓목록 보충', () => {
    const r = validatePosition({ market: 'KRW-SOPH', entry: '60', stopLoss: '55.2', takeProfit: '78' }, { markets })
    expect(r.ok).toBe(true)
    expect(r.position).toEqual({ market: 'KRW-SOPH', korean_name: '소폰', entry: 60, stopLoss: 55.2, takeProfit: 78 })
  })
  it('여분 필드 제거', () => {
    const r = validatePosition({ market: 'KRW-SOPH', entry: 60, hacked: 'x', price: 999 }, { markets })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.position).sort()).toEqual(['entry', 'korean_name', 'market', 'stopLoss', 'takeProfit'])
    expect(r.position.stopLoss).toBe(null)
    expect(r.position.takeProfit).toBe(null)
  })
  it('market 형식 오류 거부', () => {
    expect(validatePosition({ market: 'BTC', entry: 60 }).ok).toBe(false)
    expect(validatePosition({ market: 'krw-soph', entry: 60 }).ok).toBe(false)
  })
  it('entry 누락/음수/0 거부', () => {
    expect(validatePosition({ market: 'KRW-SOPH' }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: -1 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 0 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 'abc' }).ok).toBe(false)
  })
  it('TP<=SL 거부, 한쪽만 있으면 허용', () => {
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: 78, takeProfit: 55 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: 78, takeProfit: 78 }).ok).toBe(false)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: 55 }).ok).toBe(true)
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, takeProfit: 78 }).ok).toBe(true)
  })
  it('SL/TP 음수 거부', () => {
    expect(validatePosition({ market: 'KRW-SOPH', entry: 60, stopLoss: -5 }).ok).toBe(false)
  })
  it('korean_name 마켓목록에 없으면 market 사용', () => {
    const r = validatePosition({ market: 'KRW-XYZ', entry: 10 }, { markets })
    expect(r.position.korean_name).toBe('KRW-XYZ')
  })
})

describe('upsertPosition', () => {
  const base = [{ market: 'KRW-A', korean_name: '에이', entry: 100, stopLoss: null, takeProfit: null }]
  it('신규 추가', () => {
    const r = upsertPosition(base, { market: 'KRW-B', korean_name: '비', entry: 200, stopLoss: null, takeProfit: null })
    expect(r.length).toBe(2)
  })
  it('같은 market 교체 — 중복 없음', () => {
    const r = upsertPosition(base, { market: 'KRW-A', korean_name: '에이', entry: 150, stopLoss: null, takeProfit: null })
    expect(r.length).toBe(1)
    expect(r[0].entry).toBe(150)
  })
  it('원본 불변', () => {
    upsertPosition(base, { market: 'KRW-A', korean_name: '에이', entry: 150, stopLoss: null, takeProfit: null })
    expect(base[0].entry).toBe(100)
  })
  it('기존 레코드의 추가 필드(openedAt 등) 보존 + 편집 반영', () => {
    const l = [{ market: 'KRW-A', korean_name: '에이', entry: 100, stopLoss: null, takeProfit: null, openedAt: '2026-06-26' }]
    const r = upsertPosition(l, { market: 'KRW-A', korean_name: '에이', entry: 150, stopLoss: 90, takeProfit: null })
    expect(r.length).toBe(1)
    expect(r[0].openedAt).toBe('2026-06-26')
    expect(r[0].entry).toBe(150)
    expect(r[0].stopLoss).toBe(90)
  })
})

describe('deletePosition', () => {
  const base = [{ market: 'KRW-A', entry: 100 }, { market: 'KRW-B', entry: 200 }]
  it('제거', () => {
    const r = deletePosition(base, 'KRW-A')
    expect(r.map((p) => p.market)).toEqual(['KRW-B'])
  })
  it('없는 market 무변화', () => {
    expect(deletePosition(base, 'KRW-Z').length).toBe(2)
  })
})
