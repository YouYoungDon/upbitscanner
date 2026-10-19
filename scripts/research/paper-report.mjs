// 모의매매 판정 리포트 — 점검일(2026-11-05 무렵)에 실행: node scripts/research/paper-report.mjs
// 판정 4요건(memory quant-qa-2026-10-08): ① 같은 기간 시장 대비 초과 ② 진입일 군집 t ③ 비용 차감(여기선 실제
// 호가 체결+수수료+손절 슬리피지로 이미 반영) ④ 전/후반 분할. |t|≥2가 아니면 "엣지 없음"으로 읽는다.
// 시장 수익은 data/market-baseline.json(UTC 일 단위, 09:00 KST 종가 기준)으로 진입일 종가→청산일 종가를
// 근사한다 — 진입·청산이 장중이라 하루 안쪽 오차가 있다.
import { readJson } from '../../lib/store.mjs'
import { maxDrawdown } from '../../lib/perf-metrics.mjs'
import { summarizeTrades } from '../../lib/paper-summary.mjs'
import { baselineReturn } from '../../lib/market-baseline.mjs'
import { PAPER } from '../../lib/paper.mjs'
import { VERDICT, ruleRows, decide, power, idealExit, fillGap, costFrom, vsRandom } from '../../lib/verdict.mjs'
import { getDayCandles, candlesToOhlcv } from '../../lib/upbit.mjs'
import { confirmedOhlcvAsOf } from '../../lib/ohlcv.mjs'

const DAY = 86400_000
const utcDay = (ms) => Math.floor(ms / DAY)
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
const tStr = (r) => (r.t == null ? '-' : r.t.toFixed(2))

const st = await readJson('paper-trades.json', null)
if (!st) { console.log('data/paper-trades.json 없음 — 모의매매가 아직 돌지 않았습니다.'); process.exit(0) }
const daily = (await readJson('market-baseline.json', { daily: {} })).daily || {}

console.log(`모의매매 시작 ${st.startedAt} · 마지막 실행 ${st.lastRun}`)
console.log(`규칙: 장부별 ${PAPER.START_CASH.toLocaleString()}원, 건당 ${PAPER.POSITION_KRW.toLocaleString()}원, 최대 ${PAPER.MAX_OPEN}건, 스캔당 ${PAPER.MAX_PER_SCAN}건, 수수료 ${PAPER.FEE * 100}%×2, 손절 슬리피지 ${PAPER.STOP_SLIP * 100}%`)

// ── 판정(스코어카드 기반, 설계 docs/superpowers/specs/2026-10-19-paper-verdict-design.md) ──
// 장부는 자금 제약으로 표본이 작아 판정은 메인 픽 전부(스코어카드)로 한다. 장부는 비용 보정·무작위 대조에 쓴다.
const dayStr = (d) => (d == null ? '-' : new Date(d * DAY).toISOString().slice(0, 10))
const VERDICT_KO = {
  pass: '✅ 통과 — 소액 실전 논의',
  fail: '⛔ 실패 — 반등 매수 신호를 참고용으로 내리고 재설계',
  inconclusive: '⏸ 판정 불가 — 판정 가능 예상일까지 연장',
}
const sc = await readJson('scorecard.json', null)
console.log('\n══ 판정 (메인 픽 전부 = 스코어카드, 손절·익절 규칙 수익 − 같은 기간 시장 − 비용) ══')
if (!sc?.episodes?.length) console.log('  스코어카드 없음 — npm run scorecard 후 다시 실행')
else if (!Object.keys(daily).length) console.log('  시장 기준선 없음 — npm run scorecard가 data/market-baseline.json을 만든다')
else {
  // 메인 장부 청산 거래마다 같은 스캔가·같은 손절/익절 %로 스코어카드 방식(일봉) 결과를 다시 계산해 실체결과 비교한다.
  const mainClosed = st.books.main?.closed ?? []
  const confirmedOf = {}
  for (const m of [...new Set(mainClosed.map((c) => c.market))]) {
    const raw = await getDayCandles(m, 200)
    if (Array.isArray(raw)) confirmedOf[m] = confirmedOhlcvAsOf(candlesToOhlcv(raw), Date.now())
    await new Promise((r) => setTimeout(r, 120))
  }
  const gap = fillGap(mainClosed.map((t) => ({ trade: t, ideal: idealExit(t, confirmedOf[t.market], Date.now())?.ret })))
  // 비용은 현재 체결 모델로 산 거래만으로 잰다 — v1은 손절 체결이 낙관적이라 바꾼 모델이다(lib/paper.mjs 주석).
  const gapNow = gap.byModel[PAPER.FILL_MODEL] ?? { n: 0, mean: null }
  const { cost, source } = costFrom(gapNow)
  const show = (label, from, to) => {
    const { rows, dropped } = ruleRows(sc.episodes, daily, { from, to, cost })
    const r = decide(rows), p = power(rows)
    console.log(`\n[${label}] ${r.n}건 · 진입일 ${r.days}일 · 평균 ${pct(r.mean)} (t ${tStr(r)})${dropped ? ` · 기준선 없어 제외 ${dropped}건` : ''}`)
    console.log(`  전반 ${pct(r.halves.first)} / 후반 ${pct(r.halves.second)} · 점수 하위 ${pct(r.terciles.low)} / 중간 ${pct(r.terciles.mid)} / 상위 ${pct(r.terciles.high)}`)
    const enough = p.need != null && p.days >= p.need
    console.log(`  검정력: |t|=2에 필요한 진입일 ${p.need ?? '-'}일(지금 ${p.days}일) · 판정 가능 예상 ${enough ? '지금 충분' : dayStr(p.etaDay)}`)
    return r
  }
  console.log(`비용 ${pct(cost)} (${source === 'measured' ? `실체결 차이 측정값, v${PAPER.FILL_MODEL} 짝 ${gapNow.n}건` : `기본 왕복 0.3% — v${PAPER.FILL_MODEL} 짝 ${gapNow.n}건 < ${VERDICT.MIN_PAIRS}건`})`)
  const r = show(`판정 표본 ${VERDICT.FROM.slice(0, 10)}~`, VERDICT.FROM, null)
  console.log(`  ▶ ${VERDICT_KO[r.verdict]} · ${r.reasons.join(' · ')}`)
  const models = Object.entries(gap.byModel).map(([m, b]) => `v${m} ${b.n}건 ${pct(b.mean)}`).join(' / ')
  console.log(`\n실체결 차이(장부 순수익 − 같은 스캔가 일봉 채점 수익): 짝 ${gap.n}건 · 평균 ${pct(gap.mean)} (t ${tStr(gap)}, ${gap.days}일)${models ? ` · ${models}` : ''}`)
  const vr = vsRandom(st.books.main?.closed ?? [], st.books.random?.closed ?? [])
  console.log(`무작위 대조(보조 — 두 장부 모두 자금 제약): 같은 스캔 ${vr.scans}회 · 메인 − 무작위 ${pct(vr.mean)} (t ${tStr(vr)}, ${vr.days}일)`)
  show('참고: 신호 정리 전 06-11~10-07, 판정에 안 씀', '2026-06-01T00:00:00Z', VERDICT.FROM)
  console.log('\n모멘텀은 스코어카드 대상이 아니라 아래 장부로만 본다(스캔당 픽 평균 약 1개 — 장부가 사실상 픽 전부, 표본 작음).')
}

