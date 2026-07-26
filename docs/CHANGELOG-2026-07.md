# 변경 이력 — 2026년 7월

베이스라인: `5914434` (모멘텀 스코어링 subsystem A shadow 출시) 이후 39커밋.
현재 HEAD `1fd81ac` (origin/master 동기화). 테스트 256 → 319개.

## 1. 코인게코 연동 — 업비트 단독 펌프 감지 (2026-07-04)

글로벌(코인게코) 24h 거래대금 대비 업비트 비중으로 국내 단독 점화를 감지해 경고 라벨 + 점수 감점.

- **감점 규칙** (`lib/scan-universe.mjs::upbitDominancePenalty`): 비중 ≥50% → ×0.9(⚠️업비트비중), ≥80% → ×0.8(⚠️업비트단독). 데이터 없으면 중립.
- **클라이언트** (`lib/coingecko.mjs`): Demo API, 키는 gitignore된 `data/coingecko-key.json`. all-or-null 페이지 계약, coins/list 전용 30s 타임아웃, 429 백오프 5s.
- **오케스트레이션** (`lib/cg-data.mjs::ensureCgData`): 심볼 매핑(7일 TTL) + 시세 캐시(150분 TTL). fetch는 락 밖(임계구역 ms 유지), 동시 승자 존중. 어떤 실패에도 `{byMarket:{}, coverage:0, reason}` 중립 반환 — 스캔 무중단.
- **연결**: monitor(xx:00)가 사이클당 1회 fetch 주체, momentum·flow는 캐시 읽기 전용. 아카이브에 `dominance`·`cg`(circRatio/ath/rank/7d/30d)·`cgCoverage`·`cgReason`·`cgFetchedAt` 저장.
- 설계·계획: `docs/superpowers/specs|plans/2026-07-04-coingecko-upbit-dominance-*.md`. 라이브 검증 완료(커버리지 98%, 첫날 블라스트 91%·디카르고 93% 감점 적중).

## 2. 스캐너 전체 감사 — 메카니컬 버그 8건 수정 (2026-07-04)

상세: `docs/audit/2026-07-04-scanner-audit.md` (fix 상태표 + 설계 백로그).

| 버그 | 수정 |
|------|------|
| `return r.json()` 파싱 reject가 재시도/catch 우회 → 스캔 사망 | `await r.json()` (upbit·cg) |
| fetch 타임아웃 부재(undici 300s) | AbortSignal 10s(upbit/cg)·5s(telegram 전 지점) |
| momentum/flow/weekly 읽기-수정-쓰기 락 부재 | monitor 패턴 withLock 적용 |
| appendScan 락 밖 → JSONL 인터리빙 | 락 블록 안으로 이동 |
| calcStochastic 최소 길이 오프바이원 | 가드 +1 |
| Telegram 전송 실패에도 알림 억제창 시작 | sendTelegram r.ok + 성공 시에만 상태 갱신 |
| trend-journal 비원자 쓰기 | temp+rename |

**미착수 백로그(설계 레벨)**: H1(monitor/momentum이 미확정 캔들로 신호 판정 = 시커 손절의 구조적 원인, 최우선), M3(무거래량 약신호 미차단), M2(부분 실패 관측), M7(+3일 고정 윈도우 가중치 학습), M5(아카이브 로테이션).

## 3. 대시보드 — 코인게코 배지 표시 (2026-07-04)

종합 페이지 종목명 옆 🌐 배지(비중 50/80% 색상 + 시총·유통·ATH 툴팁), 신호 태그에 ⚠️업비트단독/비중, KPI 줄에 커버리지 % + 장애 시 원인 배지. `buildResults`가 cg 필드 노출.

## 4. 대시보드 — 일간/주간 추천 (2026-07-12)

스캔마다 픽이 바뀌는 문제를 아카이브 누적 등장빈도로 안정화.

- `lib/recommend.mjs::aggregateRecommendations`: 윈도우(일간 24h/주간 7일) 내 매수 등장을 집계, `rankScore = 등장횟수 × 평균점수`로 랭킹. 저유동성 제외, 방어적(null·NaN·잘못된 timestamp).
- `/api/recommend` + 종합 페이지 상단 📅 오늘의 추천 / 📆 이번주 추천 2열 카드.
- 설계: `docs/superpowers/specs/2026-07-12-daily-weekly-recommendations-design.md`.

## 5. 대시보드 — 포지션 직접 편집 (2026-07-12)

보유 포지션을 대시보드에서 직접 추가/수정/삭제. 데이터 모델은 그대로(`{market, korean_name, entry, stopLoss, takeProfit}`).

