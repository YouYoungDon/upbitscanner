// 일반 매수픽 청산 파라미터 그리드 백테스트 — 기록된 스코어카드 에피소드 리플레이.
// 신호를 재생성하지 않는다: 스캐너 파이프라인(코인게코·펀딩·이벤트·레짐)에 의존해
// 캔들만으로 재현 불가하므로, 실제로 기록된 픽을 그대로 리플레이한다.
// simulateTrade(다음봉 시가 진입)가 아니라 scoreStrategyOutcome(스캔가 진입)을 쓴다 —
// 기록된 픽은 실제로 스캔가에 진입할 수 있었으므로 후자가 맞는 규약이다.
import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { scoreStrategyOutcome } from '../lib/strategy.mjs'
import { calcRunUpPct } from '../lib/indicators.mjs'
import { readJson, writeJson } from '../lib/store.mjs'
import { summarizeTrades, pickBest, overextensionTable, applyPreRegisteredRule, cellKey } from '../lib/exit-select.mjs'
import { readArchive } from '../lib/archive.mjs'

const AXES = { slPct: [5, 7, 10, 12], tpPct: [6, 8, 12, 18, 25], holdMax: [3, 5, 7] }
const MIN_TRADES = 200
const TRAIN_END = '2026-08-15T23:59:59.999Z' // 학습/홀드아웃 경계 (스펙 §3.3.3)
const RUNUP_LOOKBACK = 7
const RUNUP_THRESHOLDS = [20, 25, 30, 35, 40, 50]
const RULE = { tier1MedMax: -0.01, tier1MinN: 60, tier2MedMax: -0.08, tier2MinN: 30 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(2) + '%')

