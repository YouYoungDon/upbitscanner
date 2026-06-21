// 해시 라우트명 → 정식 라우트. 구 URL 호환 별칭 포함.
export function resolveRoute(name) {
  const alias = {
    dashboard: 'home', recommend: 'home', momentum: 'home', flow: 'home', positions: 'home',
    verify: 'review', history: 'review',
  }
  const canonical = ['home', 'analyze', 'review']
  const r = alias[name] || name
  return canonical.includes(r) ? r : 'home'
}
// 브라우저(classic app.js)에서 전역으로 사용. Node(테스트)에선 window 없음.
if (typeof window !== 'undefined') window.resolveRoute = resolveRoute
