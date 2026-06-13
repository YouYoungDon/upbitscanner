# 업비트 스캐너

업비트 KRW 마켓을 하루 2회(KST 09:00 / 21:00) 자동 스캔해 콤보 보정된 매수/매도
신호를 집계한다. 공개 API만 사용하므로 API 키가 필요 없다.

## 설치

```bash
npm install
```

## 사용

```bash
npm run scan                # 수동 스캔 1회
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
# 등록 (매일 09:00 / 21:00, 로컬 시간 = KST)
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
# 제거
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
# 확인
Get-ScheduledTask -TaskName 'UpbitMonitor_*'
```

> macOS LaunchAgent와 달리 Windows 작업 스케줄러는 **로컬 시간** 기준이다.
> PC 시간대가 Asia/Seoul이면 09:00/21:00이 곧 KST다.

## 구조

| 경로 | 역할 |
|------|------|
| `lib/indicators.mjs` | EMA/SMA/RSI/BB/MACD/Stoch/WR/VolRatio 순수 함수 |
| `lib/signals.mjs` | 신호 감지 + 점수화 + 콤보 보정 + 패턴 감지 |
| `lib/upbit.mjs` | 업비트 공개 REST API 래퍼 |
| `lib/store.mjs` | JSON 읽기/쓰기 + 롤링 + EWM 헬퍼 |
| `lib/weekly.mjs` | 적중률 집계 + 가중치 갱신 로직 |
| `scripts/monitor.mjs` | 메인 스캔 |
| `scripts/weekly-analysis.mjs` | 주간 적중률 + 가중치 EWM 갱신 |
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

## 가중치 자동 갱신 (EWM)

`scripts/weekly-analysis.mjs`가 매주 수요일 최근 7개 스캔의 적중률을 집계해 갱신한다.

```
target    = hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
newWeight = clamp(oldWeight * 0.8 + target * 0.2, 0.5, 2.0)
MIN_SAMPLES = 3   # 등장 횟수 3회 미만이면 조정 안 함
```

적중 기준: 매수 = 현재가 > 신호가, 매도 = 현재가 < 신호가.

## 대시보드

`npm run dashboard` → 브라우저에서 `http://127.0.0.1:8787` (localhost 전용, 인증 없음).

- **대시보드 탭**: KPI(매수/매도/누적스캔/최다신호/적중률1위) + 매수·매도 TOP5 + 수동 스캔(진행률)
- **추천 탭**: 매수/매도 전체 리스트, 검색·정렬·콤보 태그
- **개별분석 탭**: 종목 검색 → 캔들/라인 차트(일/4h/1h) + 지표 + 🕯️ 캔들 모양분석 + 종합 점수
- **신호검증 탭**: 전체·시간별(+1/+3/+7일) 적중률 + 신호별 적중률/가중치

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