async function main() {
  const sc = await readJson('scorecard.json', null)
  if (!sc?.episodes?.length) { console.error('스코어카드 없음 — scripts/scorecard.mjs 먼저 실행'); process.exit(1) }
  // 기준선 비교를 위해 ret7이 확정된 에피소드만 사용한다(동일 집합 원칙, 스펙 §3.3.2).
  const eps = sc.episodes.filter((e) => e.status === 'done' && e.ret7 != null && e.entryPrice > 0)
  console.log(`에피소드 ${eps.length}건 (전체 ${sc.episodes.length})`)

  // 마켓별 일봉 1회 조회
  const markets = [...new Set(eps.map((e) => e.market))]
  const candles = {}
  let skipped = 0
  for (const m of markets) {
    const c = await getDayCandles(m, 200)
    await sleep(200)
    if (!c || c.length < 30) { skipped++; continue }
    candles[m] = confirmedOhlcv(candlesToOhlcv(c))
  }
  console.log(`캔들 확보 ${Object.keys(candles).length} / 스킵 ${skipped}`)

  const usable = eps.filter((e) => candles[e.market])
  const train = usable.filter((e) => e.entryTs <= TRAIN_END)
  const holdout = usable.filter((e) => e.entryTs > TRAIN_END)
  console.log(`학습 ${train.length}건 (~${TRAIN_END.slice(0, 10)}) / 홀드아웃 ${holdout.length}건`)

  const nowMs = Date.now()
  // 기준선: 청산규칙 없이 7일 종가 보유. 선정값과 반드시 같은 집합에서 산출한다.
  const baselineOf = (set) => summarizeTrades(set.map((e) => ({ ret: e.ret7, reason: 'hold7' })))
  const trainBase = baselineOf(train)
  const holdBase = baselineOf(holdout)
  console.log(`\n[기준선 7일보유] 학습 n=${trainBase.n} 승률 ${pct(trainBase.winRate)} 평균 ${pct(trainBase.meanRet)} 중앙 ${pct(trainBase.medianRet)}`)

  // ── 과열 분석을 청산 선정보다 먼저 수행한다 ──
  // 스펙 §7: 과열 필터는 청산 레벨 게이트와 독립 진행 가능해야 한다.
  // 선정 뒤에 두면 게이트 조기종료 시 이 산출물이 비어 Task 4가 막힌다(순서 의존 없음).
  // 에피소드 참조를 함께 들고 간다 — 인덱스로 짝짓지 않는다(필터로 길이가 어긋난다).
  const rows = []
  for (const e of train) {
    const arr = candles[e.market]
    const d0 = Math.floor(Date.parse(e.entryTs) / 1000 / 86400)
    const upto = arr.filter((c) => Math.floor(c.time / 86400) < d0)
    const runUpPct = calcRunUpPct(upto.map((c) => c.close), RUNUP_LOOKBACK)
    if (runUpPct != null) rows.push({ runUpPct, fwd7: e.ret7, ep: e })
  }
  const table = overextensionTable(rows, RUNUP_THRESHOLDS)
  const rule = applyPreRegisteredRule(table, RULE)
  console.log('\n[과열 사전등록 규칙 — 학습 구간]')
  for (const r of table) console.log(`  >${r.threshold}%: n=${r.n} 승률 ${pct(r.winRate)} 중앙 ${pct(r.medianRet)}`)
  console.log(`  단조성 ${rule.monotonic ? '성립' : '❌ 불성립 — 과열 필터 보류'}`)
  console.log(`  ⇒ RUNUP_TIER1_PCT = ${rule.tier1Pct}, RUNUP_TIER2_PCT = ${rule.tier2Pct}`)
  const overext = { table, rule }

  const runGrid = (set) => {
    const cells = []
    for (const slPct of AXES.slPct) for (const tpPct of AXES.tpPct) for (const holdMax of AXES.holdMax) {
      const params = { slPct, tpPct, holdMax }
      const trades = set.map((e) => {
        const r = scoreStrategyOutcome(e, candles[e.market], params, nowMs)
        return r.reason === 'open' || r.reason === 'no-data' ? { ret: null, reason: r.reason } : { ret: r.ret, reason: r.reason }
      })
      cells.push({ params, summary: summarizeTrades(trades) })
    }
    return cells
  }

  const trainCells = runGrid(train)
  const sel = pickBest(trainCells, AXES, { minTrades: MIN_TRADES, baseline: trainBase })

  console.log('\n[상위 5조합 — 학습, 평균수익 기준. 게이트(평균·중앙값 두 다리) 통과 여부와 무관한 나열]')
  for (const c of [...trainCells].filter((c) => c.summary.n >= MIN_TRADES)
    .sort((a, b) => b.summary.meanRet - a.summary.meanRet).slice(0, 5)) {
    console.log(`  ${cellKey(c.params)}  n=${c.summary.n} 승률 ${pct(c.summary.winRate)} 평균 ${pct(c.summary.meanRet)} 중앙 ${pct(c.summary.medianRet)} ${JSON.stringify(c.summary.reasons)}`)
  }

  // 게이트 실패로 조기종료해도 overext는 채워서 쓴다 — Task 4(과열 필터)가 여기에 의존한다.
  if (!sel.chosen) { console.log(`\n❌ 게이트 실패: ${sel.reason}`); await writeReport({ sel, trainBase, holdBase, trainCells, holdoutSummary: null, overext, regime: null }); process.exit(0) }

  console.log(`\n[선정] ${cellKey(sel.chosen.params)}  평균 ${pct(sel.chosen.summary.meanRet)} 중앙 ${pct(sel.chosen.summary.medianRet)}`)
  // stability는 chosen을 서술한다(Ruling F1). 거부된 봉우리는 bestStability.
  console.log(`[이웃안정성] 채택셀 비율 ${sel.stability.ratio == null ? 'n/a' : sel.stability.ratio.toFixed(2)} (이웃중앙 ${pct(sel.stability.nbrMedian)}) → ${sel.stability.stable ? '안정' : '판정불가'}`)
  if (cellKey(sel.best.params) !== cellKey(sel.chosen.params)) {
    // sel.best는 "게이트 통과 셀 중 평균 1위"이며 그리드 전체의 argmax가 아니다(exit-select.mjs 주석).
    console.log(`  ⚠️ 게이트 통과 셀 중 평균 1위 ${cellKey(sel.best.params)}은 봉우리(이웃비율 ${sel.bestStability.ratio == null ? 'n/a' : sel.bestStability.ratio.toFixed(2)})로 판정되어 교체됨`)
  }

  // 홀드아웃은 확인용 1회만 — 보고 재선정하지 않는다.
  const holdTrades = holdout.map((e) => {
    const r = scoreStrategyOutcome(e, candles[e.market], sel.chosen.params, nowMs)
    return r.reason === 'open' || r.reason === 'no-data' ? { ret: null, reason: r.reason } : { ret: r.ret, reason: r.reason }
  })
  const holdoutSummary = summarizeTrades(holdTrades)
  console.log(`\n[홀드아웃 확인] n=${holdoutSummary.n} 승률 ${pct(holdoutSummary.winRate)} 평균 ${pct(holdoutSummary.meanRet)} 중앙 ${pct(holdoutSummary.medianRet)}`)
  console.log(`  vs 기준선 n=${holdBase.n} 평균 ${pct(holdBase.meanRet)} 중앙 ${pct(holdBase.medianRet)}`)

  // 레짐 구성비 — 아카이브의 스캔별 regime을 구간별로 집계
  const regime = regimeComposition(TRAIN_END)
  console.log(`\n[레짐 구성비] 학습 ${JSON.stringify(regime.train)} / 홀드아웃 ${JSON.stringify(regime.holdout)}`)
  console.log('  ⚠️ 홀드아웃이 강세 구간에 몰리면 수치가 부풀어 보인다. 숫자만으로 결론 금지.')

  // 과열 제외 부분집합 민감도 (스펙 §3.3.6) — table/rule은 위에서 이미 계산됨
  // 과열 에피소드를 id로 식별해 제외한다(인덱스 짝짓기 금지).
  const hotIds = new Set(
    rows.filter((r) => rule.tier2Pct != null && r.runUpPct > rule.tier2Pct).map((r) => r.ep.id),
  )
  const exHot = train.filter((e) => !hotIds.has(e.id))
  const exTrades = exHot.map((e) => {
    const r = scoreStrategyOutcome(e, candles[e.market], sel.chosen.params, nowMs)
    return r.reason === 'open' || r.reason === 'no-data' ? { ret: null, reason: r.reason } : { ret: r.ret, reason: r.reason }
  })
  const exSummary = summarizeTrades(exTrades)
  const exBase = baselineOf(exHot)
  console.log(`\n[과열 제외 민감도] n=${exSummary.n} 평균 ${pct(exSummary.meanRet)} vs 기준선 ${pct(exBase.meanRet)} → ${exSummary.meanRet >= exBase.meanRet ? '통과' : '⚠️ 미달'}`)

  console.log(`\n${sel.passesGate ? '✅ 게이트 통과' : '❌ 게이트 실패(기준선 미달)'} — ${sel.reason}`)
  await writeReport({ sel, trainBase, holdBase, trainCells, holdoutSummary, overext, regime })

  if (sel.passesGate) {
    await writeJson('exit-config.json', {
      version: 'general-exit-v1',
      confirmedAt: new Date().toISOString(),
      slPct: sel.chosen.params.slPct,
      tpPct: sel.chosen.params.tpPct,
      holdMax: sel.chosen.params.holdMax,
    })
    console.log('data/exit-config.json 기록 완료')
  } else {
    console.log('기준선 미달 — exit-config.json을 쓰지 않는다. Task 5~7 중단.')
  }
}

// 아카이브 스캔의 regime.trend를 학습/홀드아웃 구간별로 집계.
// (컨트롤러 결정: lib/archive.mjs::readArchive()가 이미 존재+line-split+JSON.parse
// 스킵을 수행하므로 dynamic import 핸드롤 대신 이를 재사용한다. 아카이브 없음 허용은
// readArchive 내부의 existsSync 가드가 처리한다.)
function regimeComposition(trainEnd) {
  const out = { train: {}, holdout: {} }
  for (const s of readArchive()) {
    const t = s?.regime?.trend
    if (!t || !s.timestamp) continue
    const b = s.timestamp <= trainEnd ? out.train : out.holdout
    b[t] = (b[t] ?? 0) + 1
  }
  return out
}

async function writeReport(r) {
  await writeJson('exit-backtest-report.json', { generatedAt: new Date().toISOString(), ...r })
}

main().catch((e) => { console.error(e); process.exit(1) })
