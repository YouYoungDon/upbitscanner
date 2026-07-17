// 픽 성과 스코어카드 — 순수 로직.
// 에피소드: 직전 스캔 매수 리스트에 없던 마켓이 새로 등장한 순간의 스냅샷.

export function extractEpisodes(scans) {
  const episodes = []
  let prev = new Set()
  for (const scan of scans) {
    const cur = new Set()
    for (const item of scan.buy ?? []) {
      cur.add(item.market)
      if (prev.has(item.market)) continue
      episodes.push({
        id: `${item.market}@${scan.timestamp}`,
        market: item.market,
        korean_name: item.korean_name,
        entryTs: scan.timestamp,
        entryPrice: item.price,
        score: item.score,
        signals: item.signals ?? [],
        lowLiquidity: !!item.lowLiquidity,
        ret1: null, ret3: null, ret7: null,
        mfe1: null, mfe3: null, mfe7: null,
        status: 'pending',
        scoredAt: null,
      })
    }
    prev = cur
  }
  return episodes
}

const DAY = 86400
const HORIZONS = [1, 3, 7]
const NO_DATA_AFTER_DAYS = 10 // D+7 + 여유 3일

// 확정봉으로 에피소드를 채점. 입력은 불변, 새 객체 반환.
// confirmed: candlesToOhlcv → confirmedOhlcv 이후의 chronological 배열.
export function scoreEpisode(ep, confirmed, nowMs) {
  const out = { ...ep }
  const d0 = Math.floor(Date.parse(ep.entryTs) / 1000 / DAY)
  const nowDay = Math.floor(nowMs / 1000 / DAY)
  const byDay = new Map((confirmed ?? []).map((c) => [Math.floor(c.time / DAY), c]))
  const invalid = !(ep.entryPrice > 0)
  let touched = false
  if (!invalid) {
    for (const n of HORIZONS) {
      if (out[`ret${n}`] != null) continue
      const target = byDay.get(d0 + n)
      if (!target) continue
      out[`ret${n}`] = target.close / ep.entryPrice - 1
      let hi = -Infinity
      for (let i = d0 + 1; i <= d0 + n; i++) {
        const c = byDay.get(i)
        if (c) hi = Math.max(hi, c.high)
      }
      out[`mfe${n}`] = hi > 0 ? hi / ep.entryPrice - 1 : null
      touched = true
    }
  }
  const scoredCount = HORIZONS.filter((n) => out[`ret${n}`] != null).length
  const expired = nowDay > d0 + NO_DATA_AFTER_DAYS
  if (invalid || (expired && scoredCount < HORIZONS.length)) out.status = 'no-data'
  else if (scoredCount === HORIZONS.length) out.status = 'done'
  else if (scoredCount > 0) out.status = 'partial'
  else out.status = 'pending'
  if (touched || out.status !== ep.status) out.scoredAt = new Date(nowMs).toISOString()
  return out
}

// 채점에 필요한 일봉 개수: 오늘 − D0 + 여유 3봉. clamp [10, 200] (업비트 cap).
export function neededCandleCount(oldestEntryMs, nowMs) {
  const days = Math.floor(nowMs / 1000 / DAY) - Math.floor(oldestEntryMs / 1000 / DAY)
  return Math.max(10, Math.min(200, days + 3))
}

// id 기준 병합: existing의 채점값 보존, fresh 신규분 추가, fresh에 없는 기존분도 유지.
export function mergeEpisodes(existing, fresh) {
  const byId = new Map((existing ?? []).map((e) => [e.id, e]))
  const merged = (fresh ?? []).map((f) => byId.get(f.id) ?? f)
  const freshIds = new Set((fresh ?? []).map((f) => f.id))
  for (const e of existing ?? []) if (!freshIds.has(e.id)) merged.push(e)
  return merged
}
