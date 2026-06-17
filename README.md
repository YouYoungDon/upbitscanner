# 업비트 스캐너

업비트 KRW 마켓을 하루 2회(KST 09:00 / 21:00) 자동 스캔해 콤보 보정된 매수/매도
신호를 집계한다. 공개 API만 사용하므로 API 키가 필요 없다.

**두 스캐너 운영:**

| 스캐너 | 목적 | 출력 | 스케줄 |
|--------|------|------|--------|
| `monitor.mjs` | 반등 초입 포착 (과매도→반전) + 고강도 SMC 신호 | `monitor-log.json` + `scan-archive.jsonl` | 09:00 / 21:00 |
| `momentum-scan.mjs` | 추세 지속 포착 (이미 오르는 종목, 예: WLD) | `momentum-log.json` | 09:02 / 21:02 |

반등 스캐너는 과매수 종목을 매도로만 보므로, 이미 상승 중인 추세 종목은 모멘텀 스캐너가 별도로 잡는다.

**리스크/품질 보강 (2026-06-17):**
- **시장 레짐 필터** — BTC 일봉 추세가 약세면 반등 매수 점수 ×0.85 (약세장 역행 매수 억제). 대시보드 상단 레짐 배지.
- **저유동성 감점** — 24h 거래대금 3억 미만은 ⚠️플래그 + 점수 ×0.9.
- **포지션 추적** — `data/positions.json`(수동) → 💼 포지션 탭(손익·SL거리) + 보유종목 SL 도달 시 Telegram.
- **검증 확장** — 주간 분석이 모멘텀 픽 적중률 + 신호별 평균수익(기대값)도 산출.
- **API 재시도** — 429/5xx/네트워크 오류 시 지수 백오프 2회. 스캔 실패 시 Telegram 알림.
- **백테스트** — `npm run backtest:momentum [N]`로 모멘텀 신호의 +3/+7일 forward return 집계.

## 설치

```bash
npm install
```

## 사용

```bash
npm run scan                # 반등 스캔 1회 (monitor)
npm run momentum            # 모멘텀(추세지속) 스캔 1회
npm run analyze -- KRW-BTC  # 개별 종목 분석
npm run weekly -- --force   # 주간 분석 강제 실행 (수요일 외)
npm run backtest 30         # 상위 30종목 백테스트
npm test                    # 전체 테스트 (Vitest)
npm run dashboard          # 로컬 대시보드 http://127.0.0.1:8787
```

> 참고: `npm run analyze KRW-BTC`처럼 `--` 없이도 동작하지만, npm은 `--` 뒤의
> 인자를 스크립트로 그대로 전달하므로 `--`를 붙이는 것이 안전하다.

## 자동화 (Windows 작업 스케줄러)

```powershell
# 등록 (매일 09:00 / 21:00 스캔 + 일요일 22:00 주간 분석, 로컬 시간 = KST)
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
# 제거
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
# 확인
Get-ScheduledTask -TaskName 'Upbit*'
```

> macOS LaunchAgent와 달리 Windows 작업 스케줄러는 **로컬 시간** 기준이다.
> PC 시간대가 Asia/Seoul이면 09:00/21:00이 곧 KST다.

## 구조

