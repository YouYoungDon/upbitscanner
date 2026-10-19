// 회사 스캐너(2026-10-17 작업)의 매수 신호 5종을 재생 측정용으로 옮긴 판정기 — 연구 전용, 라이브 미사용.
// 회사 쪽 정의는 한 줄 설명뿐이라 애매한 곳은 아래처럼 해석했다(해석이 결과를 좌우하면 바꿔서 다시 잰다).
// w: 확정 일봉 창(오래된→최신) [{open, high, low, close, volume}]. 각 함수는 그 창의 마지막 봉에서 신호가 "켜졌는지".
import { calcOBV, calcRSISeries } from '../../../lib/indicators.mjs'

// 회사 점수(그대로 옮긴 참고값 — 측정 대상이지 채택값이 아니다)
export const COMPANY_POINTS = { obvDiv: 4, rsiDiv: 4, wBottom: 5, baseBuild: 3, volClimax: 3 }

// OBV 매집 다이버전스 — "가격 횡보·하락인데 OBV 5% 이상 상승".
// 해석: 최근 20봉 종가 변화 ≤ +1%(횡보·하락), OBV 변화량 ≥ 그 20봉 거래량 합의 5%.
// (OBV 절대값은 시작점에 따라 0 근처일 수 있어 % 변화가 불안정 → 구간 거래량으로 정규화)
export function obvDivergence(w, { look = 20, maxPx = 0.01, minObv = 0.05 } = {}) {
  const n = w.length
  if (n < look + 1) return false
  const closes = w.map((c) => c.close), vols = w.map((c) => c.volume)
  const obv = calcOBV(closes, vols)
  const px = closes[n - 1] / closes[n - 1 - look] - 1
  let vsum = 0
  for (let i = n - look; i < n; i++) vsum += vols[i]
  return px <= maxPx && vsum > 0 && (obv[n - 1] - obv[n - 1 - look]) / vsum >= minObv
}

// RSI 강세 다이버전스 — "가격 저점 낮아짐 + RSI 저점 높아짐 (45 이하)".
// 해석: 최근 40봉에서 좌우 3봉 기준 로컬 저점 두 개(마지막 저점은 10봉 이내), 가격은 더 낮고 RSI는 3p 이상 높고,
// 마지막 저점의 RSI ≤ 45. 오래된 다이버전스로 지금 사지 않게 최근성 조건을 둔다.
export function rsiBullDivergence(w, { look = 40, win = 3, recent = 10, minGap = 3, maxRsi = 45 } = {}) {
  const n = w.length
  if (n < look + 15) return false
  const closes = w.map((c) => c.close)
  const rsi = calcRSISeries(closes, 14)
  const troughs = []
  for (let i = Math.max(win, n - look); i < n - win; i++) {
    const seg = closes.slice(i - win, i + win + 1)
    if (closes[i] === Math.min(...seg) && closes[i] < closes[i - 1]) troughs.push(i) // 같은 값이 이어지면 첫 봉만
  }
  if (troughs.length < 2) return false
  const [a, b] = troughs.slice(-2)
  if (n - 1 - b > recent || rsi[a] == null || rsi[b] == null) return false
  return closes[b] < closes[a] && rsi[b] > rsi[a] + minGap && rsi[b] <= maxRsi
}

// W-Bottom 쌍바닥 — "두 저점 3% 이내 + 네크라인 돌파".
// 해석: 최근 40봉 로컬 저점(좌우 3봉) 마지막 두 개가 5봉 이상 떨어져 있고 저가 차이 ≤ 3%,
// 네크라인 = 두 저점 사이 최고가, 오늘 종가가 처음으로 네크라인 위(어제 종가는 아래).
export function wBottom(w, { look = 40, win = 3, tol = 0.03, minSep = 5 } = {}) {
  const n = w.length
  if (n < look + 2) return false
  const lows = w.map((c) => c.low)
  const troughs = []
  for (let i = Math.max(win, n - look); i < n - win; i++) {
    const seg = lows.slice(i - win, i + win + 1)
    if (lows[i] === Math.min(...seg) && lows[i] < lows[i - 1]) troughs.push(i) // 평평한 바닥(호가 단위 큰 저가 코인)은 첫 봉만
  }
  if (troughs.length < 2) return false
  const [a, b] = troughs.slice(-2)
  if (b - a < minSep || Math.abs(lows[b] / lows[a] - 1) > tol) return false
  let neck = -Infinity
  for (let i = a + 1; i < b; i++) neck = Math.max(neck, w[i].high)
  return w[n - 1].close > neck && w[n - 2].close <= neck
}

// 밑바닥 다지기 — "범위 8% 이내 횡보 + 거래량 수축 → 회복".
// 해석: 어제까지 15봉의 고저 범위 ≤ 8%, 그 15봉 평균 거래량 ≤ 직전 15봉 평균 × 0.7(수축),
// 오늘 거래량 ≥ 기반 평균 × 1.5 이고 양봉(회복).
export function baseBuilding(w, { base = 15, range = 0.08, shrink = 0.7, revive = 1.5 } = {}) {
  const n = w.length
  if (n < base * 2 + 1) return false
  const seg = w.slice(n - 1 - base, n - 1), prev = w.slice(n - 1 - base * 2, n - 1 - base)
  const hi = Math.max(...seg.map((c) => c.high)), lo = Math.min(...seg.map((c) => c.low))
  const avg = (a) => a.reduce((s, c) => s + c.volume, 0) / a.length
  const today = w[n - 1]
  return lo > 0 && hi / lo - 1 <= range && avg(seg) <= avg(prev) * shrink &&
    today.volume >= avg(seg) * revive && today.close > today.open
}

// 거래량 클라이맥스 반등 — "거래량 400%+ 하락봉 후 3%+ 반등".
// 해석: 최근 5봉(오늘 제외) 안에 거래량 ≥ 직전 20봉 평균 × 4 인 음봉이 있고, 오늘 종가 ≥ 그 봉 종가 × 1.03.
export function volumeClimax(w, { within = 5, avgN = 20, mult = 4, bounce = 0.03 } = {}) {
  const n = w.length
  if (n < avgN + within + 1) return false
  for (let k = n - 1 - within; k < n - 1; k++) {
    const c = w[k]
    if (!(c.close < c.open)) continue
    let s = 0
    for (let i = k - avgN; i < k; i++) s += w[i].volume
    if (c.volume >= (s / avgN) * mult && w[n - 1].close >= c.close * (1 + bounce)) return true
  }
  return false
}

export const DETECTORS = { obvDiv: obvDivergence, rsiDiv: rsiBullDivergence, wBottom, baseBuild: baseBuilding, volClimax: volumeClimax }
