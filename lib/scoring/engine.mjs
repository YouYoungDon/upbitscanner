// lib/scoring/engine.mjs
import { normalize } from './normalizers.mjs'
import { resolveGroup } from './config.mjs'
import { calcEMA } from '../indicators.mjs'

export function weightedAverage(items) {
  const valid = items.filter((i) => i.normalized != null && !Number.isNaN(i.normalized) && i.weight > 0)
  if (!valid.length) return null
  const wsum = valid.reduce((s, i) => s + i.weight, 0)
  return +(valid.reduce((s, i) => s + i.normalized * i.weight, 0) / wsum).toFixed(2)
}

// Pass 1: 코인×피처 raw. 예외/부족은 null.
export function computeRaws(ctxs, registry) {
  return ctxs.map((ctx) => {
    const row = {}
    for (const f of registry) { try { row[f.name] = f.compute(ctx) } catch { row[f.name] = null } }
    return row
  })
}

// percentile 피처의 유니버스 분포.
export function buildUniverseDist(raws, registry, config) {
  const dist = {}
  for (const f of registry) {
    if (f.normalizer !== 'percentileVsUniverse') continue
    dist[f.name] = raws.map((r) => r[f.name]).filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b)
  }
  return dist
}

// Pass 2: 한 코인 정규화 + 그룹별 가중평균.
export function scoreCoin(ctx, raw, dist, registry, config) {
  const features = {}
  const early = [], confirm = []
  for (const f of registry) {
    const weight = (config.weights || {})[f.name] ?? 0
    const group = resolveGroup(f.name, config.groups, registry)
    const opts = { dist: dist[f.name], params: f.params }
    if (f.normalizer === 'vsOwnHistory') { try { opts.hist = f.history ? f.history(ctx) : null } catch { opts.hist = null }; opts.params = f.params }
    const normalized = normalize(f.normalizer, raw[f.name], opts)
    features[f.name] = { raw: raw[f.name], normalized, group, weight, normalizer: f.normalizer }
    if (weight > 0) (group === 'confirm' ? confirm : early).push({ normalized, weight })
  }
  const earlyScoreRaw = weightedAverage(early)
  const confirmScore = weightedAverage(confirm)
  return { market: ctx.coin?.market, features, earlyScoreRaw, confirmScore }
}

export function computeExtensionPenalty(ctx, config) {
  const closes = ctx.coin?.ohlcvDaily?.map((c) => c.close) || []
  if (closes.length < 20) return 0
  const e20 = calcEMA(closes, 20).at(-1)
  if (!(e20 > 0)) return 0
  const cap = config?.thresholds?.extensionCap ?? 0.30
  const stretch = (closes.at(-1) / e20 - 1) / cap
  return +Math.min(1, Math.max(0, stretch)).toFixed(3)
}

export function applyExtension(earlyScoreRaw, penalty) {
  if (earlyScoreRaw == null) return null
  return +(earlyScoreRaw * (1 - penalty)).toFixed(2)
}
