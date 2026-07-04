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

export function tierFor(earlyScore, cuts) {
  if (earlyScore == null) return null
  if (earlyScore >= cuts.S) return 'S'
  if (earlyScore >= cuts.A) return 'A'
  if (earlyScore >= cuts.B) return 'B'
  if (earlyScore >= cuts.C) return 'C'
  return null
}

export function contextLabelFor(earlyScore, confirmScore, th) {
  const e = (earlyScore ?? 0) >= th.earlyHigh, c = (confirmScore ?? 0) >= th.confirmHigh
  if (e && c) return 'early_inflow_with_confirmation'
  if (e && !c) return 'early_inflow_unconfirmed'
  if (!e && c) return 'breakout_already_confirmed'
  return 'weak_signal'
}

// heuristic confidence object. quality guard는 개별 판정(수정 5), coverage 낮으면 하향(수정 8).
export function assessConfidence({ earlyNormalized, extensionPenalty, coverage, qualityGuards, config }) {
  const reasons = []
  const strong = Object.values(earlyNormalized).filter((v) => v != null && v > 70).length
  if (strong) reasons.push(`${strong} early features above 70`)
  const extLow = extensionPenalty <= (config?.thresholds?.extensionLow ?? 0.15)
  if (extLow) reasons.push('extension penalty low')
  const liqOk = (qualityGuards?.liquidity ?? 0) >= 40
  const absOk = (qualityGuards?.abs_trading_value ?? 0) >= 40
  if (liqOk) reasons.push('liquidity sufficient')
  if (absOk) reasons.push('absolute trading value sufficient')
  let label = 'low'
  if (strong >= 4 && extLow) label = 'high'
  else if (strong >= 2) label = 'medium'
  if (!liqOk && !absOk) { label = label === 'high' ? 'medium' : 'low'; reasons.push('both quality guards low') }
  if (coverage < 0.6) { label = label === 'high' ? 'medium' : 'low'; reasons.push(`low coverage (${(coverage * 100).toFixed(0)}%)`) }
  return { type: 'heuristic', label, reasons }
}

export function scoreUniverse(ctxs, registry, config, market = {}) {
  const raws = computeRaws(ctxs, registry)
  const dist = buildUniverseDist(raws, registry, config)
  const regimeMultiplier = (config.regimeMultiplier || {})[market.btcTrend] ?? 1.0
  const timeMultiplier = 1.0 // v1 고정. Time-of-day = 확장 seam (config.timeMultiplier).
  return ctxs.map((ctx, i) => {
    const base = scoreCoin(ctx, raws[i], dist, registry, config)
    const extensionPenalty = computeExtensionPenalty(ctx, config)
    const earlyScoreAfterExtension = applyExtension(base.earlyScoreRaw, extensionPenalty)
    // 최종 earlyScore = afterExtension × regimeMult × timeMult, [0,100] 클램프. (수정 3)
    const earlyScore = earlyScoreAfterExtension == null ? null
      : +Math.min(100, Math.max(0, earlyScoreAfterExtension * regimeMultiplier * timeMultiplier)).toFixed(2)
    const earlyGroup = Object.fromEntries(Object.entries(base.features).filter(([, f]) => f.group === 'early').map(([k, f]) => [k, f.normalized]))
    const coverageAll = Object.values(base.features)
    const coverage = coverageAll.filter((f) => f.normalized != null).length / (coverageAll.length || 1)
    const qualityGuards = { liquidity: base.features.liquidity?.normalized ?? null, abs_trading_value: base.features.abs_trading_value?.normalized ?? null }
    const confidence = assessConfidence({ earlyNormalized: earlyGroup, extensionPenalty, coverage, qualityGuards, config })
    const tier = tierFor(earlyScore, config.tierCutoffs)                 // 최종 earlyScore 기준
    const contextLabel = contextLabelFor(earlyScore, base.confirmScore, config.thresholds)
    return {
      version: config.version, market: base.market,
      earlyScoreRaw: base.earlyScoreRaw, extensionPenalty, earlyScoreAfterExtension,
      regimeMultiplier, timeMultiplier, earlyScore, confirmScore: base.confirmScore,
      tier, contextLabel, confidence, features: base.features,
    }
  })
}
