# 대시보드 UI 리뉴얼 (Tailwind + DaisyUI) 설계 문서

> 작성일: 2026-06-14
> 범위: 웹 대시보드 프론트 리스타일 + 대시보드 정보 확장
> 플랫폼: 기존 zero-dep Node http 서버 위 (빌드 도구 없음, CDN)

---

## 1. 목적

현재 대시보드가 "보기 힘들다"는 피드백을 받아, **Tailwind CSS + DaisyUI**(CDN)로
전체 UI를 보기 좋고 정보가 눈에 잘 들어오게 리스타일한다. 대시보드 탭에는
정보를 더 추가한다(콤보 분포, 캔들 모양 요약, 스캔 추이, TOP 10).

기능 로직(스캔/분석/검증/API)은 그대로 두고, **프론트 마크업/스타일과 일부
집계 표시만** 바꾼다. 백엔드는 미니차트용 엔드포인트 1개만 추가한다.

## 2. 기술 결정 (확정)

| 항목 | 결정 |
|------|------|
| CSS 프레임워크 | Tailwind CSS (Play CDN) + DaisyUI (CDN CSS) |
| 빌드 | 없음 — `index.html`에 CDN 태그만 추가 (zero-dep 유지) |
| 테마 | DaisyUI `business` (`<html data-theme="business">`) |
| 차트 | 기존 lightweight-charts 유지. 미니 추이는 경량 SVG 스파크라인 |

## 3. 비범위 (YAGNI)

- 빌드 툴체인(PostCSS/Tailwind CLI), npm 의존성 추가
- 라이트/다크 테마 토글
- 차트 라이브러리 교체, 신규 페이지

## 4. CDN 통합

`public/index.html` `<head>`에 추가:
```html
<link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
<script src="https://cdn.tailwindcss.com"></script>
```
`<html lang="ko" data-theme="business">`.

`public/styles.css`는 DaisyUI/Tailwind와 충돌하는 커스텀 규칙을 제거하고,
다음 오버라이드만 남긴다:
- `#chart { height: 300px; }`
- `.coinlist { max-height: 460px; overflow-y: auto; }` (+ coin-row hover/active)
- 스파크라인 SVG 관련 최소 스타일

전역 `body { display:flex }` 레이아웃은 DaisyUI 컴포넌트와 맞게 조정한다.

## 5. 레이아웃 (DaisyUI 컴포넌트 매핑)

| 영역 | 컴포넌트 |
|------|----------|
| 사이드바 네비 | `menu` (수직), 활성 탭 `menu-active` |
| KPI | `stats` / `stat` (`stat-title`/`stat-value`/`stat-desc`) |
| 패널 | `card bg-base-200` + `card-body` |
| 테이블 | `table table-zebra table-sm` |
| 신호 태그 | `badge`: GC=`badge-success`, DC/함정=`badge-error`, MTF=`badge-info`, 거래량=`badge-warning` |
| 버튼/입력 | `btn btn-primary`, `input input-bordered` |
| 진행률 | `progress progress-primary` |
| 로딩 | `loading loading-spinner` |
| 세그먼트(일/4h/캔들) | `join` + `btn btn-sm`, 활성 `btn-active` |

전체 레이아웃: 좌측 고정 사이드바(`w-56 bg-base-200`) + 우측 `main`(`flex-1 p-6`).

## 6. 대시보드 탭 정보 확장

`/api/results`(현 스캔 buy/sell+signals) + `/api/insights` + 신규 `/api/history`를 사용.

1. **KPI stats**: 매수 / 매도 / 누적스캔 / 전체적중률 / 오늘 최다신호 / 적중률1위
2. **콤보 분포 카드**: 현 스캔 매수 종목의 신호 태그 집계 —
   반등확인(`[콤보] 반등확인`) / 과매도함정(`[콤보] 과매도 함정`) /
   거래량확인(`[콤보] 거래량확인`) / MTF(`[MTF]`) 각 종목 수를 badge/미니바로 표시
3. **캔들 모양 요약 카드**: 매수 신호에 `캔들 강세형` 포함 종목 수,
   매도 신호에 `캔들 약세형` 포함 종목 수 + 라벨에서 대표 패턴명 상위 추출
4. **스캔 추이 카드**: `/api/history`의 최근(최대 14) 스캔 매수/매도 개수를
   2개의 SVG 스파크라인(매수=초록, 매도=빨강)으로 표시
5. **매수 TOP 10 / 매도 TOP 10**: 기존 5 → 10, 각 행에 점수 badge + 현재가 + 신호 badge,
   행 클릭 시 개별분석으로 이동

**집계는 서버에서 계산한다.** 콤보 분포(2)와 캔들 모양 요약(3)은 `server/api.mjs`의
순수 함수 `comboDistribution(buyList)` / `candleSummary(scan)`로 구현하고,
`buildResults`가 응답에 `comboDist` / `candleSummary` 필드로 포함한다. 프론트는
값을 렌더링만 한다(브라우저·Node 모듈 혼용 회피, Vitest로 직접 검증 가능).

## 7. 백엔드 추가: `/api/history`

`server/api.mjs`에 `buildHistory(log, limit = 14)` 추가 (순수 함수):
```
입력: monitor-log.json, 출력: [{ timestamp, buyCount, sellCount }] (최근 limit개)
```
`server/server.mjs`에 라우트 `GET /api/history` → `buildHistory(log)`.

## 8. 다른 탭 리스타일

- **추천**: 매수/매도 토글 → `join` 버튼, 검색 `input-bordered`, 테이블 `table-zebra`, 신호 badge
- **개별분석**: 코인 리스트/검색/세그먼트/카드 모두 DaisyUI, 캔들 패턴 badge
- **신호검증**: KPI `stats`, 적중률 바 `progress`, 신호표 `table-zebra`

로직(이벤트 핸들러, fetch, 차트 호출)은 유지하고 **마크업 클래스만** 교체한다.

## 9. 에러 처리

- CDN(Tailwind/DaisyUI) 로드 실패 시: 스타일만 빠지고 기능은 동작(점진적 저하).
- `/api/history` 데이터 없음 → 빈 배열 → 스파크라인 "데이터 없음" 표시.
- 기존 API 에러 처리(`api()`의 `r.ok` 가드, 탭별 try/catch)는 유지.

## 10. 테스트 전략

- `server/api.mjs`: `comboDistribution`, `candleSummary`, `buildHistory` 순수 함수 —
  Vitest로 합성 스캔/로그 입력 검증. `buildResults`가 `comboDist`/`candleSummary` 포함하는지 확인.
- 기존 50개 테스트 회귀 유지.
- 프론트 시각 자체는 서버 기동 + 브라우저 확인(헤드리스 불가하므로 수동).

## 11. 파일 변경 요약

```
public/index.html   # CDN 태그 + data-theme, 사이드바 menu 마크업
public/styles.css   # 커스텀 대거 제거, 오버라이드만
public/app.js       # 4탭 마크업 DaisyUI화 + 대시보드 패널 추가 + 스파크라인 렌더
public/charts.js    # (유지)
server/api.mjs      # comboDistribution/candleSummary/buildHistory + buildResults 확장
server/server.mjs   # /api/history 라우트
__tests__/api.test.mjs       # combo/candle/history 케이스 추가
```
