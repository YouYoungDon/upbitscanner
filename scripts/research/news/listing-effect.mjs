// scripts/research/news/listing-effect.mjs
// 공식 상장 공지 뒤 업비트 KRW 가격이 같은 날 전 종목 평균보다 더 올랐나(일봉 기준, 18개월).
// 진입 = 공지 다음 확정 일봉 종가(공지 당일 급등을 사는 비용을 포함하려고 당일 종가도 따로 본다).
import { readFileSync } from 'node:fs'
import { getMarkets } from '../../../lib/upbit.mjs'
import { classifyItem } from '../../../lib/news/classify.mjs'
import { buildMatcher } from '../../../lib/news/match.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const candles = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url)))
const DAY = 86400

async function upbitHistory(maxPages = 60) {
  const out = []
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetch(`https://api-manager.upbit.com/api/v1/announcements?os=web&page=${p}&per_page=30&category=trade`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null)
    if (!r?.ok) break
    const d = await r.json()
    const n = d?.data?.notices || []
    if (!n.length) break
    for (const x of n) out.push({ id: `upbit:${x.id}`, source: 'upbit', title: x.title, ts: x.first_listed_at || x.listed_at, codes: [], important: false, body: null, url: null })
    await sleep(300)
  }
  return out
}
async function binanceHistory(maxPages = 15) {
  const out = []
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=${p}&pageSize=20`, { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'en' } }).catch(() => null)
    if (!r?.ok) break
    const d = await r.json()
    const a = d?.data?.articles || []
    if (!a.length) break
    for (const x of a) out.push({ id: `binance:${x.id}`, code: x.code, source: 'binance', title: x.title, ts: null, codes: [...new Set([...String(x.title).matchAll(/(?<![A-Za-z0-9])([A-Z0-9]{2,15})USDT(?![A-Za-z0-9])/g)].map((m) => m[1]))], important: false, body: null, url: null })
    await sleep(1500) // 레이트리밋 회피
  }
  return out
}

// 일별 전 종목 평균 수익(초과수익 기준선): day → (close_{d+h}/close_d − 1) 평균
const dayIdx = {}
for (const [m, o] of Object.entries(candles)) dayIdx[m] = new Map(o.map((c, i) => [Math.floor(c.time / DAY), i]))
const fwd = (m, d, h) => { const o = candles[m], i = dayIdx[m]?.get(d); if (i == null || i + h >= o.length) return null; return o[i + h].close / o[i].close - 1 }
const base = new Map()
const baseAt = (d, h) => {
  const k = `${d}|${h}`
  if (!base.has(k)) { const v = Object.keys(candles).map((m) => fwd(m, d, h)).filter((x) => x != null).map((x) => Math.max(-0.5, Math.min(0.5, x))); base.set(k, v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0) }
  return base.get(k)
}

const markets = await getMarkets()
const match = buildMatcher(markets)
const items = [...await upbitHistory(), ...await binanceHistory()]
// 바이낸스 목록 API는 발행 시각이 비어 있다 → 상장으로 분류되고 업비트 코인에 매칭된 것만 상세 API로 시각 조회
async function binancePublishIso(code) {
  const r = await fetch(`https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=${code}`, { headers: { 'User-Agent': 'Mozilla/5.0', lang: 'en' } }).catch(() => null)
  const ms = r?.ok ? (await r.json().catch(() => null))?.data?.publishDate : null
  await sleep(800)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
const events = []
for (const it of items) {
  const c = classifyItem(it)
  if (c.kind !== 'official-listing') continue
  if (!it.ts && it.source === 'binance' && match(it).markets.length) it.ts = await binancePublishIso(it.code)
  if (!it.ts) continue
  for (const m of match(it).markets) events.push({ m, type: c.type, d: Math.floor(Date.parse(it.ts) / 1000 / DAY), title: it.title })
}
const W = (v) => Math.max(-0.5, Math.min(0.5, v))
const rows = {}
for (const e of events) {
  // 진입 A: 공지 당일 종가(당일 급등 포함 후 매수), 진입 B: 공지 전날 종가(이상적, 비현실 — 참고용)
  for (const [entry, d0] of [['당일종가 진입', e.d], ['전날종가(참고)', e.d - 1]]) {
    for (const h of [1, 3, 7]) {
      const r = fwd(e.m, d0, h); if (r == null) continue
      const key = `${e.type}|${entry}|${h}`
      ;(rows[key] ||= []).push(W(r) - baseAt(d0, h))
    }
  }
}
console.log(`공지 ${items.length}건 → 상장 이벤트(업비트 KRW 코인 매칭) ${events.length}건`)
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
for (const [k, v] of Object.entries(rows).sort()) console.log(k.padEnd(36), `n ${String(v.length).padStart(4)}  초과 ${(mean(v) * 100).toFixed(2)}%p  승 ${(v.filter((x) => x > 0).length / v.length * 100).toFixed(0)}%`)
