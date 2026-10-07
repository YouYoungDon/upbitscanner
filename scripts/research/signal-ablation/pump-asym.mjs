// 비대칭 검사: 급등(7일 고가 +30%) 리프트 vs 급락(7일 저가 −23%, 로그 대칭) 리프트.
// 진짜 매집 전조라면 급등만 늘고 급락은 늘지 않아야 한다(= 단순 변동성이 아님).
import { readFileSync } from 'node:fs'
import { obs, MID, mean, pct } from './lib.mjs'
const rows = JSON.parse(readFileSync(new URL('../../../data/research/pump-rows.json', import.meta.url)))
const byKey = new Map(obs.map((x) => [`${x.m}|${x.d}`, x]))
// pump-rows에는 m이 없으므로 순서로 다시 맞추지 않고, obs에서 같은 조건으로 재구성한 a7을 d·x7로 찾을 수 없다 → obs 쪽을 기준으로 다시 집계
const all = obs.filter((x) => x.f7 != null && x.a7 != null)
const P = (rs) => rs.filter((x) => x.f7 >= 0.30).length / rs.length
const C = (rs) => rs.filter((x) => x.a7 <= -0.23).length / rs.length
const halves = [all.filter((x) => x.d < MID), all.filter((x) => x.d >= MID)]
const BP = halves.map(P), BC = halves.map(C)
console.log(`기준 급등 ${pct(BP[0], 1)}/${pct(BP[1], 1)}%, 급락 ${pct(BC[0], 1)}/${pct(BC[1], 1)}% (전반/후반)`)
const show = (name, pred) => {
  const out = halves.map((h, k) => { const s = h.filter(pred); return { n: s.length, up: P(s) / BP[k], dn: C(s) / BC[k], x7: mean(s.map((x) => x.x7).filter((v) => v != null)) } })
  console.log(name.padEnd(40), out.map((o) => `n${String(o.n).padStart(5)} 급등×${o.up.toFixed(2)} 급락×${o.dn.toFixed(2)} 비대칭 ${(o.up / o.dn).toFixed(2)} 7일초과 ${pct(o.x7, 1)}`).join(' | '))
}
const has = (x, k) => x.b.some(([kk]) => kk === k)
show('전체', () => true)
show('조용한 바닥(RSI≤26·K≤15·vr≤1.5)', (x) => x.rsi != null && x.rsi <= 26 && x.k != null && x.k <= 15 && x.vr <= 1.5)
show('과매도 RSI<30', (x) => x.rsi != null && x.rsi < 30)
show('수축 + 거래량 증가 없음(vr<0.8)', (x) => x.vr < 0.8 && x.e20 != null && Math.abs(x.e20) < 0.02)
show('횡보(|p5|<3%) + vr 1.5~3', (x) => Math.abs(x.p5) < 0.03 && x.vr >= 1.5 && x.vr < 3)
show('당일 +2%↑ & vr≥2 (구 거래량급증)', (x) => x.p1 >= 0.02 && x.vr >= 2)
show('당일 +10%↑ (이미 급등)', (x) => x.p1 >= 0.10)
show('저유동(tv<4억)', (x) => x.tv < 4e8)
show('고변동 윗꼬리 hl≥6%', (x) => x.hl >= 0.06)
