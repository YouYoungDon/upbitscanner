// lib/scoring/features/index.mjs
// 피처 plugin 계약:
//   { name, defaultGroup:'early'|'confirm', normalizer, params?, compute(ctx)->raw|null, history?(ctx)->number[] }
//   compute/history는 데이터 부족 시 null 반환(throw 금지). 최종 group은 scoring-config.json이 우선.
import relativeVolume from './relativeVolume.mjs'
export default [relativeVolume]
