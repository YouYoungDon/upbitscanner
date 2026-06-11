# 업비트 스캐너 설계 문서

> 작성일: 2026-06-11
> 범위: 스캔 스크립트 + 데이터 + 주간분석 (UI 대시보드 제외)
> 플랫폼: Windows (가이드는 macOS 기준 — 자동화/경로 적응)

---

## 1. 목적

업비트 KRW 마켓 전체를 하루 2회(KST 09:00 / 21:00) 자동 스캔하여
매수/매도 신호를 집계한다. 핵심은 **콤보 보정 로직**으로 "과매도 함정"과
"진짜 반등"을 구분하는 것이다.

UI 대시보드는 이번 범위에서 제외한다. 공개(비인증) 업비트 API만 사용하므로
API 키가 필요 없다.

## 2. 비범위 (YAGNI)

- Next.js 대시보드, 페이지, API 라우트
- JWT 인증, Prisma/SQLite, Electron
- 잔고/주문 (인증 API)

이들은 후속 sub-project로 분리한다.

## 3. 디렉토리 구조

```
upbit-dashboard/
├── lib/
│   ├── indicators.mjs      # EMA/SMA/RSI/BB/MACD/Stoch/WR/VolRatio (단일 출처)
│   ├── signals.mjs         # 신호감지 + 점수화 + 콤보보정 + 패턴감지
│   └── upbit.mjs           # 업비트 공개 API 래퍼
├── scripts/
│   ├── monitor.mjs         # 메인 스캔
│   ├── weekly-analysis.mjs # 적중률 + EWM 가중치 갱신
│   ├── backtest.mjs        # 과거 신호 백테스트
│   ├── analyze.mjs         # 개별 종목 즉석 분석 (CLI 인자)
│   └── install-scheduler.ps1  # Windows 작업 스케줄러 등록
├── data/
│   ├── monitor-log.json    # 스캔 이력 (최근 30회 롤링)
│   ├── signal-weights.json # 가중치 (초기값 시드)
│   └── weekly-analysis.json # 주간분석 (최근 12주)
├── __tests__/
│   └── indicators.test.mjs # Vitest
├── package.json            # ESM, type: module
├── .env.example
└── README.md               # 운용 가이드
```

**구조 결정:** 가이드 원본은 지표 계산 함수를 monitor.mjs / weekly-analysis.mjs /
인라인 분석에 3중 중복했다. 본 설계는 `lib/indicators.mjs` 단일 출처로 통합하여
중복을 제거하고 단위 테스트를 가능하게 한다.

## 4. 모듈 명세

### 4.1 lib/indicators.mjs

순수 함수만 export (네트워크/IO 없음). 가이드 §6-2 코드를 그대로 이식.

| 함수 | 시그니처 | 반환 |
|------|----------|------|
| `calcEMA` | `(d, p)` | number[] |
| `calcSMA` | `(d, p)` | number[] |
| `calcRSI` | `(c, p=14)` | number \| null |
| `calcBB` | `(c, p=20, m=2)` | `{upper, mid, lower}` \| null |
| `calcMACD` | `(c, f=12, s=26, g=9)` | `{macd, signal, hist, prevMacd, prevSignal, prevHist}` \| null |
| `calcStochastic` | `(highs, lows, closes, period=14, sk=3, sd=3)` | `{k, d, prevK, prevD}` \| null |
| `calcWilliamsR` | `(highs, lows, closes, period=14)` | number \| null |
| `calcVolRatio` | `(volumes)` | number \| null |

### 4.2 lib/signals.mjs

`lib/indicators.mjs`에 의존. 네트워크 없음. 순수 변환.

- `detectSignals(ohlcv, weights)` → `{ buy: string[], sell: string[], buyScore, sellScore }`
  - 가이드 §6-3 점수표 적용 (RSI/BB/MACD/Stoch/WR/EMA/거래량)
  - 신호 점수에 `weights`(가중치) 곱
- `detectPatterns(ohlcv)` → `{ buy: [...], sell: [...] }` (가이드 §9: 쌍봉/역삼중바닥/상승깃발/하락깃발/상승삼각형)
- `applyCombos(buy, sell, buyScore)` → 보정된 buyScore + 콤보 라벨 push (가이드 §6-4)
  - StochGC 없이 RSI+BB+Stoch+WR 과매도 4종 → ×0.55 (과매도 함정 페널티)
  - StochGC 있으면 → ×1.4 (반등확인 보너스)
  - 거래량 급증 있으면 → ×1.3 (거래량확인 보너스)
