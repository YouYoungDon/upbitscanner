// 회사 신호 5종 + 지속성 보너스 순서 — 재생 판정(2026-10-19). 판정 기준은 README의 4요건:
// 같은 날 전 종목 평균 대비 초과수익(x1/x3/x7), 진입일 군집 t(|t|≥2만 신호), 왕복 비용 0.3%, 전/후반 분할.
// 먼저 company-signals-flags.mjs 로 data/research/company-flags.json 을 만든다.
import { readFileSync } from 'node:fs'
import { obs, MID, mean, pct } from './lib.mjs'
import { score } from './score.mjs'
import { clusteredT } from '../../../lib/perf-metrics.mjs'
import { COMPANY_POINTS } from './company-signals.mjs'

const flags = JSON.parse(readFileSync(new URL('../../../data/research/company-flags.json', import.meta.url)))
const has = (x, k) => (flags[`${x.m}|${x.d}`] || []).includes(k)
const KEYS = Object.keys(COMPANY_POINTS)
const NAME = { obvDiv: 'OBV 매집 다이버전스', rsiDiv: 'RSI 강세 다이버전스', wBottom: 'W-Bottom 쌍바닥', baseBuild: '밑바닥 다지기', volClimax: '거래량 클라이맥스 반등' }
const H = ['x1', 'x3', 'x7']
const halves = [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]]

// 한 칸: 평균 초과수익(%p)과 진입일 군집 t
function cell(rows, h) {
  const r = rows.filter((x) => x[h] != null)
  if (r.length < 5) return '   n<5      '
  const t = clusteredT(r.map((x) => ({ day: x.d, v: x[h] }))).t
  return `${pct(mean(r.map((x) => x[h]))).padStart(6)}(t${t == null ? ' —' : t.toFixed(1).padStart(5)})`
}
function line(label, rows) {
  const days = new Set(rows.map((x) => x.d)).size
  const parts = H.flatMap((h) => halves.map(([lab, f]) => `${h}${lab} ${cell(rows.filter(f), h)}`))
  console.log(label.padEnd(26), `n ${String(rows.length).padStart(6)} (${(rows.length / 539).toFixed(1)}/일, ${days}일)`, parts.join(' '))
}

const base = new Map(obs.map((x) => [x, score(x, {})]))

console.log('\n== 1) 신호가 켜진 날 자체 (전 관측, 현재 점수와 무관)')
line('전체 관측(기준선=0)', obs)
for (const k of KEYS) line(NAME[k], obs.filter((x) => has(x, k)))

console.log('\n== 2) 현재 매수 픽(점수≥5)과 겹치는지 — 신호가 켜진 관측 중')
for (const k of KEYS) {
  const on = obs.filter((x) => has(x, k))
  line(`${NAME[k]} & 현재 픽`, on.filter((x) => base.get(x) >= 5))
  line(`${NAME[k]} & 현재 비픽`, on.filter((x) => base.get(x) < 5))
}

console.log('\n== 3) 현재 점수에 회사 점수를 더했을 때 매수 픽(≥5) 전체 — 배수 감점 전에 가산')
const picks = (fn) => obs.filter((x) => fn(x) >= 5)
line('V0 현재', picks((x) => base.get(x)))
for (const k of KEYS) line(`+ ${NAME[k]} ${COMPANY_POINTS[k]}점`, picks((x) => (has(x, k) ? score(x, { add: () => COMPANY_POINTS[k] }) : base.get(x))))
line('+ 5종 전부', picks((x) => { const a = KEYS.filter((k) => has(x, k)).reduce((s, k) => s + COMPANY_POINTS[k], 0); return a ? score(x, { add: () => a }) : base.get(x) }))
// 새로 픽이 된 것만 따로 — 추가된 픽이 기존 픽보다 나은가
for (const k of KEYS) line(`  ㄴ ${NAME[k]}로 새로 픽`, obs.filter((x) => has(x, k) && base.get(x) < 5 && score(x, { add: () => COMPANY_POINTS[k] }) >= 5))

console.log('\n== 4) 지속성 보너스(+1/+2) 위치 — 현재(배수 감점 뒤) vs 감점 앞')
const key = (x) => `${x.m}|${x.d}`
const baseByKey = new Map(obs.map((x) => [key(x), base.get(x)]))
const streak = (x) => { let s = 0; for (let d = x.d - 1; (baseByKey.get(`${x.m}|${d}`) ?? 0) >= 5; d--) s++; return s }
const bonus = (x) => { const s = streak(x); return s >= 3 ? 2 : s >= 2 ? 1 : 0 }
line('보너스 없음', picks((x) => base.get(x)))
line('보너스 감점 뒤(현재 라이브)', picks((x) => base.get(x) + bonus(x)))
line('보너스 감점 앞', picks((x) => { const b = bonus(x); return b ? score(x, { add: () => b }) : base.get(x) }))
line('  ㄴ 두 방식이 갈리는 관측', obs.filter((x) => { const b = bonus(x); if (!b) return false; const after = base.get(x) + b >= 5, before = score(x, { add: () => b }) >= 5; return after !== before }))

console.log('\n읽는 법: 초과수익 %p(같은 날 전 종목 평균 대비). |t|≥2만 신호. 1일(x1)은 왕복 비용 0.3%p를 넘어야 실거래 이득.')
console.log('한계: candles.json은 현재 상장 코인만(생존 편향 — 바닥 매수 쪽이 유리하게 나온다), 2025-04~2026-10-07.')
