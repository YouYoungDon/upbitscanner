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

## 운영 메모

- **대시보드**: `npm run dashboard` (포트 8787). 새 API 라우트 추가 시 서버 재시작 필요.
- **코인게코 키**: `data/coingecko-key.json`(gitignore). 없으면 도미넌스 기능만 중립, 스캔은 정상.
- **분석 cron**: 세션 한정(창 닫으면 소멸, 7일 만료). 09:16/21:16 추이 + 일 22:37 주간.
