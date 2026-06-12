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

## 가중치 자동 갱신 (EWM)

`scripts/weekly-analysis.mjs`가 매주 수요일 최근 7개 스캔의 적중률을 집계해 갱신한다.

```
target    = hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
newWeight = clamp(oldWeight * 0.8 + target * 0.2, 0.5, 2.0)
MIN_SAMPLES = 3   # 등장 횟수 3회 미만이면 조정 안 함
```

적중 기준: 매수 = 현재가 > 신호가, 매도 = 현재가 < 신호가.

## 환경변수 (.env, 선택)

스캔/시세는 공개 API라 키가 필요 없다. 추후 잔고/주문 확장 시 `.env.example`을
복사해 `UPBIT_ACCESS_KEY` / `UPBIT_SECRET_KEY`를 채운다.
