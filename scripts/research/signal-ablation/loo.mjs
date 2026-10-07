import { obs, mean, pct, MID } from './lib.mjs'
import { score } from './score.mjs'
const parts = [['전반', (x) => x.d < MID], ['후반', (x) => x.d >= MID]]
const H = ['x1', 'x3', 'x7']
function metrics(opt, thr = 5) {
  const out = {}
  for (const h of H) for (const [lab, part] of parts) {
    const rows = obs.filter((x) => x[h] != null && part(x)).map((x) => ({ x, s: score(x, opt) }))
    const picks = rows.filter((r) => r.s >= thr)
    const by = new Map(); for (const r of picks) (by.get(r.x.d) || by.set(r.x.d, []).get(r.x.d)).push(r)
    const top = []; for (const ps of by.values()) top.push(...ps.sort((a, b) => b.s - a.s).slice(0, 5))
    out[`${h}${lab}`] = { all: mean(picks.map((r) => r.x[h])), top: mean(top.map((r) => r.x[h])), n: picks.length }
  }
  return out
}
const baseDrop = ['거래량 급증']
const B = metrics({ drop: new Set(baseDrop) })
const cands = {
  'MACD 반등(중복)': { drop: ['MACD 반등'] }, 'MACD 골든크로스': { drop: ['MACD 골든크로스'] }, 'MACD 상승': { drop: ['MACD 상승'] },
  'RSI 과매도': { drop: ['RSI 과매도'] }, 'BB 하단 지지': { drop: ['BB 하단 지지'] }, 'Stoch 과매도 GC': { drop: ['Stoch 과매도 골든크로스'] },
  'Stoch 과매도': { drop: ['Stoch 과매도'] }, 'Williams %R 과매도': { drop: ['Williams %R 과매도'] }, 'EMA 20/50 GC': { drop: ['EMA 20/50 골든크로스'] },
  'EMA 상승배열': { drop: ['EMA 상승배열'] }, '거래량 선행 매집': { drop: ['거래량 선행 매집'] }, '캔들 강세형': { drop: ['캔들 강세형'] },
  '역삼중바닥': { drop: ['역삼중바닥 패턴'] }, '상승깃발': { drop: ['상승깃발 패턴'] }, 'SMC 스윕': { drop: ['SMC 유동성 스윕'] }, 'SMC Pump': { drop: ['SMC Pump Start'] },
  '[콤보] 반등확인 ×1.4': { noGcCombo: true }, '[콤보] 과매도함정 ×0.55': { noTrap: true }, '[필터] 낙하칼 ×0.5': { noKnife: true }, '[레짐] 약세 ×0.85': { noRegime: true },
}
console.log('기준 = V1(거래량급증 매수 제거). 값 = 제거 시 변화(%p), 픽 평균 / TOP5. +면 제거가 개선')
console.log('후보'.padEnd(24), H.map((h) => `${h} 전반       후반      `).join(''), ' 판정')
for (const [name, c] of Object.entries(cands)) {
  const M = metrics({ ...c, drop: new Set([...baseDrop, ...(c.drop || [])]) })
  const cells = [], deltas = []
  for (const h of H) for (const [lab] of parts) {
    const k = `${h}${lab}`, da = M[k].all - B[k].all, dt = M[k].top - B[k].top
    deltas.push(da, dt); cells.push(`${pct(da).padStart(5)}/${pct(dt).padStart(5)}`)
  }
  const worse = deltas.filter((d) => d < -0.0005).length, better = deltas.filter((d) => d > 0.0005).length
  const verdict = worse === 0 ? '삭제(무해)' : better > worse * 2 ? '삭제 후보(대체로 개선)' : worse > better * 2 ? '유지(제거 시 악화)' : '혼재'
  console.log(name.padEnd(24), cells.join(' '), ' ', `${better}↑ ${worse}↓`, verdict)
}
