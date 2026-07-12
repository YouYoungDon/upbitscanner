# 대시보드 일간/주간 추천 설계

날짜: 2026-07-12
상태: 승인 (사용자 전권 위임)

## 문제

종합 페이지 반등/모멘텀/자금 카드가 **최신 스캔 1개**만 보여줘서 3시간마다 픽이 통째로 바뀐다. 사용자가 "스캔때마다 너무 바뀌니까 일간/주간 누적으로 좋은 종목을 보고 싶다"고 요청.

## 해결

아카이브(scan-archive.jsonl) 누적 스캔을 윈도우로 집계해 **반복 등장 빈도 × 평균 점수**로 랭킹. 반복 등장이 많을수록(신뢰) + 점수가 높을수록 상위. 단발 고점수는 상위에 못 오르므로 안정적.

## 컴포넌트

### `lib/recommend.mjs` (신규, 순수 함수)

```
aggregateRecommendations(scans, { windowMs, now = Date.now() }) → 정렬 배열
```
- 윈도우(now - windowMs 이후) 스캔의 `buy` 배열만 집계 (저유동성 `lowLiquidity` 제외).
- 종목별: `appearances`(등장횟수), `avgScore`, `maxScore`, `lastSeen`, `lastSignals`, `dominance`/`cg`(마지막 값).
- `rankScore = appearances × avgScore` (소수 1자리).
- 정렬: rankScore 내림차순, 동점은 appearances 우선, 그다음 avgScore.
- 빈 배열·NaN·타임스탬프 파싱 실패 방어.

### `server/api.mjs`

```
buildRecommendations(scans, now = Date.now()) → { daily: top8, weekly: top8 }
```
- daily windowMs = 24h, weekly = 7일. 기존 `cachedArchive()` 재사용(파일 IO 0).

### 라우트 `/api/recommend` (server.mjs)

`sendJson(buildRecommendations(cachedArchive()))`.

### `public/app.js` 종합 페이지

반등/모멘텀/자금 카드 **위**에 2열 카드: 📅 오늘의 추천 / 📆 이번주 추천.
각 행: 종목명 + 등장횟수 배지(`5회`) + `avg N.N` + 코인게코 🌐배지(cgBadge 재사용). 클릭 → 개별분석.
데이터 부족 시 "누적 데이터 부족(스캔 N회)" 안내.

## 의도적 결정

- **monitor buy만 집계** (momentum/flow 아님): "반등 매수 추천"이 사용자 핵심 관심이고 스코프 단순. 확장은 다음 사이클.
- **최신 스캔이 아니라 윈도우 전체 집계** — 스캔마다 안 바뀌는 게 이 기능의 존재 이유.
- 기존 최신 스캔 카드(반등/모멘텀/자금)는 그대로 둠 — 추천은 그 위에 추가만.

## 테스트

- `aggregateRecommendations`: 윈도우 필터, 빈도가중 정렬, 동점 tiebreak, 저유동성 제외, 빈 입력, 잘못된 타임스탬프.
- `buildRecommendations`: daily/weekly 윈도우 분리, top8 절단.

## 에러 처리

아카이브 비면 `{ daily: [], weekly: [] }`. 어떤 집계 실패도 빈 배열 폴백 — 대시보드 무중단.
