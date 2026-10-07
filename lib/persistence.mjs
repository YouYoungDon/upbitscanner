// 직전 스캔 이력 → 지속성 점수. priorScans: 오름차순(과거→최신) entry 배열.
// 각 entry는 { timestamp, buy: [{ market, signals }] }.
//
// 단위는 "스캔"이 아니라 "확정 일봉(UTC 일)"이다. 모니터는 하루 8회 돌지만 신호는 확정봉으로만
// 판정하므로 같은 UTC 일의 스캔은 전부 같은 봉을 본다. 예전엔 스캔 수를 셌기 때문에 같은 날 세 번째
// 스캔이면 데이터가 하나도 새롭지 않은데도 "3회 연속 +2"가 자동으로 붙었다(리뷰 2026-10-07).
// 이제 같은 날(=같은 봉)의 스캔은 하나로 접고, 이번 스캔과 같은 날은 제외한다.
import { utcDay } from './datetime.mjs'

// UTC 일별 마지막 스캔만 남긴 오름차순 배열. nowMs가 속한 일(=이번 스캔과 같은 봉)은 제외.
// timestamp가 없거나 파싱 불가한 스캔은 버린다(일 판정 불가).
export function dailySnapshots(priorScans = [], nowMs = Date.now()) {
  const today = Math.floor(nowMs / 86400000)
  const byDay = new Map()
  for (const s of priorScans) {
    const d = utcDay(s?.timestamp)
    if (!Number.isFinite(d) || d >= today) continue
    byDay.set(d, s) // 오름차순 입력이므로 마지막 대입 = 그 날의 마지막 스캔
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, scan]) => ({ day, scan }))
}

const inBuy = (scan, market) => (scan?.buy || []).some((b) => b.market === market)

// 어제부터 거꾸로, 하루도 빠짐없이 매수권에 있던 일수. 스캔이 없던 날(스케줄러 공백)도 끊김으로 본다.
export function appearanceStreak(market, priorScans = [], nowMs = Date.now()) {
  const snaps = dailySnapshots(priorScans, nowMs)
  let streak = 0
  let expect = Math.floor(nowMs / 86400000) - 1
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].day !== expect || !inBuy(snaps[i].scan, market)) break
    streak++
    expect--
  }
  return streak
}

// 어제 봉(마지막 스냅샷이 어제일 때만)에서 거래량 급증이 있었는지.
function priorHadVolumeSurge(market, priorScans, nowMs) {
  const snaps = dailySnapshots(priorScans, nowMs)
  const last = snaps.at(-1)
  if (!last || last.day !== Math.floor(nowMs / 86400000) - 1) return false
  const item = (last.scan.buy || []).find((b) => b.market === market)
  return item ? (item.signals || []).some((s) => s.startsWith('거래량 급증')) : false
}

export function scorePersistence({ market, hasVolumeSurge }, priorScans = [], nowMs = Date.now()) {
  const signals = []
  let bonus = 0
  const streak = appearanceStreak(market, priorScans, nowMs)
  if (streak >= 3) { bonus += 2; signals.push('🔥지속 매수권 (3일+)') }
  else if (streak >= 2) { bonus += 1; signals.push('지속 매수권 (2일)') }

  const priorVol = priorHadVolumeSurge(market, priorScans, nowMs)
  if (hasVolumeSurge && priorVol) { bonus += 1; signals.push('거래량 지속') }
  else if (!hasVolumeSurge && priorVol) { signals.push('⚠️거래량 소멸 (1회성)') }

  return { bonus, signals }
}
