// 직전 스캔 이력 → 지속성 점수. priorScans: 오름차순(과거→최신) entry 배열.
// 각 entry는 { buy: [{ market, signals }] }.

export function appearanceStreak(market, priorScans = []) {
  let streak = 0
  for (let i = priorScans.length - 1; i >= 0; i--) {
    if ((priorScans[i].buy || []).some((b) => b.market === market)) streak++
    else break
  }
  return streak
}

function priorHadVolumeSurge(market, priorScans) {
  const last = priorScans[priorScans.length - 1]
  if (!last) return false
  const item = (last.buy || []).find((b) => b.market === market)
  return item ? (item.signals || []).some((s) => s.startsWith('거래량 급증')) : false
}

export function scorePersistence({ market, hasVolumeSurge }, priorScans = []) {
  const signals = []
  let bonus = 0
  const streak = appearanceStreak(market, priorScans)
  if (streak >= 3) { bonus += 2; signals.push('🔥지속 매수권 (3회+)') }
  else if (streak >= 2) { bonus += 1; signals.push('지속 매수권 (2회)') }

  const priorVol = priorHadVolumeSurge(market, priorScans)
  if (hasVolumeSurge && priorVol) { bonus += 1; signals.push('거래량 지속') }
  else if (!hasVolumeSurge && priorVol) { signals.push('⚠️거래량 소멸 (1회성)') }

  return { bonus, signals }
}
