// 보유 코인 국내 과열 경고 — 3시간 스캔마다 보유 코인의 BTC 대비 프리미엄을 보고, 과열이면 텔레그램.
// 같은 코인은 24시간에 한 번. state: { [market]: 마지막 알림 ms }.
import { splitPremiumHot } from './kimchi.mjs'

export const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000

export function selectPremiumAlerts(held, kimchi, state = {}, now) {
  const { hot } = splitPremiumHot(held ?? [], kimchi)
  const fires = hot
    .filter((h) => !(now - (state[h.market] ?? -Infinity) < ALERT_COOLDOWN_MS))
    .map((h) => ({ market: h.market, korean_name: h.korean_name ?? h.market.replace('KRW-', ''), premium: h.kimchi.premium, rel: h.kimchi.rel }))
  const next = { ...state }
  for (const f of fires) next[f.market] = now
  return { fires, state: next }
}

const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`

export function formatPremiumAlert(fires) {
  const lines = fires.map((f) => `• ${f.korean_name}(${f.market.replace('KRW-', '')}) 김치프 ${pct(f.premium)}% · BTC 대비 ${pct(f.rel)}%p`)
  return `🇰🇷 보유 코인 국내 과열\n${lines.join('\n')}\n\n과거 18개월: 이 조건의 코인은 이후 7일 시장 대비 −4~−6%p 부진했습니다. 익절·비중 축소 검토용 확률 정보이며 매도 신호는 아닙니다.`
}
