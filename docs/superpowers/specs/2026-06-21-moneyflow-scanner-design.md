# 자금유입 스캐너(Money Flow Scanner) 설계

**작성일:** 2026-06-21

**목표:** 이미 급등한 코인이 아니라, **자금이 막 들어오기 시작하는** 코인을 분봉
머니플로우·가속도·돌파로 조기 포착하는 제3의 스캐너를 추가한다.

**운영:** Windows 작업 스케줄러 **3시간 주기**(하루 8회). 매 실행은 독립(stateless),
중복 알림 억제 상태만 파일로 실행 간 공유. 3시간 스냅샷이므로 "조기"는 "스캔 시점에
자금이 아직 유입 중인 종목" 위주(분 단위 실시간은 아님 — 의도된 트레이드오프).

**기존 시스템과의 관계:** monitor(반등)·momentum(추세지속)에 이어 **flow(자금유입)**
세 번째 스캐너. 공용 모듈(upbit/scan-universe/indicators/regime/notify/server) 재활용.

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|------|------|----------|
| `lib/moneyflow.mjs` | 머니비율·가속도·모멘텀게이트·돌파·추세·종합점수·알림레벨 (순수 함수) | 신규 |
| `lib/flow-alert.mjs` | 중복 알림 억제 판정 (순수 함수) | 신규 |
| `lib/upbit.mjs` | `candlesToOhlcv`에 `tradeValue` 필드 추가(가산) | 수정 |
| `scripts/flow-scan.mjs` | 3시간 스캔 오케스트레이션 | 신규 |
| `data/flow-log.json` | 최근 N회 스캔 결과(롤링 30) | 신규(런타임) |
| `data/flow-alert-state.json` | 종목별 `{lastScore, lastAlertTs}` | 신규(런타임) |
| `server/api.mjs` | `buildFlow(log)` | 수정 |
| `server/server.mjs` | `/api/flow` 라우트 | 수정 |
| `public/index.html`, `public/app.js` | `💸 자금유입` 탭 | 수정 |
| `scripts/install-scheduler.ps1` | `UpbitFlow` 3시간 태스크 | 수정 |

---

## 데이터 소스 (Upbit 공개 API)

- 5분봉: `getMinuteCandles(market, 5, 40)` → 머니플로우·가속도·5m/15m/30m 변화·돌파·EMA/RSI.
- 1분봉: `getMinuteCandles(market, 1, 3)` → 1m 변화.
- 종목당 **2콜**. 3시간 주기라 레이트리밋 여유 충분.
- BTC 5분봉: `getMinuteCandles('KRW-BTC', 5, 3)` (실행당 1콜).
- 24h 컨텍스트: `getTicker`(배치 100) → `trade_price`(현재가), `high_price`(당일 고가, 24h 고가 근접 판정용 프록시), `acc_trade_price_24h`(유동성 필터), `signed_change_rate`(24h 변화율 → UI `ch24h = signed_change_rate*100`).
- 원시 분봉의 `candle_acc_trade_price` = 캔들별 KRW 거래대금. `candlesToOhlcv`에
  `tradeValue: c.candle_acc_trade_price` 추가(기존 소비자는 추가 필드 무시 → 안전).

## 유니버스

`getScanUniverse({ minTradePrice: CONFIG.minTradePrice24h })`. 기본 24h 거래대금 ≥ **100억**
→ 가장 유동성 높은 종목만 대상(레이트리밋·노이즈 동시 해결).

---

## CONFIG (조정 가능, `lib/moneyflow.mjs` 상단)

