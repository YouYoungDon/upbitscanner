// .env 로더 — 작업 스케줄러가 캐시한 환경에 User 환경변수(TELEGRAM_TOKEN 등)가
// 없을 때 대비. 진입점 스크립트에서 `import '../lib/env.mjs'`로 1회 로드(side-effect).
// lib 모듈이 아니라 진입점에서만 로드 → 테스트가 실 토큰을 로드해 실 전송하는 오염 방지.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 'KEY=value' 파싱. 전체행 주석·빈 줄·소문자 키 무시. 빈 값 제외.
// 따옴표 값은 닫는 따옴표까지가 값(내부 #·공백 보존, 뒤 주석 버림).
// 비따옴표 값은 인라인 주석(줄머리 또는 공백 뒤 #) 제거.
export function parseEnv(text) {
  const out = {}
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const k = m[1]
    let v = m[2]
    if (v[0] === '"' || v[0] === "'") {
      const q = v[0]
      const end = v.indexOf(q, 1)
      v = end === -1 ? v.slice(1) : v.slice(1, end) // 닫는 따옴표 없으면 여는 따옴표만 제거
    } else {
      v = v.replace(/(^|\s)#.*$/, '$1').trimEnd() // 공백+# 이후는 인라인 주석
    }
    if (v) out[k] = v
  }
  return out
}

// .env를 읽어 비어있는 process.env 키만 채운다(환경변수 우선, 기존 값·빈 값 미변경).
export function loadEnv() {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
    const vars = parseEnv(readFileSync(path, 'utf8'))
    for (const [k, v] of Object.entries(vars)) {
      if (!process.env[k]) process.env[k] = v
    }
  } catch { /* .env 없으면 무시 */ }
}

loadEnv()
