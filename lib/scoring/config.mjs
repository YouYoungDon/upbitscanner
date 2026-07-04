// lib/scoring/config.mjs
export function resolveGroup(name, groups = {}, registry = []) {
  if (groups[name]) return groups[name]
  const f = registry.find((x) => x.name === name)
  return f ? f.defaultGroup : null
}

export function validateConfig(config, registry = []) {
  const errors = [], warnings = []
  const known = new Set(registry.map((f) => f.name))
  for (const [name, w] of Object.entries(config.weights || {})) {
    if (typeof w !== 'number' || Number.isNaN(w)) errors.push(`weight for ${name} is not a number`)
    else if (w < 0) errors.push(`weight for ${name} is negative`)
    if (!known.has(name)) warnings.push(`weight for unknown feature: ${name}`)
  }
  for (const [name, g] of Object.entries(config.groups || {})) {
    if (g !== 'early' && g !== 'confirm') errors.push(`invalid group '${g}' for ${name}`)
  }
  const t = config.tierCutoffs || {}
  if (!(t.S > t.A && t.A > t.B && t.B > t.C)) warnings.push('tierCutoffs not monotonic (S>A>B>C)')
  return { errors, warnings }
}

// 로더: config JSON을 읽고 검증. hard error 시 throw.
export async function loadScoringConfig(readJson, registry) {
  const config = await readJson('scoring-config.json', null)
  if (!config) throw new Error('scoring-config.json missing')
  const { errors, warnings } = validateConfig(config, registry)
  if (errors.length) throw new Error('scoring-config invalid: ' + errors.join('; '))
  for (const w of warnings) console.warn('[scoring-config]', w)
  return config
}