```js
export const CONFIG = {
  minTradePrice24h: 10_000_000_000, // 유니버스 24h 거래대금 하한 (100억)
  moneyWindow: 20,                  // 머니비율 직전 평균 봉 수
  min5mValue: 500_000_000,          // 5m 현재 거래대금 게이트 (5억)
  value5mBonus: 1_000_000_000,      // 5m 거래대금 보너스 임계 (10억 → +15)
  accelStrong: 1.5,                 // 머니가속도 보너스 임계
  exclude5mPct: 8,                  // 5m 변화 > +8% 하드배제
  exclude15mPct: 15,                // 15m 변화 > +15% 하드배제
  early1mMin: 0.5, early1mMax: 2.5, // 조기존 1m 변화 범위(%)
  early30mMax: 10,                  // 조기존 30m 변화 상한(%)
  breakoutLookback: 20,             // 돌파: 직전 N개 5분봉 최고가
  near24hPct: 2,                    // 24h 고가 근접(%)
  consolRangePct: 3,                // consolidation 레인지 타이트 임계(%)
  rsiMin: 50, rsiMax: 75,
  btcDropPct: -1,                   // BTC 5m < -1% → ×0.8
  btcPenalty: 0.8,
  suppressMs: 6 * 60 * 60 * 1000,   // 중복 알림 억제창(6시간)
  reAlertRatio: 1.3,                // 점수 30%↑면 재알림
}
```

---

## `lib/moneyflow.mjs` — 순수 함수

### 머니플로우 (40%)
```
tradingValues(ohlcv) → ohlcv.map(c => c.tradeValue)   // 오래된→최신
moneyRatio(values, window=20) → values.at(-1) / mean(직전 window개);  분모 0 또는 데이터<window+1 → null
ratioAt(values, i, window) → values[i] / mean(values[i-window..i-1])
moneyAcceleration(values, window=20) → ratioAt(last)/ratioAt(last-1);  데이터<window+2 또는 분모 0 → null
```
- 등급: ratio ≥5x→매우강함, ≥3x→강함, ≥2x→보통.

### 가격 변화
```
pctChange(closes, nBack) → (closes.at(-1)/closes.at(-1-nBack) - 1) * 100
```
- 5분봉 closes에서 5m=nBack1, 15m=nBack3, 30m=nBack6. 1m는 1분봉 closes nBack1.

### 모멘텀 게이트
```
isPumped(ch5m, ch15m) → ch5m > CONFIG.exclude5mPct || ch15m > CONFIG.exclude15mPct   // true면 후보 제외
isEarlyZone(ch1m, ch30m) → ch1m >= early1mMin && ch1m <= early1mMax && ch30m < early30mMax
```

### 돌파
```
breakout20(ohlcv, lookback=20) → 현재가 > 직전 lookback개 high의 최댓값
near24hHigh(price, high24h, pct=2) → price >= high24h * (1 - pct/100)
isConsolidationBreakout(ohlcv, lookback, rangePct) → 직전 lookback 레인지 (max-min)/min < rangePct/100 그리고 breakout20
```

### 추세
```
emaAligned(closes) → EMA5 > EMA20 > EMA60 (calcEMA 재활용, .at(-1) 비교)
rsiOk(closes) → CONFIG.rsiMin ≤ calcRSI(closes) ≤ CONFIG.rsiMax
```

### 종합점수 (0~100)
```
scoreFlow({ ratio, accel, value5m, breakout, near24h, emaOK, rsiOK, early, btcFavorable, btcBad }) → { score, parts }
```
가산:
| 조건 | 점수 |
|------|------|
| ratio ≥5 / ≥3 / ≥2 | +30 / +20 / +10 |
| accel ≥ accelStrong | +5 |
| value5m > value5mBonus | +15 |
| breakout | +15 |
| near24h | +10 |
| emaOK | +10 |
| rsiOK | +5 |
| early | +5 |
| btcFavorable | +5 |

- btcBad(=BTC 5m < btcDropPct)면 합계 × btcPenalty(0.8).
- `Math.max(0, Math.min(100, Math.round(score)))` 클램프. 최대 raw 100.

### 알림 레벨
```
alertLevel({ ratio, breakout, btcFavorable }) →
  ratio≥3 && breakout && btcFavorable → 'strong'  (🔴)
  ratio≥2 && breakout                 → 'attention'(🟠)
  ratio≥2                             → 'watch'    (🟡)
  else null
```

---

## `lib/flow-alert.mjs` — 중복 억제 (순수 함수)
```
shouldAlert({ market, score, now }, state, cfg) → boolean
  prev = state[market]
  prev 없음 → true
  (now - prev.lastAlertTs) >= cfg.suppressMs → true
  score >= prev.lastScore * cfg.reAlertRatio → true   // 30%↑ 재알림
  else false
updateAlertState(state, market, score, now) → 새 state (lastScore/lastAlertTs 갱신)
```
- 억제는 Telegram 대상만. 대시보드는 항상 전체 표시.

