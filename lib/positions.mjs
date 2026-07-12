import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJson } from './store.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const POSITIONS = join(ROOT, 'data', 'positions.json')

// 보유 포지션 읽기 (수동 편집 파일). 없거나 깨지면 [].
export function readPositions(file = POSITIONS) {
  if (!existsSync(file)) return []
  try {
    const p = JSON.parse(readFileSync(file, 'utf-8'))
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

// 현재가로 손익/손절거리/도달여부 산출 (순수 함수).
export function evalPositions(positions, priceOf = {}) {
  return positions.map((p) => {
    const price = priceOf[p.market] ?? null
    const plPct = price != null ? +(((price / p.entry) - 1) * 100).toFixed(2) : null
    const toSLPct = price != null && p.stopLoss ? +(((price / p.stopLoss) - 1) * 100).toFixed(2) : null
    return {
      ...p,
      price,
      plPct,
      toSLPct,
      hitSL: price != null && p.stopLoss != null && price <= p.stopLoss,
      hitTP: price != null && p.takeProfit != null && price >= p.takeProfit,
    }
  })
}

const MARKET_RE = /^KRW-[A-Z0-9]+$/

// 숫자로 강제. 유한한 양수만 통과, 그 외 null.
function posNum(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

// 입력을 검증·정규화. { ok, position } | { ok:false, error }
export function validatePosition(input = {}, { markets = [] } = {}) {
  const market = String(input.market || '')
  if (!MARKET_RE.test(market)) return { ok: false, error: '잘못된 마켓 형식' }
  const entry = posNum(input.entry)
  if (entry == null || Number.isNaN(entry)) return { ok: false, error: '진입가는 양수여야 합니다' }
  const stopLoss = posNum(input.stopLoss)
  const takeProfit = posNum(input.takeProfit)
  if (Number.isNaN(stopLoss)) return { ok: false, error: '손절가는 양수여야 합니다' }
  if (Number.isNaN(takeProfit)) return { ok: false, error: '목표가는 양수여야 합니다' }
  if (stopLoss != null && takeProfit != null && takeProfit <= stopLoss) {
    return { ok: false, error: '목표가는 손절가보다 커야 합니다' }
  }
  const korean_name = String(input.korean_name || '') ||
    (markets.find((m) => m.market === market)?.korean_name) || market
  return { ok: true, position: { market, korean_name, entry, stopLoss, takeProfit } }
}

// market 기준 교체 또는 추가. 새 배열 반환.
export function upsertPosition(list = [], position) {
  const rest = list.filter((p) => p.market !== position.market)
  return [...rest, position]
}

// 해당 market 제거. 새 배열 반환.
export function deletePosition(list = [], market) {
  return list.filter((p) => p.market !== market)
}

// 원자적 저장 (store.writeJson = temp+rename). data/positions.json.
export async function writePositions(list) {
  await writeJson('positions.json', Array.isArray(list) ? list : [])
}