function summarize(name, trades) {
  const s = summarizeTrades(trades, daily)
  if (!s.n) { console.log(`  ${name}: 청산 0건`); return }
  console.log(`  ${name}: ${s.n}건 · 승률 ${(s.win * 100).toFixed(0)}% · 거래 평균 ${pct(s.tradeMean)} · 진입일 평균 ${pct(s.dayMean)} (t ${tStr({ t: s.dayT })}, ${s.days}일) · 중앙값 ${pct(s.median)} · 손익 ${Math.round(s.pnl).toLocaleString()}원`)
  console.log(`     시장 대비 초과 ${pct(s.excMean)} (t ${tStr({ t: s.excT })}, ${s.excDays}일) · 청산 ${Object.entries(s.byType).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
}

for (const [src, book] of Object.entries(st.books)) {
  console.log(`\n[${src}] 현금 ${Math.round(book.cash).toLocaleString()}원 · 보유 ${book.open.length}건 · 건너뛴 스캔 ${book.skipped}`)
  const closed = [...book.closed].sort((a, b) => a.entryAt - b.entryAt)
  summarize('전체', closed)
  // 체결 모델(lib/paper.mjs FILL_MODEL)이 다르면 규칙이 달라 섞지 않는다 — 포지션을 산 때의 모델(c.fillModel)로 나눈다
  const models = [...new Set(closed.map((c) => c.fillModel ?? 1))].sort()
  if (st.modelChanges?.length) for (const m of models) summarize(`체결 모델 v${m}`, closed.filter((c) => (c.fillModel ?? 1) === m))
  if (closed.length >= 4) {
    const mid = utcDay(closed[Math.floor(closed.length / 2)].entryAt)
    summarize('전반', closed.filter((c) => utcDay(c.entryAt) < mid))
    summarize('후반', closed.filter((c) => utcDay(c.entryAt) >= mid))
  }
  const eq = st.equity.map((p) => p[src]).filter(Number.isFinite)
  if (eq.length > 1) {
    const rets = eq.slice(1).map((v, i) => v / eq[i] - 1)
    console.log(`  평가금 ${eq.at(-1).toLocaleString()}원 (${pct(eq.at(-1) / PAPER.START_CASH - 1)}) · 시간별 평가 MDD ${pct(maxDrawdown(rets).mdd)}`)
  }
  // 같은 기간 시장(동일가중) 누적 — 장부 전체를 시장과 비교
  const d0 = utcDay(new Date(st.startedAt).getTime()), d1 = utcDay(Date.now()) - 1
  const m = d1 > d0 ? baselineReturn(daily, d0, d1 - d0) : null
  if (m != null) console.log(`  같은 기간 시장(KRW 동일가중) ${pct(m)}`)
}
