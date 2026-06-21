// 자금유입 알림 중복 억제. state: { [market]: { lastScore, lastAlertTs } }.
export function shouldAlert({ market, score, now }, state = {}, cfg) {
  const prev = state[market]
  if (!prev) return true
  if (now - prev.lastAlertTs >= cfg.suppressMs) return true
  if (score >= prev.lastScore * cfg.reAlertRatio) return true
  return false
}

export function updateAlertState(state = {}, market, score, now) {
  return { ...state, [market]: { lastScore: score, lastAlertTs: now } }
}
