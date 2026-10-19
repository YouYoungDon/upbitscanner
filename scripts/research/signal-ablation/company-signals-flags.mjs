// 회사 신호 5종 플래그 재생 — replay.mjs와 같은 창(확정봉 200개, 24h 거래대금 1억↑)으로 판정해
// data/research/company-flags.json 에 { "마켓|일": [켜진 신호 키...] } 로 저장. 신호가 하나도 없으면 저장 안 함.
import { readFileSync, writeFileSync } from 'node:fs'
import { DETECTORS } from './company-signals.mjs'

const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const DAY = 86400
const out = {}
const count = Object.fromEntries(Object.keys(DETECTORS).map((k) => [k, 0]))
let n = 0
for (const [m, o] of Object.entries(candles)) {
  for (let i = 60; i < o.length - 1; i++) {
    if (!(o[i].tradeValue >= 1e8)) continue
    const w = o.slice(Math.max(0, i - 199), i + 1)
    const on = Object.entries(DETECTORS).filter(([, f]) => f(w)).map(([k]) => k)
    if (on.length) { out[`${m}|${Math.floor(o[i].time / DAY)}`] = on; for (const k of on) count[k]++ }
    n++
  }
}
writeFileSync(new URL('../../../data/research/company-flags.json', import.meta.url), JSON.stringify(out))
console.log('windows', n, 'fired', count)
