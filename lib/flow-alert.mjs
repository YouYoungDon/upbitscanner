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

const LEVEL_EMOJI = { strong: '🔴', attention: '🟠', watch: '🟡' }

// 텔레그램 대상 선정: **보유 종목**의 strong/attention 경보만(억제창 적용).
// 2026-10-07 재생(5분봉 166종목·61일): 현행 경보 뒤 24h 급락 확률이 기준의 11.4배(급등은 2.3배),
// 24h 초과수익 −2.81%p. 특징 14종 어느 분위도 초과수익이 양(+)이 아니었다 → 매수 신호로 쓰지 않는다.
// 보유 코인이 급변동 구간에 들어갔다는 리스크 정보로만 알린다.
export function selectFlowAlerts(picks = [], held = new Set(), state = {}, cfg, now) {
  return picks.filter((p) => held.has(p.market) &&
    (p.level === 'strong' || p.level === 'attention') &&
    shouldAlert({ market: p.market, score: p.score, now }, state, cfg))
}

export function formatFlowAlert(fire = [], when = '') {
  const lines = fire.map((p) => `${LEVEL_EMOJI[p.level] || ''} ${p.korean_name}(${p.market.replace('KRW-', '')}) · 거래대금 ${p.ratio}x${p.accel ? ` ·가속 ${p.accel}x` : ''}${p.breakout ? ' ·돌파' : ''}${p.domLabel ? ' ' + p.domLabel : ''}${p.event ? ' ' + p.event.label : ''}`)
  return `⚡급변동 경보 (보유 코인) · 매수 신호 아님 · ${when}\n\n${lines.join('\n')}\n\n※ 과거 재생상 이 경보 뒤에는 급등보다 급락이 더 잦았다. 손절선 점검용.`
}
