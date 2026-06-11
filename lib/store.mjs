import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = join(ROOT, 'data')

export async function readJson(name, fallback) {
  const path = join(DATA_DIR, name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return fallback
  }
}

export async function writeJson(name, data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })
  await writeFile(join(DATA_DIR, name), JSON.stringify(data, null, 2), 'utf-8')
}

export function rollingAppend(arr, item, max) {
  const next = [...arr, item]
  return next.length > max ? next.slice(next.length - max) : next
}

export function ewmTarget(hitRate) {
  return hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
}

export function clampWeight(v) {
  return Math.max(0.5, Math.min(2.0, v))
}

export function newWeight(oldWeight, hitRate) {
  return clampWeight(oldWeight * 0.8 + ewmTarget(hitRate) * 0.2)
}
