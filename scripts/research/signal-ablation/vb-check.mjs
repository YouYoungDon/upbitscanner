// SMC V-Bottom·유동성 스윕(우리 라이브 신호) — 회사 '거래량 클라이맥스 반등'이 강한 역방향으로 나와 같은 틀로 확인(2026-10-19)
import { obs, MID, mean, pct } from './lib.mjs'
import { score } from './score.mjs'
import { clusteredT } from '../../../lib/perf-metrics.mjs'
const cell = (r, h) => { r = r.filter((x) => x[h] != null); if (r.length < 5) return 'n<5'; const t = clusteredT(r.map((x) => ({ day: x.d, v: x[h] }))).t; return `${pct(mean(r.map((x) => x[h]))).padStart(6)}(t${t == null ? ' —' : t.toFixed(1).padStart(5)})` }
const line = (lab, rows) => console.log(lab.padEnd(28), 'n', String(rows.length).padStart(5), ['x1', 'x3', 'x7'].flatMap((h) => [['전', (x) => x.d < MID], ['후', (x) => x.d >= MID]].map(([l, f]) => `${h}${l} ${cell(rows.filter(f), h)}`)).join(' '))
line('V-Bottom 발동(전체)', obs.filter((x) => x.vb != null))
line('V-Bottom & 현재 픽', obs.filter((x) => x.vb != null && score(x, {}) >= 5))
line('유동성 스윕(매수) 발동', obs.filter((x) => x.sw?.[0] === 'buy'))
line('유동성 스윕 & 현재 픽', obs.filter((x) => x.sw?.[0] === 'buy' && score(x, {}) >= 5))
const V0 = obs.filter((x) => score(x, {}) >= 5)
const noVB = obs.filter((x) => score(x, { drop: new Set(['SMC V-Bottom']) }) >= 5)
line('픽 V0 현재', V0)
line('픽 V-Bottom 제거', noVB)