| 경로 | 역할 |
|------|------|
| `lib/indicators.mjs` | EMA/SMA/RSI/BB/MACD/Stoch/WR/VolRatio + RSI시리즈/OBV 순수 함수 |
| `lib/signals.mjs` | 신호 감지 + 점수화 + 콤보 보정 + 패턴 감지 |
| `lib/momentum.mjs` | 추세지속 점수(A~E 그룹) + 다이버전스 + BB스퀴즈 |
| `lib/smc-signals.mjs` | 고강도 신호: 유동성스윕 / V-Bottom / Pump Start |
| `scripts/momentum-scan.mjs` | 모멘텀(추세지속) 스캐너 |
| `lib/upbit.mjs` | 업비트 공개 REST API 래퍼 |
| `lib/store.mjs` | JSON 읽기/쓰기 + 롤링 + EWM 헬퍼 |
| `lib/weekly.mjs` | 적중률 집계 + 가중치 갱신 로직 |
| `scripts/monitor.mjs` | 메인 스캔 |
| `scripts/weekly-analysis.mjs` | 주간 적중률 + 가중치 EWM 갱신 + "왜 맞았는지" 리포트 |
| `scripts/analyze.mjs` | 개별 종목 즉석 분석 |
| `scripts/backtest.mjs` | 과거 신호 백테스트 |
| `scripts/install-scheduler.ps1` | 작업 스케줄러 등록/제거 |
| `data/signal-weights.json` | 신호 가중치 (시드값 포함) |
| `data/monitor-log.json` | 스캔 이력 (최근 30회 롤링) |
| `data/weekly-analysis.json` | 주간 분석 이력 (최근 12주) |

## 스캔 흐름

1. KRW 마켓 전체 조회 (스테이블코인 USDT/USDC/DAI/USD1/TUSD/BUSD 제외)
2. 24h 거래대금 1억원 미만 저유동성 종목 제외
3. 종목별 일봉 200개 조회 → 과거→최신 정렬
4. 지표 계산 → 신호 점수화 → 패턴 점수 합산 → 콤보 보정
5. 매수 score ≥ 5, 매도 score ≥ 3 → `data/monitor-log.json` 저장
6. 레이트 리밋 준수: BATCH=5, DELAY=200ms

## 핵심 로직: 콤보 보정

| 콤보 | 배수 | 조건 |
|------|------|------|
| 과매도 함정 페널티 | ×0.55 | Stoch 골든크로스 **없이** RSI+BB+Stoch+WR 과매도 4종 동시 발화 (낙하 중) |
| 반등확인 보너스 | ×1.4 | Stoch 과매도 골든크로스 포함 (진짜 반등) |
| 거래량확인 보너스 | ×1.3 | 거래량 급증 동반 |

`Stoch 과매도 골든크로스` = K선이 D선을 아래에서 위로 돌파 + 두 선 모두 20 미만.
이 신호가 "과매도 함정"과 "진짜 반등"을 가르는 핵심이다.

### 추가 신호 보정

| 항목 | 동작 |
|------|------|
| `[MTF] 4시간봉 Stoch GC 확인` | 일봉 골든크로스 매수에 한해 4시간봉도 Stoch GC면 score ×1.2 |
| `[익절] Stoch DC — 매도 타이밍` | 매도 신호에 데드크로스가 있으면 익절 타이밍 정보 태그 부착 (점수 영향 없음) |
| `박스권 돌파 패턴` | 최근 20봉 범위가 ±5% 이내로 좁고 마지막 종가가 상단 1% 돌파 시 매수 +4점 |

## 모멘텀 스캐너 점수 (momentum-scan, MIN_SCORE=10)

추세 지속 종목을 5개 그룹으로 점수화(이론최대 18). A~D는 그룹당 1개(최댓값), E는 누적.

| 그룹 | 내용 | 최대 |
|------|------|------|
| A 추세 | EMA 정배열(20>50[>200]) | +4 |
| B 모멘텀 | 연속양봉≥5/≥3, 없으면 EMA20 기울기≥1% | +4 |
| C 위치 | 200봉 신고가 갱신(≥99%)/근접(≥92%) | +4 |
| D 오실레이터 | MACD 히스토 3연속↑ + RSI 50~75 | +4 |
| E 품질 | OBV 매집/추세확인, BB 스퀴즈 발산 (각 +2) | 누적 |
| 차감 | RSI 하락 다이버전스 −4, OBV 약화 −2 | − |

## monitor 고강도 SMC 신호 (드물지만 강력)

| 신호 | 점수 | 조건 |
|------|------|------|
| 유동성 스윕 | +2~4 | 직전 20봉 스윙 고/저점을 잠깐 뚫고 종가 회귀 (SMC 스탑헌팅) |
| V-Bottom | +5~7 | 투매(RSI9≤25,거래량3x) → 긴 밑꼬리 핀바 → CHoCH 순서 충족. SL=핀바 저가 |
| Pump Start | +7 | BB스퀴즈 → OBV매집 → BB상단 종가돌파(거래량2x) 순서. SL=돌파봉 저가 |

