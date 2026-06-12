# 업비트 스캐너 대시보드 설계 문서

> 작성일: 2026-06-12
> 범위: 로컬 웹 대시보드 + 캔들스틱 패턴 분석 모듈
> 플랫폼: Windows, zero-dep Node ESM (기존 스캐너 위에 얹음)

---

## 1. 목적

기존 스캐너(스크립트 + JSON 데이터)를 시각화하는 **로컬 웹 대시보드**를 만든다.
- 매수/매도 추천 종목 열람
- 현재 가장 강한 신호 / 적중률 높은 신호 인사이트
- 수동 스캔 트리거 (비동기 + 진행률)
- 개별 종목 분석 (지표 + 캔들 차트 + 캔들스틱 패턴)
- 신호 적중률 검증 (시간별 적중률 + 가중치 현황)

추가로 **일본식 캔들스틱 패턴 감지 모듈**(`lib/candle-patterns.mjs`)을 신설하여
개별 분석에 표시하고 스캔 점수에도 소폭 반영한다.

## 2. 기술 결정 (확정)

| 항목 | 결정 |
|------|------|
| 아키텍처 | zero-dep Node 내장 `http` 서버 + 바닐라 JS 프론트 |
| 차트 | CDN의 lightweight-charts (캔들/라인/볼륨) |
| 인증 | 없음 — `127.0.0.1` 바인딩 (localhost 전용) |
| 레이아웃 | 사이드바 탭형 (B안): 대시보드 / 추천 / 개별분석 / 신호검증 |
| 수동 스캔 | 비동기 작업 + 진행률 폴링 |
| 캔들 패턴 점수 | 개별분석 표시 + 스캔 점수 반영 (작은 가중치, EWM 자동 조정) |

## 3. 비범위 (YAGNI)

- 인증/사용자 관리, 외부 배포, 모바일 앱
- 실거래 주문 (공개 API만)
- Next.js / React / 빌드 툴체인

## 4. 아키텍처

```
┌─ 브라우저 (바닐라 JS SPA, 사이드바 탭) ─┐
│  fetch → /api/*      차트 ← lightweight-charts(CDN)
└──────────────┬──────────────────────────┘
               │ HTTP (127.0.0.1:8787)
┌──────────────┴──────────────────────────┐
│  server.mjs (zero-dep http)             │
│   - 정적 파일 서빙 (public/)            │
│   - JSON API (data/*.json 읽기)         │
│   - 스캔 작업 큐 (monitor.mjs 자식 실행)│
│   - 개별 분석 (lib 직접 호출)           │
└──────────────┬──────────────────────────┘
        기존 lib/*.mjs + scripts/*.mjs + data/*.json
```

서버는 기존 `lib/` 순수 함수를 직접 import해서 개별 분석을 수행하고,
전체 스캔은 `scripts/monitor.mjs`를 **자식 프로세스**로 실행한다(기존 로직 재사용).

## 5. 디렉토리 구조 (추가분)

```
upbit-dashboard/
├── lib/
│   └── candle-patterns.mjs   # 신규: 일본식 캔들스틱 패턴 감지
├── server/
│   ├── server.mjs            # http 서버 + 라우팅
│   ├── api.mjs               # API 핸들러 (results/insights/analyze/verify/scan)
│   └── scan-job.mjs          # 비동기 스캔 작업 상태 관리
├── public/
│   ├── index.html            # 사이드바 탭 셸
│   ├── app.js                # 라우팅 + fetch + 렌더링
│   ├── charts.js             # lightweight-charts 래퍼
│   └── styles.css            # 다크 테마
└── __tests__/
    └── candle-patterns.test.mjs
```

## 6. 캔들스틱 패턴 모듈 (`lib/candle-patterns.mjs`)

순수 함수. 입력 `ohlcv`(과거→최신), 최근 1~3봉 기준 감지.

`detectCandlePatterns(ohlcv)` → `{ bullish: string[], bearish: string[], neutral: string[] }`

| 분류 | 패턴 | 정의 (요약) |
|------|------|-------------|
| 강세 | 망치형 Hammer | 아래꼬리 ≥ 몸통×2, 위꼬리 작음, 하락추세 끝 |
| 강세 | 역망치 Inverted Hammer | 위꼬리 ≥ 몸통×2, 아래꼬리 작음, 하락추세 끝 |
| 강세 | 상승장악형 Bullish Engulfing | 직전 음봉을 현재 양봉이 완전히 감쌈 |
| 강세 | 샛별 Morning Star | 음봉 → 작은 몸통 → 양봉 3봉 |
| 강세 | 관통형 Piercing | 음봉 다음 양봉이 직전 몸통 50% 이상 회복 |
| 약세 | 교수형 Hanging Man | 망치형 모양 + 상승추세 끝 |
| 약세 | 유성형 Shooting Star | 역망치 모양 + 상승추세 끝 |
| 약세 | 하락장악형 Bearish Engulfing | 직전 양봉을 현재 음봉이 완전히 감쌈 |
| 약세 | 석별 Evening Star | 양봉 → 작은 몸통 → 음봉 3봉 |
| 약세 | 흑운형 Dark Cloud | 양봉 다음 음봉이 직전 몸통 50% 이상 잠식 |
| 중립 | 도지 Doji | 몸통 ≤ 전체범위×0.1 |
| 중립 | 팽이형 Spinning Top | 작은 몸통 + 양쪽 긴 꼬리 |

