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

export function newWeight(oldWeight, hitRate) {
  return clampWeight(oldWeight * 0.8 + ewmTarget(hitRate) * 0.2)
}
