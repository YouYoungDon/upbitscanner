import { readFile, writeFile, mkdir, rename, open, unlink, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = join(ROOT, 'data')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function readJson(name, fallback) {
  const path = join(DATA_DIR, name)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return fallback
  }
}

// 원자적 쓰기: temp(고유 pid 접미사)에 쓰고 rename으로 교체 → 부분 쓰기/깨진 파일 방지.
// 라이브 가중치(signal-weights.json)를 읽되 없거나 비면 default 시드로 폴백.
export async function readWeights() {
  const live = await readJson('signal-weights.json', null)
  if (live && Object.keys(live).length) return live
  return await readJson('signal-weights.default.json', {})
}

export async function writeJson(name, data) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })
  const path = join(DATA_DIR, name)
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await rename(tmp, path)
}

// 파일 락으로 임계구역 직렬화 (읽기-수정-쓰기 갱신유실 방지).
// 락 보유 중이면 대기, staleMs 초과 락은 탈취, timeout 초과 시 강제 진입(데드락 방지).
export async function withLock(name, fn, { timeoutMs = 30000, pollMs = 50, staleMs = 120000 } = {}) {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true })
  const lockPath = join(DATA_DIR, `${name}.lock`)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fh = await open(lockPath, 'wx') // O_EXCL: 이미 있으면 EEXIST
      await fh.close()
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const st = await stat(lockPath).catch(() => null)
      if (st && Date.now() - st.mtimeMs > staleMs) { await unlink(lockPath).catch(() => {}); continue }
      if (Date.now() >= deadline) { await unlink(lockPath).catch(() => {}); continue }
      await sleep(pollMs)
    }
  }
  try {
    return await fn()
  } finally {
    await unlink(lockPath).catch(() => {})
  }
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

// 적중률을 [0.7, 1.5]로 선형 매핑 (0.4 이하 → 0.7, 0.7 이상 → 1.5)
export function hitComponent(hitRate) {
  const t = Math.max(0, Math.min(1, (hitRate - 0.4) / (0.7 - 0.4)))
  return 0.7 + t * (1.5 - 0.7)
}
// 평균수익(%) 배수 — B안(보수적). avgReturn 퍼센트값. +25%에서 상한 1.25, 하한 0.85, null/NaN→1.
export function returnComponent(avgReturn) {
  if (avgReturn == null || Number.isNaN(avgReturn)) return 1
  return Math.max(0.85, Math.min(1.25, 1 + avgReturn / 100))
}
// 목표 가중치 = 적중률성분 × 수익성분 (클램프)
export function qualityTarget(hitRate, avgReturn) {
  return clampWeight(hitComponent(hitRate) * returnComponent(avgReturn))
}
// 이전 가중치에서 목표로 30% 이동 (하위호환: avgReturn 생략 가능)
export function newWeight(oldWeight, hitRate, avgReturn) {
  return clampWeight(oldWeight * 0.7 + qualityTarget(hitRate, avgReturn) * 0.3)
}
