// 픽 성과 스코어카드 배치 러너.
// scan-archive.jsonl → 에피소드 추출 → 기존 채점 병합 → 미채점만 마켓별 1-fetch 증분 채점 → scorecard.json.
// 하루 1회(KST 09:10, 일봉 확정 직후) 작업 스케줄러로 실행. 수동 실행: npm run scorecard
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, readJson, writeJson } from '../lib/store.mjs'
import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcvAsOf } from '../lib/ohlcv.mjs'
import { extractEpisodes, scoreEpisode, scoreEpisodeExit, neededCandleCount, mergeEpisodes } from '../lib/scorecard.mjs'
import { scoreStrategyOutcome } from '../lib/strategy.mjs'

// 🎯전략 태그 에피소드 중 SL/TP 채점이 미확정인 것 (config 없으면 항상 false)
const needsStrategyScore = (e, config) =>
  !!config && (e.signals ?? []).some((s) => s.includes('🎯전략')) &&
  !['sl', 'tp', 'time', 'no-data'].includes(e.strategyOutcome?.reason)

const EXIT_FINAL = ['sl', 'tp', 'time', 'no-data']
// 저장된 파라미터가 현재 config와 다른지. 필드 부재(구 스키마)도 "다름"으로 본다.
const exitParamsStale = (ex, config) =>
  ex?.slPct !== config.slPct || ex?.tpPct !== config.tpPct || ex?.holdMax !== config.holdMax

// 일반 청산 규칙(exit-config.json) 채점이 미확정인 에피소드 (config 없으면 항상 false).
// 멱등성 검증(2026-10-06): 파라미터가 현재 config와 일치하는 상태에서 재실행하면 재채점 0건,
// 확정 1,603건의 exit 결과가 바이트 동일했다.
const needsExitScore = (e, config) => {
  if (!config) return false
  if (!EXIT_FINAL.includes(e.exit?.reason)) return true
  // 라이브 스탬프는 절대 재채점하지 않는다(스펙 §3.2⑤) — 픽 시점에 사용자가 본 수치가
  // 소급 변경되면 성과 비교의 기준 자체가 움직인다. 소급분만 현재 config로 재계산한다
  // (스펙 §3.4: 백필 = "현재 config로 소급 계산"). 그러지 않으면 재선정 후 소급분은
  // 구 세대 파라미터로 굳은 채 같은 cfgVersion 라벨을 달고 신규분과 한 집계에 섞인다.
  return e.exit?.cfgSource === 'backfill' && exitParamsStale(e.exit, config)
}

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
  const exitConfig = await readJson('exit-config.json', null) // 없으면 청산 채점 생략
  const pending = episodes.filter((e) =>
    e.status === 'pending' || e.status === 'partial' ||
    needsStrategyScore(e, strategyConfig) || needsExitScore(e, exitConfig))
  const byMarket = new Map()
  for (const e of pending) {
    if (!byMarket.has(e.market)) byMarket.set(e.market, [])
    byMarket.get(e.market).push(e)
  }

  let scored = 0
  let exitRescored = 0 // 이미 확정된 소급분을 파라미터 세대 불일치로 재계산한 건수
  let failedMarkets = 0
  const updated = new Map()
  for (const [market, eps] of byMarket) {
    const oldest = Math.min(...eps.map((e) => Date.parse(e.entryTs)))
    const candles = await getDayCandles(market, neededCandleCount(oldest, now))
    if (!candles) { failedMarkets++; continue } // 다음 실행 때 재시도
    // 날짜 인지 확정봉: 당일 거래가 없는 저유동 마켓에서 어제 확정봉을 잃지 않는다
    const confirmed = confirmedOhlcvAsOf(candlesToOhlcv(candles), now)
    for (const e of eps) {
      const s = scoreEpisode(e, confirmed, now)
      let withExit = s
      if (needsExitScore(e, exitConfig)) {
        if (EXIT_FINAL.includes(e.exit?.reason)) exitRescored++
        withExit = scoreEpisodeExit(s, confirmed, exitConfig, now)
        if (withExit.exit?.reason !== e.exit?.reason) withExit.scoredAt = new Date(now).toISOString()
      }
      if (needsStrategyScore(e, strategyConfig)) {
        const out = scoreStrategyOutcome(e, confirmed, strategyConfig, now)
        if (out.reason !== e.strategyOutcome?.reason) withExit.scoredAt = new Date(now).toISOString()
        withExit.strategyOutcome = out
      }
      if (withExit.status !== e.status || withExit.scoredAt !== e.scoredAt) scored++
      updated.set(withExit.id, withExit)
    }
    await sleep(120) // 업비트 rate limit 여유
  }
  episodes = episodes.map((e) => updated.get(e.id) ?? e)

  await writeJson('scorecard.json', { updatedAt: new Date(now).toISOString(), episodes })
  const remain = episodes.filter((e) => e.status === 'pending' || e.status === 'partial').length
  console.log(`스코어카드: 에피소드 ${episodes.length} (신규 ${episodes.length - prevCount}) / 이번 채점 ${scored} / 남은 미채점 ${remain} / 실패 마켓 ${failedMarkets}`)
  const live = episodes.filter((e) => e.exit?.cfgSource === 'live').length
  const back = episodes.filter((e) => e.exit?.cfgSource === 'backfill').length
  console.log(`청산 채점: live ${live} / backfill ${back} / 소급분 재계산 ${exitRescored}`)
}

main()
