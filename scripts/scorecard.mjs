// 픽 성과 스코어카드 배치 러너.
// scan-archive.jsonl → 에피소드 추출 → 기존 채점 병합 → 미채점만 마켓별 1-fetch 증분 채점 → scorecard.json.
// 하루 1회(KST 09:10, 일봉 확정 직후) 작업 스케줄러로 실행. 수동 실행: npm run scorecard
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, readJson, writeJson } from '../lib/store.mjs'
import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { extractEpisodes, scoreEpisode, neededCandleCount, mergeEpisodes } from '../lib/scorecard.mjs'
import { scoreStrategyOutcome } from '../lib/strategy.mjs'

// 🎯전략 태그 에피소드 중 SL/TP 채점이 미확정인 것 (config 없으면 항상 false)
const needsStrategyScore = (e, config) =>
  !!config && (e.signals ?? []).some((s) => s.includes('🎯전략')) &&
  !['sl', 'tp', 'time', 'no-data'].includes(e.strategyOutcome?.reason)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  let raw
  try {
    raw = await readFile(join(DATA_DIR, 'scan-archive.jsonl'), 'utf8')
  } catch {
    console.error('scan-archive.jsonl 없음 — 채점할 스캔이 없습니다.')
    process.exitCode = 1
    return
  }
  const scans = raw.trim().split('\n').map((line) => {
    try { return JSON.parse(line) } catch { console.warn('아카이브 줄 파싱 실패 — 건너뜀'); return null }
  }).filter(Boolean)

  const fresh = extractEpisodes(scans)
  const prev = await readJson('scorecard.json', { episodes: [] })
  const prevCount = (prev.episodes ?? []).length
  let episodes = mergeEpisodes(prev.episodes ?? [], fresh)

  const now = Date.now()
  const strategyConfig = await readJson('strategy-config.json', null)
  const pending = episodes.filter((e) =>
    e.status === 'pending' || e.status === 'partial' || needsStrategyScore(e, strategyConfig))
  const byMarket = new Map()
  for (const e of pending) {
    if (!byMarket.has(e.market)) byMarket.set(e.market, [])
    byMarket.get(e.market).push(e)
  }

  let scored = 0
  let failedMarkets = 0
  const updated = new Map()
  for (const [market, eps] of byMarket) {
    const oldest = Math.min(...eps.map((e) => Date.parse(e.entryTs)))
    const candles = await getDayCandles(market, neededCandleCount(oldest, now))
    if (!candles) { failedMarkets++; continue } // 다음 실행 때 재시도
    const confirmed = confirmedOhlcv(candlesToOhlcv(candles))
    for (const e of eps) {
      const s = scoreEpisode(e, confirmed, now)
      if (needsStrategyScore(e, strategyConfig)) {
        const out = scoreStrategyOutcome(e, confirmed, strategyConfig, now)
        if (out.reason !== e.strategyOutcome?.reason) s.scoredAt = new Date(now).toISOString()
        s.strategyOutcome = out
      }
      if (s.status !== e.status || s.scoredAt !== e.scoredAt) scored++
      updated.set(s.id, s)
    }
    await sleep(120) // 업비트 rate limit 여유
  }
  episodes = episodes.map((e) => updated.get(e.id) ?? e)

  await writeJson('scorecard.json', { updatedAt: new Date(now).toISOString(), episodes })
  const remain = episodes.filter((e) => e.status === 'pending' || e.status === 'partial').length
  console.log(`스코어카드: 에피소드 ${episodes.length} (신규 ${episodes.length - prevCount}) / 이번 채점 ${scored} / 남은 미채점 ${remain} / 실패 마켓 ${failedMarkets}`)
}

main()