**점수 반영 (scan):** `lib/signals.mjs` `PATTERN_SCORE`/`SIGNAL_KEYS`에 캔들 패턴 추가.
강세=매수 +2, 약세=매도 +2 (초기 가중치 1.0). 추세 컨텍스트(직전 5봉 방향)로
망치형/교수형 등 형태가 같은 패턴을 구분한다.
EWM 주간 학습이 적중률에 따라 자동 가감한다.

## 7. API 명세

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/api/results` | GET | 최신 스캔의 매수/매도 전체 + KPI (monitor-log.json) |
| `/api/insights` | GET | 오늘 최다 신호 / 적중률 1위 신호 (집계) |
| `/api/analyze?market=KRW-XXX&tf=day` | GET | 개별 분석: 지표 + 신호 + 캔들패턴 + 캔들 데이터 |
| `/api/verify` | GET | 신호별 적중률 + 시간별(+1/+3/+7) + 주간 이력 (weekly-analysis.json) |
| `/api/weights` | GET | 현재 가중치 (signal-weights.json) |
| `/api/scan` | POST | 스캔 작업 시작 → `{ jobId }` |
| `/api/scan/:jobId` | GET | 작업 상태 `{ status, progress, startedAt, finishedAt }` |

모든 응답 JSON. 읽기 API는 파일 mtime 기반, 변동 없으면 그대로 반환.

## 8. 비동기 스캔 작업 (`server/scan-job.mjs`)

- POST `/api/scan` → `monitor.mjs`를 `child_process.spawn`으로 실행, `jobId` 발급
- 메모리 내 작업 맵에 `{ status: running|done|error, progress, startedAt, finishedAt }`
- `monitor.mjs`가 stdout으로 진행 로그(`스캔 대상 N`, `스캔 #M 완료`)를 내므로 파싱해 progress 갱신
- 프론트는 1.5초 간격으로 `/api/scan/:jobId` 폴링 → 완료 시 결과 자동 새로고침
- 동시 실행 1개 제한 (이미 running이면 기존 jobId 반환)

## 9. 프론트엔드 (`public/`)

**탭 셸 (index.html + app.js):** 좌측 사이드바 4탭, 해시 라우팅(`#/dashboard` 등).

- **대시보드:** KPI 4종(매수/매도/누적스캔/전체적중률) + 매수·매도 TOP5(콤보 태그) +
  신호 인사이트 2카드 + [수동 스캔] 버튼(진행률 바)
- **추천:** 매수/매도 토글 + 검색 + 점수 정렬 + 콤보 필터 + 전체 테이블(행 클릭 → 개별분석)
- **개별 분석:** 종목 검색 → 타임프레임(일/4h/1h) · 차트종류(캔들/라인) · 거래량 토글,
  캔들 차트(EMA20/50·BB 오버레이) + 지표 패널 + 🕯️ 캔들 모양분석 패널 + 종합 점수
- **신호 검증:** 신호별 적중률 바 + 시간별 적중률(+1/+3/+7) + 가중치 현황 표 + 주간 추이

**charts.js:** lightweight-charts 래퍼 — `renderCandles(el, ohlcv, {ema, bb, volume})`,
`renderLine(el, closes)`.

## 10. 에러 처리

- API: 데이터 파일 없음 → 200 + 빈 구조(`{ buy:[], sell:[] }`)와 `empty:true`
- 개별 분석: 잘못된 마켓 → 400 `{ error }`, 프론트는 토스트
- 스캔 작업 실패 → status `error` + 메시지, 프론트 표시
- 차트 CDN 로드 실패 → 라인 폴백(텍스트 종가)

## 11. 테스트 전략

- `lib/candle-patterns.mjs`: 합성 캔들로 각 패턴 발화 검증 (망치형/장악형/도지/샛별 등) — Vitest
- API 핸들러: data 픽스처로 results/insights/verify 형태 검증
- 스캔 작업: spawn 모킹으로 상태 전이(running→done) 검증
- 기존 34개 테스트 회귀 유지

## 12. 실행

```bash
npm run dashboard      # node server/server.mjs → http://127.0.0.1:8787
```

작업 스케줄러의 자동 스캔(09/21시)은 그대로 동작하고, 대시보드는 그 결과 파일을 읽는다.
대시보드 서버는 수동 실행(상시 띄워두거나 필요할 때 실행).
