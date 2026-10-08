// 모의매매 판정 리포트 — 점검일(2026-11-05 무렵)에 실행: node scripts/research/paper-report.mjs
// 판정 4요건(memory quant-qa-2026-10-08): ① 같은 기간 시장 대비 초과 ② 진입일 군집 t ③ 비용 차감(여기선 실제
// 호가 체결+수수료+손절 슬리피지로 이미 반영) ④ 전/후반 분할. |t|≥2가 아니면 "엣지 없음"으로 읽는다.
// 시장 수익은 data/market-baseline.json(UTC 일 단위, 09:00 KST 종가 기준)으로 진입일 종가→청산일 종가를
// 근사한다 — 진입·청산이 장중이라 하루 안쪽 오차가 있다.
import { readJson } from '../../lib/store.mjs'
import { clusteredT, maxDrawdown } from '../../lib/perf-metrics.mjs'
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
  const rows = trades.map((c) => {
    const d0 = utcDay(c.entryAt), n = utcDay(c.exitAt) - d0
    const m = n === 0 ? 0 : baselineReturn(daily, d0, n)
    return { ...c, day: d0, mkt: m, exc: m == null ? null : c.net - m }
  })
  const n = rows.length
  if (!n) { console.log(`  ${name}: 청산 0건`); return }
  const nets = rows.map((r) => r.net).sort((a, b) => a - b)
  const net = clusteredT(rows.map((r) => ({ day: r.day, v: r.net })))
  const exc = clusteredT(rows.filter((r) => r.exc != null).map((r) => ({ day: r.day, v: r.exc })))
  const win = rows.filter((r) => r.net > 0).length / n
  const byType = rows.reduce((a, r) => ({ ...a, [r.exitType]: (a[r.exitType] || 0) + 1 }), {})
  const pnl = rows.reduce((s, r) => s + r.pnl, 0)
  console.log(`  ${name}: ${n}건 · 승률 ${(win * 100).toFixed(0)}% · 평균 ${pct(net.mean)} (진입일 t ${tStr(net)}, ${net.days}일) · 중앙값 ${pct(nets[Math.floor(n / 2)])} · 손익 ${Math.round(pnl).toLocaleString()}원`)
  console.log(`     시장 대비 초과 ${pct(exc.mean)} (t ${tStr(exc)}, ${exc.days}일) · 청산 ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
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