---

## `scripts/flow-scan.mjs` — 오케스트레이션

1. `getScanUniverse({ minTradePrice: CONFIG.minTradePrice24h })` → targets, nameOf, tradePrice.
2. BTC 5분봉 1콜 → btc5mReturn, btcFavorable(추세 양·5m≥0), btcBad(5m<-1%).
3. 티커 배치 → priceOf, high24hOf.
4. 종목 루프(BATCH=5, DELAY=200):
   - 5분봉 40 + 1분봉 3 조회 → ohlcv5/ohlcv1.
   - 데이터 부족(5분봉<window+2) → skip.
   - 5m 현재 거래대금 < min5mValue → skip(절대 거래대금 게이트).
   - ch5m/ch15m/ch30m/ch1m 계산. isPumped면 **제외**.
   - ratio, accel, breakout, near24h, emaOK, rsiOK, early 계산.
   - scoreFlow → { score, parts }, alertLevel.
   - level이 있으면 결과에 push: { market, korean_name, price, score, level, ratio, accel, value5m, ch1m, ch5m, ch30m, ch24h, breakout, emaOK, rsi, ... }.
5. 랭킹: 종합점수 desc → ratio desc → breakout(돌파 우선).
6. `flow-log.json` 롤링(30) 저장 + 스캔 entry에 `{ timestamp, btc:{ret,favorable}, picks }`.
7. 알림 상태 로드 → strong/attention 픽 중 `shouldAlert` 통과분만 Telegram, 상태 갱신·저장.
8. 실패 시 `sendTelegram('❌ 자금유입 스캔 실패: ...')`, exit 1.

---

## UI — `💸 자금유입` 탭

- `server/api.mjs` `buildFlow(log)` → `{ empty, timestamp, btc, kpi:{strong,attention,watch}, picks }`.
- `server/server.mjs` `/api/flow` → `buildFlow(readJson('flow-log.json'))`.
- `public/app.js` routes.flow: 표 컬럼 = 종목 · 종합점수 · 5m거래대금 · 머니비율 · 머니가속도 ·
  1m/5m/30m/24h 변화 · 돌파상태 · EMA정배열 · RSI · BTC상태 · 레벨뱃지(🟡🟠🔴).
  상단 KPI(레벨별 개수 + BTC 상태). 랭킹순 정렬.
- `index.html`에 사이드바 탭 추가.

## 스케줄러

`install-scheduler.ps1` $tasks에 `UpbitFlow`(3시간 주기: 00,03,06,09,12,15,18,21시) 추가.
Uninstall 목록에도 포함.

---

## 테스트 (Vitest, TDD)

- `__tests__/moneyflow.test.mjs`:
  - moneyRatio 경계(2/3/5x), 분모0·데이터부족 null
  - moneyAcceleration 가속(>1)/감속(<1)/평탄(≈1)/데이터부족 null
  - pctChange 부호·값
  - isPumped(5m>8 / 15m>15 → true), isEarlyZone 범위
  - breakout20, near24hHigh, isConsolidationBreakout
  - emaAligned, rsiOk
  - scoreFlow 합산·btcBad ×0.8·0~100 클램프·각 parts
  - alertLevel 3단 분류 + null
- `__tests__/flow-alert.test.mjs`: shouldAlert(신규/억제창내/억제창밖/+30%재알림), updateAlertState
- `__tests__/api.test.mjs`: buildFlow 형태(빈 로그/정상)
- flow-scan 통합: 라이브 1회 정상 실행 확인

## 회귀

기존 135 테스트 유지 + `candlesToOhlcv` tradeValue 추가가 기존 소비자에 무영향(추가 필드)임을 확인.

## 범위 밖(v1 제외)

- 분 단위 실시간/데몬, 15m 머니플로우 멀티TF, WebSocket. 3시간 스냅샷 + 5m 중심으로 시작.
