// 시장 기준선 — KRW 전 종목 동일가중 일간 수익. 픽 수익에서 시장 방향(베타)을 빼
// "코인을 잘 골랐는가"만 남기기 위한 비교 대상이다(2026-10-08 퀀트 QA: 원수익 승률은 시장 효과가 섞임).
import { DAY_SECONDS as DAY, utcDay } from './datetime.mjs'

const W = (v) => Math.max(-0.5, Math.min(0.5, v)) // 극단치(상장 직후·상폐 직전) 윈저라이즈
const dayOf = (c) => Math.floor(c.time / DAY)

// { market: ohlcv[] } → { day: 동일가중 평균 등락 }. 전날 봉이 있는 종목만 그날 평균에 넣고,
// 참여 종목이 minMarkets 미만인 날은 기록하지 않는다(소표본 날이 기준선을 흔들지 않게).
export function marketDailyReturns(ohlcvByMarket, { minMarkets = 20 } = {}) {
  const sum = new Map()
  for (const ohlcv of Object.values(ohlcvByMarket ?? {})) {
    const byDay = new Map((ohlcv ?? []).map((c) => [dayOf(c), c]))
    for (const [d, c] of byDay) {
      const p = byDay.get(d - 1)
      if (!p || !(p.close > 0) || !(c.close > 0)) continue
      const a = sum.get(d) ?? [0, 0]
      a[0] += W(c.close / p.close - 1)
      a[1]++
      sum.set(d, a)
    }
  }
  const out = {}
  for (const [d, [s, n]] of sum) if (n >= minMarkets) out[d] = s / n
  return out
}

// 저장분과 이번 계산분 병합 — 같은 날은 새 값(더 많은 종목이 확정된 값)으로.
export const mergeDailyReturns = (prev, fresh) => ({ ...(prev ?? {}), ...(fresh ?? {}) })

// D0 종가 → D0+n 종가 시장 수익(일간 동일가중 연쇄 복리). 하루라도 없으면 null.
export function baselineReturn(daily, d0, n) {
  let eq = 1
  for (let d = d0 + 1; d <= d0 + n; d++) {
    const r = daily?.[d]
    if (!Number.isFinite(r)) return null
    eq *= 1 + r
  }
  return eq - 1
}

// 픽 초과수익 exc1/3/7 = 픽의 D0 종가→D+n 종가 수익 − 같은 구간 시장 수익.
// 진입가(장중 현재가) 대신 D0 종가를 쓰는 건 시장 기준선과 같은 구간을 비교하기 위해서다 —
// 그래서 이 값은 "종목 선택력"이고, 진입 타이밍 효과는 ret1/3/7(원수익)에 남는다.
export function episodeExcess(ep, confirmed, daily) {
  const d0 = utcDay(ep.entryTs)
  const byDay = new Map((confirmed ?? []).map((c) => [dayOf(c), c]))
  const base = byDay.get(d0)
  const out = { exc1: null, exc3: null, exc7: null }
  if (!(base?.close > 0)) return out
  for (const n of [1, 3, 7]) {
    const t = byDay.get(d0 + n)
    const m = baselineReturn(daily, d0, n)
    if (t && m != null) out[`exc${n}`] = W(t.close / base.close - 1) - m
  }
  return out
}
