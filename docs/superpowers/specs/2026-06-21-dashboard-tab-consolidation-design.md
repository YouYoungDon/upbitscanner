# 대시보드 탭 통합 설계 (8탭 → 3탭)

**작성일:** 2026-06-21

**목표:** 정보가 겹치는 8개 탭을 3개로 통합해 "한눈에" 보이게 한다. 특히 세 스캐너
(반등·모멘텀·자금유입)의 매수 후보를 한 화면에 나란히 보여준다.

**범위:** 프론트엔드만(`public/index.html`, `public/app.js`). 백엔드·lib 무변경 —
기존 API 전부 재사용. 정보 손실 없이 재배치만 한다.

---

## 현재 → 목표

| 현재 8탭 | 목표 3탭 |
|----------|----------|
| 📊 대시보드 · 🟢 추천 · 🚀 모멘텀 · 💸 자금유입 · 💼 포지션 | 🏠 **종합**(`#/home`) |
| 🔍 개별분석 | 🔍 **개별분석**(`#/analyze`) — 변경 없음 |
| ✅ 신호검증 · 📜 스캔기록 | 📊 **기록·검증**(`#/review`) |

---

## 라우팅 (`public/app.js`)

현재 `router()`는 `hash.slice(2).split('?')[0]`로 이름을 뽑아 `routes[name] || routes.dashboard`를 호출한다. `app.js`는 **classic script**(`<script src="/app.js">`, module 아님)라 직접 `export`/`import` 불가. 따라서 별칭 매핑 순수 함수를 **`public/routes.js`(ESM 모듈)**로 분리하고, 브라우저엔 전역으로도 노출한다.

`public/routes.js` (신규):
```js
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
```

- `index.html`: app.js 로드 **이전에** `<script type="module" src="/routes.js"></script>` 추가. 모듈은 기본 defer라 DOMContentLoaded 전에 실행 → `router()`가 호출될 때 `window.resolveRoute` 준비됨. (서버는 `.js`를 JS MIME로 이미 서빙하므로 모듈 로드 OK.)
- `router()`: `const name = resolveRoute(hash.slice(2).split('?')[0]); routes[name]()` (전역 `resolveRoute` 호출).
- `routes` 객체: 기존 `dashboard/recommend/momentum/flow/positions/verify/history` 메서드 제거, `home()`·`review()` 신규. `analyze()` 유지.
- runScan 완료 콜백의 `routes.dashboard()` → `routes.home()`로 교체(현재 app.js 478행 부근).
- 테스트는 `import { resolveRoute } from '../public/routes.js'`로 검증(package.json `"type":"module"`이라 `.js`도 ESM).

## 사이드바 (`public/index.html`)

8개 `<li>` → 3개:
```html
<li><a href="#/home" data-tab="home">🏠 종합</a></li>
<li><a href="#/analyze" data-tab="analyze">🔍 개별분석</a></li>
<li><a href="#/review" data-tab="review">📊 기록·검증</a></li>
```

---

## 🏠 종합 (`home()`)

여러 엔드포인트를 **병렬**(`Promise.all`)로 호출해 한 화면 조립:
`/api/results`(반등+레짐), `/api/momentum`, `/api/flow`, `/api/positions`.

레이아웃(넓은 화면, Tailwind `lg:grid-cols-3`; 좁으면 세로 스택):
```
[ 시장 컨텍스트바: BTC레짐 · 시장심리 · 마지막스캔 시각 ]      (1줄)
[ 💼 포지션 요약: 보유종목 손익·SL (보유 있을 때만) ]
┌── 🟢 반등 TOP8 ──┬── 🚀 모멘텀 TOP8 ──┬── 💸 자금유입 TOP8 ──┐
│ 종목·점수·신호뱃지 │ 종목·점수·그룹    │ 레벨이모지·점수·머니비율│
│ ⚠️저유동성 N개 ▼  │                   │                      │
│ 매도신호 ▼        │                   │                      │
└──────────────────┴───────────────────┴──────────────────────┘
```

