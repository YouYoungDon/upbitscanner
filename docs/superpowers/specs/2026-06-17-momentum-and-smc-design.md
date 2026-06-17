# 모멘텀 스캐너 + monitor 고강도 신호 설계 문서

> 작성일: 2026-06-17
> 출처: 사용자 직장(맥) 환경 스펙을 이 집(Windows/모듈형) 환경에 적응
> 범위: ① momentum-scan.mjs(추세지속) ② monitor.mjs 고강도 3신호 ③ 신규 지표 4종 ④ 스케줄러 ⑤ 대시보드 탭

---

## 1. 목적 / 배경

WLD처럼 이미 상승 중인 종목은 monitor.mjs(과매도→반등 초입)에 안 잡히고 과매수 매도신호로만 뜬다.
→ **추세 지속 포착** 전용 momentum-scan.mjs를 신설하고, monitor.mjs에는 드물지만 강력한 **고강도 매수신호 3종**을 추가한다.

```
monitor.mjs        → 반등 초입(과매도→반전)  → data/monitor-log.json + scan-archive.jsonl
momentum-scan.mjs  → 추세 지속(이미 오르는)   → data/momentum-log.json
```

## 2. 코드베이스 적응 (맥 monolithic → 우리 모듈형)

- 새 **지표 primitive**(calcRSISeries, calcOBV)는 `lib/indicators.mjs`.
- 모멘텀 점수/탐지(detectDivergence, calcBBSqueeze, scoreMomentum)는 신규 `lib/momentum.mjs`.
- monitor 고강도 3신호(detectLiquiditySweep, detectVBottom, detectPumpStart)는 신규 `lib/smc-signals.mjs`.
- 스크립트는 lib 호출만. **launchd → Windows 작업 스케줄러**(install-scheduler.ps1).
- OHLCV 스키마: `{ time, open, high, low, close, volume }` (과거→최신 정렬, candlesToOhlcv 결과).

## 3. 신규 지표 (lib/indicators.mjs)

- `calcRSISeries(closes, period=14)` → 각 봉의 RSI 배열(Wilder, 워밍업 구간 null). 마지막 값은 기존 calcRSI와 동일.
- `calcOBV(closes, volumes)` → OBV 누적 배열(상승봉 +vol, 하락봉 -vol, 보합 유지). obv[0]=0.

## 4. 모멘텀 점수 (lib/momentum.mjs) — MIN_SCORE=10, 이론최대 18

`scoreMomentum(ohlcv)` → `{ score, signals: string[] }`. 그룹 A~D는 그룹당 1개만(최댓값), E는 복수 누적.

- **A 추세(≤4)**: ema20>ema50>ema200 → +4 / ema20>ema50 → +2
- **B 모멘텀(≤4)**: 연속양봉≥5 → +4 / ≥3 → +2 / (양봉 없으면) EMA20 5봉 기울기≥1% → +2
- **C 위치(≤4)**: close≥200봉 최고가×0.99 → +4 / ≥0.92 → +2
- **D 오실레이터(≤4)**: MACD hist 3연속↑ AND RSI 50~75 → +4 / 둘 중 하나 → +2
- **E 품질(각 +2 누적)**: OBV매집(OBV EMA↑ + 가격 5봉 ±0.5% 횡보) / OBV추세확인(OBV EMA↑ + 가격↑) / BB스퀴즈 발산
- **차감**: 하락 다이버전스 → −4 / OBV약화(OBV EMA↓ + 가격↑) → −2

보조 함수:
- `detectDivergence(prices, rsiSeries, {window=3, lookback=60, minGap=3})` → `{ bearish, bullish }`
  - 최근 lookback봉서 로컬 피크/트로프(window=3) 직전 2개 비교. 가격 고점↑+RSI 고점 3pt↓=bearish(-4). 가격 저점↓+RSI 저점 3pt↑=bullish(+3, 반등용).
- `calcBBSqueeze(closes, {period=20, mult=2, lookback=30, sqWin=6, pctile=0.25})` → `{ squeeze, expanding, fired }`
  - BW(%)=(std×2×mult)/mid×100. 직전 sqWin봉 BW최솟값이 lookback범위 하위 25% = squeeze. 현재 2봉 연속 BW확장 = expanding. fired=squeeze&&expanding.

## 5. monitor 고강도 3신호 (lib/smc-signals.mjs) — 각 매우 드묾, 고점수

### detectLiquiditySweep(ohlcv, lookback=20) → `{ side:'buy'|'sell'|null, score, depthPct }`
직전 lookback봉 스윙 고/저점을 당일봉이 잠깐 뚫고 종가 회귀.
- 저점스윕: low < min(직전저점) && close > min×1.001 → buy. depth=(min−low)/min. depth≥1% → +4, else +2.
- 고점스윕: high > max(직전고점) && close < max×0.999 → sell. depth=(high−max)/max. ≥1% → +4, else +2.

