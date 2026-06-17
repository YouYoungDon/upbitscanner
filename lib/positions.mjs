import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
