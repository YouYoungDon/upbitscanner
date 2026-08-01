# 주간분석 개선 5종 설계 (2026-08-01)

2026-08-01 수동 주간분석에서 발견한 측정·검증 체계 결함 5건의 수정 설계.
사용자 승인: "다고치자" (5건 전부).

## 1. 가중치 학습을 +1일 확정종가 기준으로 전환 (핵심)

**문제**: `weekly-analysis.mjs`가 신호가 대비 **분석 시점 현재가**로 적중을
판정해 가중치를 갱신한다. 6일 전 픽과 3시간 전 픽이 같은 잣대로 섞이는
보유기간 혼재(mixed-horizon) — UI에도 `⏱ mixed-horizon` 배지로 이미 알려진
결함.

**설계**:
- 판정 기준: 픽의 **스캔일 D0 + 1일의 확정 일봉 종가** vs 신호가.
  매수 = 종가 > 신호가, 매도 = 종가 < 신호가 (`judgeHit` 재사용).
  ret = 방향 기준 유리 수익률(%) (기존 관례 유지).
- 판정 가능 조건: D0 ≤ 오늘(UTC)−2 (D0+1 캔들이 확정되어야 함).
  `confirmedOhlcv`로 마지막(미확정) 캔들 제거 후 UTC day-index로 조회.
- **learnedUntil 가드**: `signal-weights.meta.json`에 `learnedUntil`(마지막
  학습 스캔 timestamp) 저장. 학습 대상 = 최근 14일 스캔 중
  `timestamp > learnedUntil` && 판정 가능. 실행 후 learnedUntil 갱신.
  → --force 재실행·정시 실행 중복 시 **같은 데이터 이중 학습 원천 차단**
  (2026-06-14 저널의 3중 EWM 조정 사고 재발 방지). 주간 미실행(PC off)
  주간도 14일 창으로 캐치업.
- 표시용 통계(signalStats·report·헤드라인)는 **최근 7일 판정 가능 픽 전체**
  기준으로 별도 집계 — 재실행 시에도 리포트는 항상 채워진다. 가중치
  갱신만 learnedUntil 필터를 통과한 레코드로 수행.
- `horizonMode: 'confirmed-1d'`로 기록. UI 배지는 mixed일 때만 경고,
  confirmed-1d면 `+1일 확정` ghost 배지.

## 2. 주간 헤드라인 매수/매도 분리

**문제**: "62.8% 적중"은 매도신호 ~9천 건이 만든 숫자. 약세장에서 매도는
거의 자동 적중이라 헤드라인이 착시를 만든다.

**설계**: `result.sideStats = { buy: {predictions, hits, hitRate}, sell: {...} }`
추가 (overallHitRate는 히스토리 호환 위해 유지). 콘솔 출력과 검증 탭
헤드라인 stat을 매수/매도 분리 표기.

## 3. 시간별 적중률 +7일 확보 + 캔들 캐시 공용화

**문제**: `calcTimedHitRates`가 최근 7일 스캔만 봐서 +7일 경과 픽이 구조적으로
없음(+7일 항상 null). 픽당 API 1콜(약 900콜, 100초)도 낭비.

**설계**: 조회 범위 14일. 마켓별 일봉 1-fetch로
`Map<market, Map<dayIdx, ohlc>>` 캐시를 만들어 가중치 학습(§1)·시간별
적중률·모멘텀 검증이 공유. 판정은 순수 함수로 lib/weekly.mjs에 두고 테스트.
API 콜: 픽당 1콜 → 마켓당 1콜(~250콜).

## 4. 🎯전략 에피소드 SL/TP 자동 채점

**문제**: 스코어카드는 종가 기준 ret1/3/7만 채점 — 전략의 실제 규칙
(SL10%/TP18%/보유7일)과 다르다. 라이브 검증이 수동.

**설계**:
- `lib/strategy.mjs`에 `scoreStrategyOutcome(ep, confirmed, params, nowMs)`
  순수 함수 추가: D+1..D+holdMax 확정봉 순회, low≤SL → sl(우선),
  high≥TP → tp, D+holdMax 봉 종가 → time. 반환
  `{reason:'sl'|'tp'|'time', ret, exitDay}` / 미해결 `{reason:'open'}` /
  entryPrice≤0 또는 holdMax+3일 초과 미해결 `{reason:'no-data'}`.
  진입가 = ep.entryPrice(라이브 스캔가 — 백테스트의 다음봉 시가와 다른
  라이브 규칙임을 주석 명시). 캔들 빠진 날은 건너뜀(scoreEpisode와 동일).
- `scripts/scorecard.mjs`: strategy-config.json 로드. 🎯태그 에피소드 중
  strategyOutcome 미확정(`open`/없음)인 것을 채점 대상에 포함, 같은
  마켓별 1-fetch 루프에서 `ep.strategyOutcome` 기록. config 없으면 스킵.
- `server/api.mjs` buildScorecard: `strategy` 요약
  `{n, sl, tp, time, open, avgRet}` (확정분 기준 avgRet) 추가. episodes에
  strategyOutcome 포함.
- UI 스코어카드 탭: 전략 요약 카드 1개 + 해당 행 코인명 옆 🎯배지와
  청산 결과 배지.

## 5. ⚠️추격주의 감점 ×0.8 승격

**근거**: 첫 라이브 주 실증 — 태그 19건, +1일 평균 **-8.64%**(n=12) vs
전체 -3.59%. 2026-07-25 스펙의 "표시 전용" 결정을 데이터로 개정
(사용자 승인 2026-08-01).

**설계**: monitor.mjs 태그 추가 지점에서 `finalBuyScore *= 0.8` (기존
유동성 ×0.8과 같은 배수 관례). BUY_THRESHOLD 미달로 떨어지는 추격 픽은
목록에서 제외됨 — 의도된 효과. 원 스펙 문서에 개정 각주 추가.

## 에러 처리

- 마켓 캔들 fetch 실패 → 해당 마켓 픽 스킵(콘솔 카운트), 다음 실행 재시도.
  learnedUntil은 스캔 날짜 기준이므로 실패 마켓 픽은 그 주 학습에서 빠짐
  (소수 손실 허용 — 기존 scorecard failedMarkets와 동일 정책).
- strategy-config.json 없음 → 전략 채점 스킵, 스코어카드 정상.
- signal-weights.meta.json에 learnedUntil 없음(첫 실행) → 14일 창 전체 학습.

## 테스트 (vitest)

- lib/weekly.mjs 신규 순수 함수: judgeAtHorizon(+1일 판정·미확정 스킵),
  timedHitRates(1/3/7 창·미확정 null 처리), sideSummary(매수/매도 분리).
- lib/strategy.mjs scoreStrategyOutcome: sl/tp/동시도달 sl 우선/time/
  open/no-data/캔들 결손일 스킵/entryPrice 0.
- 스크립트 오케스트레이션(fetch 루프)은 기존 관례대로 테스트 제외.

## 비범위

- 자동 매매 없음. 전략 파라미터 변경 없음. 주간 가중치 학습 공식
  (newWeight EWM) 변경 없음 — 입력 데이터만 교정.