### detectVBottom(ohlcv, opts) → null | `{ score, rsi9, volRatio, wickRatio, stopLoss, signalAge }`
신호 캔들 기준 3조건 순서 충족:
- ① 투매: RSI(9)≤25 && vol≥직전20평균×3.0
- ② 핀바: (min(open,close)−low)/(high−low)≥0.60 (동일 신호 캔들)
- ③ CHoCH(이후 1~chochWin=2봉): close>신호캔들 high && vol≥평균×1.5
- 점수: signalAge(=마지막봉−CHoCH봉) 0 → +7, 1~2 → +5, 3+ → 스킵. stopLoss=신호캔들 low.

### detectPumpStart(ohlcv, opts) → null | `{ score, volRatio, stopLoss1, stopLoss2 }`
스퀴즈→매집→발사 순서:
- ① 스퀴즈: 최근 sqWindow=10봉 내 BW≤직전 sqLen=50봉 BW최솟값×1.05 인 시점 존재
- ② 매집: 그 시점에 가격 5봉 ±2% 횡보 && OBV EMA(20) 5봉 우상향
- ③ 발사(현재봉): close>BB상단(전봉은 밴드 내) && vol≥평균×2.0 (종가 기준 돌파만, 돌파봉 OBV EMA 우상향)
- 점수 +7. stopLoss1=발사봉 low, stopLoss2=스퀴즈 박스 최저가.

## 6. 스크립트

### scripts/momentum-scan.mjs (신규)
monitor.mjs와 동일 유동성 필터(거래대금 1억+, 스테이블 제외) → 종목별 일봉 200 → `scoreMomentum` → score≥10만 → `data/momentum-log.json`(최근 30 롤링, monitor-log 동일 구조) 저장 + Telegram(상위 5, 🚀). 레이트리밋 BATCH=5/DELAY=200.

### scripts/monitor.mjs (수정)
analyze 루프에서 `detectLiquiditySweep / detectVBottom / detectPumpStart` 호출 → 매수/매도 신호·점수 가산. buyList 항목에 `vbottomSL`, `pumpSL` 필드(있을 때만). Telegram에 🎯V-Bottom / 🚀Pump / SL 표시. 기존 콤보/MTF 로직은 유지.

## 7. 스케줄러 (install-scheduler.ps1)
`UpbitMomentum_0902`, `UpbitMomentum_2102` 추가(09:02/21:02 = 스캔 2분 뒤 순차). WakeToRun 등 동일 설정. Uninstall 목록에도 추가.

## 8. 대시보드
- `server/api.mjs`: `buildMomentum(log)` → 최신 모멘텀 스캔의 종목/점수/그룹신호 + KPI.
- `server/server.mjs`: `GET /api/momentum` (momentum-log.json 읽기).
- `public/index.html`: 사이드바 `🚀 모멘텀` 탭.
- `public/app.js`: `routes.momentum` — 추세지속 추천 리스트(종목·점수·그룹별 신호 badge), 빈 데이터 시 "스캔 기록 없음".

## 9. 테스트 전략
- `indicators`: calcRSISeries(마지막=calcRSI 일치), calcOBV(상승/하락/보합 누적).
- `momentum`: detectDivergence(bearish/bullish 합성), calcBBSqueeze(수축후 확장), scoreMomentum(정배열+신고가+골디락스 종합/MIN_SCORE/차감).
- `smc-signals`: 각 신호 합성 OHLCV로 발동/미발동, score·SL·signalAge.
- `api`: buildMomentum(빈/정상).
- 기존 전체 테스트 회귀 유지.

## 10. 파일 변경 요약
```
lib/indicators.mjs        # calcRSISeries, calcOBV
lib/momentum.mjs          # 신규: detectDivergence, calcBBSqueeze, scoreMomentum
lib/smc-signals.mjs       # 신규: detectLiquiditySweep, detectVBottom, detectPumpStart
scripts/momentum-scan.mjs # 신규: 모멘텀 스캐너
scripts/monitor.mjs       # 고강도 3신호 호출/점수/SL/Telegram
scripts/install-scheduler.ps1 # UpbitMomentum_0902/2102
server/api.mjs            # buildMomentum
server/server.mjs         # /api/momentum
public/index.html         # 🚀 모멘텀 탭
public/app.js             # routes.momentum
__tests__/indicators.test.mjs / momentum.test.mjs / smc-signals.test.mjs / api.test.mjs
README.md                 # 두 스캐너 구조 설명
```
