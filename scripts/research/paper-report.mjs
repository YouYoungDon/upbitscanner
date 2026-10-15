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

const DAY = 86400_000
const utcDay = (ms) => Math.floor(ms / DAY)
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
const tStr = (r) => (r.t == null ? '-' : r.t.toFixed(2))

const st = await readJson('paper-trades.json', null)
if (!st) { console.log('data/paper-trades.json 없음 — 모의매매가 아직 돌지 않았습니다.'); process.exit(0) }
const daily = (await readJson('market-baseline.json', { daily: {} })).daily || {}

console.log(`모의매매 시작 ${st.startedAt} · 마지막 실행 ${st.lastRun}`)
console.log(`규칙: 장부별 ${PAPER.START_CASH.toLocaleString()}원, 건당 ${PAPER.POSITION_KRW.toLocaleString()}원, 최대 ${PAPER.MAX_OPEN}건, 스캔당 ${PAPER.MAX_PER_SCAN}건, 수수료 ${PAPER.FEE * 100}%×2, 손절 슬리피지 ${PAPER.STOP_SLIP * 100}%`)

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
