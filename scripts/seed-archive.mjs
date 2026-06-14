// 기존 monitor-log.json의 스캔들을 아카이브에 1회 시드. 이미 아카이브가 있으면 건너뜀.
import { existsSync } from 'node:fs'
import { readJson } from '../lib/store.mjs'
import { appendScan, ARCHIVE } from '../lib/archive.mjs'

if (existsSync(ARCHIVE)) {
  console.log('아카이브가 이미 존재합니다. 시드 건너뜀:', ARCHIVE)
  process.exit(0)
}
const log = await readJson('monitor-log.json', { scans: [] })
const scans = [...(log.scans || [])].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
for (const s of scans) appendScan({ timestamp: s.timestamp, buy: s.buy || [], sell: s.sell || [] })
console.log(`시드 완료 — ${scans.length}개 스캔을 아카이브에 기록`)
