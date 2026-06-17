# 스캐너 개선 8종 설계 문서

> 작성일: 2026-06-17
> 범위: 시장레짐·검증루프·기대값·포지션·유동성·재시도·OS저널·백테스트
> 근거: 06-15~06-17 저널 실측(약세장 반등픽 연속 실패) + 코드 점검

---

## Tier 1 — 데이터가 요구하는 것

### #1 시장 레짐 필터 (lib/regime.mjs)
- `btcRegime(btcOhlcv)` → `{ trend:'bull'|'neutral'|'bear' }`: EMA20/50/200 배열.
  bull = e20>e50>e200, bear = e20<e50, 그 외 neutral.
- `regimeLabel(ratio, trend)` → `{ label:'확장'|'중립'|'수축', emoji }` (표시용; ratio=매수÷매도).
- monitor.mjs: 스캔 전 BTC 일봉 1회 조회 → bear면 **반등 매수 finalBuyScore ×0.85 + '[레짐] BTC 약세' 태그**. (momentum은 추세추종이라 미적용.)
- 스캔 로그에 `regime:{trend,ratio,label}` 저장 → buildResults가 노출 → 대시보드 상단 배지.

### #2 모멘텀+SMC 검증 루프 (weekly-analysis)
- weekly-analysis가 `momentum-log`도 읽어 모멘텀 픽 +1/+3/+7일 적중률 산출 → `weekly-analysis.json`에 `momentum:{overallHitRate,timedHitRates}` 추가.
- 기존 SMC 신호(🎯V-Bottom/🚀Pump/유동성스윕)는 이미 monitor 신호라 aggregateHitRates에 잡힘 — verify 탭에서 별도 가시화.
- 대시보드 신호검증 탭에 "모멘텀 적중률" 섹션.

### #3 기대값(expectancy)
- lib/weekly.mjs: judge 시 수익률도 집계. `aggregateReturns(records)` → 신호별 `{avgReturn}`. records에 `ret`(=(현재가/신호가-1)) 추가.
- signalStats에 `avgReturn` 병합 → verify 탭에 "평균수익률" 열.

## Tier 2 — 실거래 도구화/품질

### #4 포지션 추적 + SL 알림
- `data/positions.json`: `[{market,korean_name,entry,stopLoss,takeProfit,openedAt}]` (수동 편집, 시드: 게임빌드 1.48/SL1.43).
- `lib/positions.mjs`: `readPositions()`, `evalPositions(positions, priceOf)` → 각 `{...,price,plPct,toSL,hitSL}`.
- server: `GET /api/positions` (positions.json + 현재가 티커) → 대시보드 "💼 포지션" 탭.
- monitor.mjs 말미: 보유 종목 현재가 조회 → SL 도달 시 Telegram '⚠️손절선' 알림.

### #5 저유동성 플래그/감점
- getScanUniverse가 `tradePrice` 맵도 반환. monitor/momentum: 24h대금 < 3억이면 매수항목 `lowLiquidity:true` + 점수 ×0.9 + '⚠️저유동성' 태그.

### #6 API 재시도/백오프 + 실패 알림
- upbit.mjs `get()`: 429/5xx/네트워크 throw 시 지수 백오프 2회 재시도(300/600ms). 4xx(잘못된 마켓)는 재시도 안 함.
- monitor/momentum `main().catch`: throw 시 Telegram 실패 알림.
- 대시보드: 마지막 스캔이 N시간 초과면 신선도 경고 배지.

## Tier 3 — 견고성/분석

### #7 OS 레벨 추이 저널 (scripts/trend-journal.mjs)
- 아카이브에서 결정적 수치(비율/직전대비/TOP3/거래량급증 종목)를 계산해 analysis-journal.md에 `## [auto] YYYY-MM-DD HH:mm` 프리펜드(LLM 불필요). 중복 방지(최신 스캔 ts 비교).
- 스케줄러에 09:17/21:17 등록. (LLM cron은 서사 보강용으로 유지.)

### #8 모멘텀/SMC 백테스트 (scripts/backtest-momentum.mjs)
- 상위 유동성 N종목의 과거 일봉을 슬라이딩 윈도우로 scoreMomentum 적용 → 신호 발생 시점 +3/+7일 forward return 집계. 표본·평균수익·승률 출력.

## 테스트 전략
- regime: btcRegime(bull/bear/neutral), regimeLabel.
- weekly: aggregateReturns, 모멘텀 적중 판정.
- positions: evalPositions(plPct/toSL/hitSL).
- scan-universe: tradePrice 맵 반환.
- upbit get 재시도는 fetch 주입 테스트.
- 기존 전체 회귀 유지.

## 파일 변경 요약
```
lib/regime.mjs(신규) lib/positions.mjs(신규) lib/scan-universe.mjs(tradePrice)
lib/weekly.mjs(aggregateReturns) lib/upbit.mjs(retry)
scripts/monitor.mjs scripts/momentum-scan.mjs scripts/weekly-analysis.mjs
scripts/trend-journal.mjs(신규) scripts/backtest-momentum.mjs(신규) scripts/install-scheduler.ps1
server/api.mjs server/server.mjs public/index.html public/app.js
data/positions.json(신규)
__tests__/regime/positions/weekly/scan-universe/upbit 테스트
README.md
```