V-Bottom/Pump는 매수 항목에 `vbottomSL`/`pumpSL`(손절가) 필드와 함께 저장되고 Telegram에 🎯/🚀 표시.

## 가중치 자동 갱신 (EWM)

`scripts/weekly-analysis.mjs`가 **매주 일요일 22:00**에 지난 7일 스캔 아카이브의
적중률을 집계해 가중치를 갱신하고, "왜 맞았는지" 주간 리포트를 생성한다(신호검증 탭 "📅 이번 주 요약"에 표시).

```
target    = hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
newWeight = clamp(oldWeight * 0.8 + target * 0.2, 0.5, 2.0)
MIN_SAMPLES = 3   # 등장 횟수 3회 미만이면 조정 안 함
```

적중 기준: 매수 = 현재가 > 신호가, 매도 = 현재가 < 신호가.

## 대시보드

`npm run dashboard` → 브라우저에서 `http://127.0.0.1:8787` (localhost 전용, 인증 없음).
Windows에서는 `start-dashboard.bat` 더블클릭으로도 실행된다.

- **UI**: Tailwind CSS + DaisyUI(business 테마, CDN) 기반 — 빌드 없이 동작.
- **대시보드 탭**: KPI stats + 콤보 분포 + 캔들 모양 요약 + 스캔 추이 스파크라인 + 매수/매도 TOP 10 + 수동 스캔(진행률)
- **추천 탭**: 매수/매도 전체 리스트, 검색·콤보 badge
- **모멘텀 탭**: 추세지속 추천(`momentum-scan`) — 종목·점수·그룹별 신호(EMA정배열/신고가/OBV/BB스퀴즈 등)
- **개별분석 탭**: 코인 리스트(한글 검색) → 캔들/라인 차트(일/4h/1h) + 지표 + 🕯️ 캔들 모양분석 + 종합 점수
- **신호검증 탭**: 전체·시간별(+1/+3/+7일) 적중률 + 신호별 적중률/가중치
- **스캔기록 탭**: 매 스캔을 영구 아카이브(`data/scan-archive.jsonl`)에 누적. 날짜별 드릴다운(그 스캔의 매수/매도 전체) + 종목별 등장 이력(특정 코인이 언제 매수/매도로 떴는지). 최초 1회 `node scripts/seed-archive.mjs`로 기존 기록 이관.

캔들 모양분석은 일본식 캔들스틱 패턴 12종(망치형·장악형·샛별/석별·도지 등)을 감지하며,
개별분석에 표시되고 스캔 점수에도 강세/약세 보너스(작은 가중치, EWM 자동 조정)로 반영된다.

## 주간 분석 — 시간별 적중률

`weekly-analysis.json`의 각 주차 항목에는 매수 신호의 `+1일 / +3일 / +7일` 적중률이
함께 기록된다. 스캔 시점으로부터 해당 일수가 지난 매수 신호만 그 시점 일봉 종가와
비교해 판정하므로, 단일 현재가 판정의 보유기간 혼재 문제를 보완한다.

## 환경변수 (.env, 선택)

스캔/시세는 공개 API라 키가 필요 없다. 추후 잔고/주문 확장 시 `.env.example`을
복사해 `UPBIT_ACCESS_KEY` / `UPBIT_SECRET_KEY`를 채운다.

**Telegram 알림 (선택):** 아래 두 변수를 설정하면 스캔 후 매수 상위 5개를 봇으로 전송한다.

```
TELEGRAM_TOKEN=123456:ABC...      # @BotFather → /newbot 로 발급
TELEGRAM_CHAT_ID=987654321        # getUpdates 의 chat.id
```

작업 스케줄러로 자동 실행 시에도 알림을 받으려면 시스템 환경변수로 등록한다.
