// 픽 성과 스코어카드 — 순수 로직.
// 에피소드: 직전 스캔 매수 리스트에 없던 마켓이 새로 등장한 순간의 스냅샷.
import { DAY_SECONDS as DAY, utcDay } from './datetime.mjs'
import { scoreStrategyOutcome } from './strategy.mjs'
import { episodeExcess } from './market-baseline.mjs'

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
        // 진입가 기준: 'live'=스캔 시점 현재가(2026-10-07~). 이전 픽은 확정 종가(최대 ~21h 전 가격)였다 —
        // 두 세대의 ret1/3/7은 의미가 달라 섞어 비교하면 안 된다.
        entryBasis: item.priceBasis ?? 'confirmed-close',
        score: item.score,
        signals: item.signals ?? [],
        lowLiquidity: !!item.lowLiquidity,
        exitParams: item.exit ?? null, // 픽 시점에 스탬핑된 청산 파라미터(없으면 백필 대상)
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

const HORIZONS = [1, 3, 7]
const NO_DATA_AFTER_DAYS = 10 // D+7 + 여유 3일

// 확정봉으로 에피소드를 채점. 입력은 불변, 새 객체 반환.
// confirmed: candlesToOhlcv → confirmedOhlcv 이후의 chronological 배열.
export function scoreEpisode(ep, confirmed, nowMs) {
  const out = { ...ep }
  const d0 = utcDay(ep.entryTs)
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

// 청산 규칙 성과 채점 — 기존 ret/mfe는 건드리지 않는 순수 추가.
// 파라미터 출처: 픽에 스탬핑된 exitParams(live) > 호출부가 넘긴 현재 설정(backfill).
// 소급 계산값과 라이브 확정값을 섞어 집계하면 안 되므로 cfgSource로 구분한다.
// ret 단위는 분수 — scoreStrategyOutcome의 규약을 그대로 따른다.
// 적용된 slPct/tpPct/holdMax를 결과에 함께 저장한다: cfgVersion만으로는 재선정 이후
// 세대를 구분할 수 없어(같은 'general-exit-v1' 라벨로 12/12/7 소급분과 신규 파라미터가
// 한 집계에 섞인다) 호출부가 소급분의 무효화를 판정할 근거가 사라진다.
export function scoreEpisodeExit(ep, confirmed, fallbackParams, nowMs) {
  const stamped = ep.exitParams
  const params = stamped ?? fallbackParams
  if (!params) return { ...ep }
  // 파라미터가 비수치면 조용히 틀린 수치가 나온다(실측 확인):
  //  · slPct/tpPct가 NaN·undefined → 임계가 NaN이라 SL/TP 비교가 전부 false →
  //    'time' + **유한한** ret(= D+holdMax 종가 수익). 즉 단순보유 수익이 "규칙 성과"로 집계된다.
  //    NaN이 아니기 때문에 summarizeTrades의 유한수 필터에도 걸리지 않는다 — 가장 나쁜 실패다.
  //  · holdMax가 NaN → 루프가 한 번도 돌지 않아 영구 'open'(절대 해소되지 않음).
  // 둘 다 "채점했다"는 외형을 갖추므로, 채점 자체를 건너뛰어 exit 필드를 만들지 않는다.
  if (![params.slPct, params.tpPct, params.holdMax].every((v) => Number.isFinite(v))) return { ...ep }
  const r = scoreStrategyOutcome(ep, confirmed, params, nowMs)
  return {
    ...ep,
    exit: {
      reason: r.reason,
      ret: r.ret ?? null,
      exitDay: r.exitDay ?? null,
      slPct: params.slPct,
      tpPct: params.tpPct,
      holdMax: params.holdMax,
      cfgVersion: params.cfgVersion ?? params.version ?? null,
      cfgSource: stamped ? 'live' : 'backfill',
    },
  }
}

// 시장 기준선 대비 초과수익(exc1/3/7) — 원수익 ret과 별개의 순수 추가 필드.
// 비어 있는 값만 채운다(한 번 확정된 값은 기준선이 갱신돼도 소급 변경하지 않음).
// 최종 상태(done/no-data)에서 셋 다 채워지면 excDone. 기준선 결손으로 비면 진입 후 30일까지
// 다음 배치에서 다시 시도하고, 그 뒤엔 포기(excDone)해 매일 재조회하지 않는다.
const EXC_RETRY_DAYS = 30
const FINAL = ['done', 'no-data']
export function applyExcess(ep, confirmed, daily, nowMs) {
  const x = episodeExcess(ep, confirmed, daily)
  const out = { ...ep }
  for (const k of ['exc1', 'exc3', 'exc7']) if (!Number.isFinite(out[k])) out[k] = x[k]
  const full = ['exc1', 'exc3', 'exc7'].every((k) => Number.isFinite(out[k]))
  const giveUp = Math.floor(nowMs / 1000 / DAY) > utcDay(ep.entryTs) + EXC_RETRY_DAYS
  if (FINAL.includes(out.status) && (full || giveUp)) out.excDone = true
  return out
}

// 채점 루프가 원래 건드리지 않는 최종 상태 에피소드 중 초과수익이 아직 미완료인 것.
export const needsExcess = (e) => FINAL.includes(e.status) && !e.excDone
