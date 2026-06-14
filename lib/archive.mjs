import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const ARCHIVE = join(ROOT, 'data', 'scan-archive.jsonl')

// 스캔 1건을 jsonl 한 줄로 append (디렉토리 없으면 생성)
export function appendScan(scan, file = ARCHIVE) {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(file, JSON.stringify(scan) + '\n', 'utf-8')
}

// 아카이브 전체를 스캔 배열로 (없으면 []). 깨진 줄은 건너뜀.
export function readArchive(file = ARCHIVE) {
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try { out.push(JSON.parse(t)) } catch { /* 깨진 줄 무시 */ }
  }
  return out
}

// 스캔별 요약 (입력 순서 유지). topBuy = score 내림차순 상위 3 종목명.
export function summarizeScans(scans) {
  return scans.map((s) => ({
    timestamp: s.timestamp,
    buyCount: (s.buy || []).length,
    sellCount: (s.sell || []).length,
    topBuy: [...(s.buy || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map((x) => x.korean_name),
  }))
}

// 특정 market 등장 이력 (시간순). 매수/매도 양쪽 검사.
export function coinHistory(scans, market) {
  const out = []
  for (const s of scans) {
    const b = (s.buy || []).find((x) => x.market === market)
    if (b) out.push({ timestamp: s.timestamp, side: 'buy', score: b.score, signals: b.signals })
    const se = (s.sell || []).find((x) => x.market === market)
    if (se) out.push({ timestamp: s.timestamp, side: 'sell', score: se.score, signals: se.signals })
  }
  return out
}