세부:
- **컨텍스트바**: results의 `regime`(레짐 라벨/이모지) + 각 스캔 timestamp(반등·자금유입). 모멘텀 timestamp 포함.
- **포지션**: positions API 결과를 컴팩트 행으로(종목·plPct·SL거리/hitSL ⚠️). 빈 배열이면 섹션 숨김.
- **반등 카드**: `res.buy`(메인) 상위 8 — 종목·점수·`signalTags`. 하단 `<details>`로 저유동성(`res.buyLowLiq`)·매도(`res.sell` 상위 8) 접기.
- **모멘텀 카드**: `momentum.picks` 상위 8 — 종목·점수·그룹 신호.
- **자금유입 카드**: `flow.picks` 상위 8 — 레벨 이모지·종목·점수·머니비율(기존 flow 렌더 재사용).
- 각 행 클릭 → `#/analyze?market=...` (기존 패턴).
- 빈 데이터 카드는 "스캔 대기/기록 없음" 안내.
- **수동 스캔 버튼**(기존 대시보드의 `runScan`)은 컨텍스트바 옆에 유지. 완료 시 `routes.home()` 재렌더.

기존 대시보드의 **콤보분포·캔들요약·스캔추이 스파크라인**은 홈에서 제거 → 기록·검증 탭으로 이동.

---

## 📊 기록·검증 (`review()`)

상단 세그먼트 토글(추천 탭의 매수/매도 토글 패턴):
```
[ 📈 검증 ] [ 📜 기록 ]
```
- **검증 뷰**: 기존 `verify()` 렌더(전체·시간별 적중률, 신호별 적중률/가중치, 주간 리포트, 모멘텀 검증) + 홈에서 이동한 **콤보분포·캔들요약·스파크라인**(`/api/results`·`/api/history`에서 조립).
- **기록 뷰**: 기존 `history()` 렌더(아카이브 날짜별 드릴다운 + 종목별 등장 이력) 그대로.
- `review()`는 토글 상태(`let sub = 'verify'`)에 따라 두 렌더 함수를 호출. 기존 verify/history 렌더 로직을 내부 함수로 보존·재사용.

---

## 정보 보존 확인 (손실 없음)

| 기존 위치 | 새 위치 |
|-----------|---------|
| 대시보드 KPI/레짐 | 홈 컨텍스트바 |
| 대시보드 매수/매도 TOP10 | 홈 반등 카드(매수) + 매도 접기 |
| 콤보분포·캔들요약·스파크라인 | 기록·검증 → 검증 뷰 |
| 추천 매수/매도·저유동성 | 홈 반등 카드 + 접기 |
| 모멘텀 | 홈 모멘텀 카드 |
| 자금유입 | 홈 자금유입 카드 |
| 포지션 | 홈 포지션 요약 |
| 신호검증 | 기록·검증 → 검증 뷰 |
| 스캔기록 | 기록·검증 → 기록 뷰 |
| 개별분석 | 그대로 |

---

## 테스트

- `__tests__/routes.test.mjs`(신규): `public/routes.js`의 `resolveRoute` — 별칭(dashboard/recommend/momentum/flow/positions→home; verify/history→review), 정식(home/analyze/review 그대로), 미지(→home).
- 브라우저 렌더(home/review)는 단위테스트 대상 아님 → `node -c public/app.js` 구문체크 + 대시보드 육안확인(홈 3열 카드·포지션·기록 토글).
- 기존 170 테스트 회귀 유지(백엔드 무변경).

## 대상 파일

- 수정: `public/index.html`(사이드바 3탭 + routes.js 모듈 로드), `public/app.js`(routes 재구성·home·review·router·runScan 콜백)
- 신규: `public/routes.js`(resolveRoute), `__tests__/routes.test.mjs`
- 무변경: server/·lib/

## 범위 밖

- 백엔드 API 변경, 새 지표/스캐너, 차트 라이브러리 교체. 순수 정보구조 재배치만.