- **진입 임계값:** 매수 score ≥ 5, 매도 score ≥ 3

### 4.3 lib/upbit.mjs

업비트 공개 REST API 래퍼. 베이스 `https://api.upbit.com/v1`.

- `getMarkets()` → KRW 마켓 목록 (스테이블코인 제외: USDT/USDC/DAI/USD1/TUSD/BUSD)
- `getDayCandles(market, count=200)` → 일봉
- `getTicker(markets)` → 현재가
- 공통 fetch 헬퍼 (Accept: application/json, 실패 시 null)

## 5. 스캔 흐름 (scripts/monitor.mjs)

1. `getMarkets()` → KRW 마켓 전체 (스테이블코인 제외)
2. 24h 거래대금 1억원 미만 저유동성 종목 제외 (ticker `acc_trade_price_24h`)
3. 종목별 일봉 200개 조회 → 역순 정렬(과거→최신)
4. `detectSignals` + `detectPatterns` → `applyCombos`
5. 매수 score ≥ 5, 매도 score ≥ 3 → 결과 수집
6. `data/monitor-log.json`에 append (최근 30회 롤링, totalScans 증가)
7. **레이트 리밋:** BATCH=5, DELAY=200ms

출력 로그 형식은 가이드 §8 monitor-log.json 스키마를 따른다:
`{ timestamp, buy: [{market, korean_name, price, score, signals}], sell: [...] }`

## 6. 가중치 (data/signal-weights.json)

가이드 §7의 2026-06-11 값으로 시드한다 (26개 신호).

**EWM 자동 갱신 공식 (weekly-analysis):**
```
target    = hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
newWeight = clamp(oldWeight * 0.8 + target * 0.2, 0.5, 2.0)
MIN_SAMPLES = 3   // 최소 등장 횟수 미만이면 조정 안 함
```

## 7. 주간 분석 (scripts/weekly-analysis.mjs)

- 최근 7개 스캔 예측 수집 → `getTicker` 현재가 조회 → 적중 판정
- **적중 기준:** 매수 = 현재가 > 신호가, 매도 = 현재가 < 신호가
- 신호별 hitRate 집계 → EWM 갱신 → `signal-weights.json` 덮어쓰기
- 결과 → `weekly-analysis.json` (최근 12주 롤링)
- `--force` 플래그로 수요일 외 강제 실행

## 8. 자동화 (Windows 작업 스케줄러)

macOS LaunchAgent → **Windows Task Scheduler**로 적응.

`scripts/install-scheduler.ps1`:
- `Upbit Monitor 0900` — 매일 09:00 (KST 로컬) `node scripts/monitor.mjs`
- `Upbit Monitor 2100` — 매일 21:00 (KST 로컬) `node scripts/monitor.mjs`
- `Register-ScheduledTask` 사용, 절대경로 + node.exe 경로 자동 탐지
- 언인스톨 함수 (`-Uninstall` 플래그)

**KST 주의:** Windows 작업 스케줄러는 macOS LaunchAgent와 달리 **로컬 시간** 기준이다.
사용자 PC가 KST(Asia/Seoul)이면 09:00/21:00을 그대로 지정한다.

## 9. 테스트 전략 (Vitest)

`__tests__/indicators.test.mjs`:
- 단조 상승 데이터 → RSI 100, 단조 하락 → RSI 0
- 평탄 데이터 → BB std 0 (upper=mid=lower)
- 알려진 시퀀스로 EMA/SMA 손계산 값 대조
- `calcStochastic` h===l 경계 → k 50
- 데이터 부족 시 null 반환 확인

신호/콤보는 합성 캔들로 페널티(×0.55)·보너스(×1.4) 발화를 검증.

## 10. CLI 명령 (package.json scripts)

```
npm run scan       # node scripts/monitor.mjs
npm run weekly     # node scripts/weekly-analysis.mjs
npm run analyze    # node scripts/analyze.mjs KRW-BTC
npm test           # vitest run
```
