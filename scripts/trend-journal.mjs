// OS 스케줄러용 결정적 추이 저널 기록 (LLM 불필요). 09:17/21:17 실행.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readArchive } from '../lib/archive.mjs'
import { buildTrendEntry } from '../lib/trend.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JOURNAL = join(ROOT, 'data', 'analysis-journal.md')

const entry = buildTrendEntry(readArchive())
if (!entry) { console.log('스캔 이력 없음'); process.exit(0) }

let content = existsSync(JOURNAL)
  ? readFileSync(JOURNAL, 'utf-8')
  : '# 업비트 스캐너 자동 추이 분석 저널\n\n---\n'

if (content.includes(entry.marker)) { console.log('이미 기록됨:', entry.scanTs); process.exit(0) }

// '---' 구분선 바로 아래에 prepend (최신이 위)
const pos = content.indexOf('---')
const insertAt = pos === -1 ? content.length : content.indexOf('\n', pos) + 1
content = content.slice(0, insertAt) + '\n' + entry.markdown + content.slice(insertAt)
writeFileSync(JOURNAL, content, 'utf-8')
console.log('추이 저널 기록:', entry.scanTs)