- `lib/positions.mjs`: `validatePosition`(화이트리스트·TP>SL 검증)·`upsertPosition`(검증된 필드만 병합하므로 openedAt 등 기존 필드는 수정 중에도 유지)·`deletePosition`(순수 함수) + `writePositions`(store.writeJson 원자적 래퍼).
- `POST /api/positions`(upsert)·`DELETE /api/positions?market=`·`GET /api/ticker?market=`(현재가 힌트) 라우트. 16KB 본문 상한, 서버측 화이트리스트 검증.
- 종합 페이지 포지션 카드에 ＋추가/✏️편집/🗑삭제 + 모달 폼(개별분석 코인검색 재활용, 현재가 "진입가로 채우기"). 포지션 0개여도 카드·추가 버튼 노출.
- 설계·계획: `docs/superpowers/specs|plans/2026-07-12-editable-positions*.md`.

## 6. 신호 신뢰도 개선 (2026-07-13)

- **확정봉 판정**: 일봉 신호를 형성 중(오늘) 봉 제외한 확정 캔들로 판정(`lib/ohlcv.mjs::confirmedOhlcv`). monitor·momentum·backtest·`/api/analyze` 적용, 각 fetch N+1(EMA200·200봉 신고가 위해 201)로 늘렸으나 업비트 일봉 `count`는 200 상한이라 실제로는 200개 원본 → 확정봉 약 199개(EMA200·200봉 신고가엔 영향 미미). 분봉(4시간봉) 경로는 61개 요청 → 확정 60개로 정상 충족. 09:00 신호가 종가에 뒤집히는 구조적 문제(시커·게임빌드 손절 원인) 제거. 차트는 전체 봉 유지.
- **수익 반영 학습**: `qualityTarget = hitComponent(적중률) × returnComponent(평균수익, B안 clamp 0.85~1.25)`, `newWeight` 0.7/0.3 블렌드, `MIN_SAMPLES 3→8`. 보유기간 혼재는 후속(+3일 고정 horizon), 검증 화면에 `mixed-horizon` 배지.
- **버그 4건**: 게이지 널 시세 가드, 모달 저장/삭제 네트워크 예외 처리, `readBody` 바이트 누적 후 1회 디코드(한글 청크 손상 방지, `lib/http-body.mjs`), positions RMW `withLock`.
- **가중치 파일 위생**: 라이브 `signal-weights.json` gitignore, `signal-weights.default.json`(완화 baseline)·`backup-preconfirmed.json`·`meta.json`(signalVersion). 확정봉 regime 재학습 시작.
- 설계·계획: `docs/superpowers/specs|plans/2026-07-13-signal-reliability*.md`.

## 7. 픽 성과 스코어카드 (2026-07-17)

- 스캔 아카이브의 매수 픽 **신규진입 에피소드**를 +1/+3/+7일 확정종가 수익률·MFE로 자동 채점.
- `lib/scorecard.mjs`(순수 로직) + `scripts/scorecard.mjs`(하루 1회 배치, UpbitScorecard 작업 KST 09:10) + `GET /api/scorecard` + 대시보드 "스코어카드" 탭.
- 확정봉 체제(7/13) 전/후 +1일 승률 분리 집계 — 새 체제 효과를 상시 검증.
- `data/scorecard.json`은 gitignore. 손상 시 아카이브에서 전체 재생성 가능.
- 스펙: `docs/superpowers/specs/2026-07-17-pick-scorecard-design.md`

## 8. 조용한 바닥 전략 (2026-07-26)

- 스코어카드 검증 엣지(조용한 과매도 진입 우위, 추격 열위)를 규칙화 — `lib/strategy.mjs` 순수 함수(판정·레벨·시뮬), 백테스트와 라이브 동일 로직.
- 그리드 백테스트(`npm run strategy-backtest`, 216조합·룩어헤드 방지·손절 우선)로 파라미터 확정 → `data/strategy-config.json`(git 추적, 주간 학습과 분리). 선정: RSI≤26·K≤15·vol≤1.5·SL10%·TP18%·hold7 (253종목, n=332, 승률 55.1%, 평균 +1.94%/거래).
- 스캐너: 시그니처 매칭 시 `🎯전략(조용한바닥)` 태그 + 손절·목표가, `volRatio>=5`면 `⚠️추격주의(급등후)` — 점수 불변(표시 전용).
- 레짐 게이트 없음(깊은 약세 ratio 0~0.2에서 승률 57%로 최고 — 데이터 근거). 스펙: `docs/superpowers/specs/2026-07-25-quiet-bottom-strategy-design.md`

## 운영 메모

- **대시보드**: `npm run dashboard` (포트 8787). 새 API 라우트 추가 시 서버 재시작 필요.
- **코인게코 키**: `data/coingecko-key.json`(gitignore). 없으면 도미넌스 기능만 중립, 스캔은 정상.
- **분석 cron**: 세션 한정(창 닫으면 소멸, 7일 만료). 09:16/21:16 추이 + 일 22:37 주간.
