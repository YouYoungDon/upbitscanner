# 스코어카드 리스크 지표 (MDD + 샤프) 설계

> gs-quant(Apache-2.0) `econometrics.max_drawdown`·`sharpe_ratio` 수식 참조.
> 라이브러리 의존이 아니라 표준 수식을 Node.js로 이식.

**목표:** 스코어카드·전략 성과에 최대낙폭(MDD)과 샤프비율을 추가해
"이 스캐너를 따라갔을 때 리스크 대비 수익이 얼마였나 / 중간에 얼마나 물렸나"를
정직하게 답한다. 소폰 -86% 회복용 도구의 핵심(검증된 리스크 성과)을 채운다.

## 배경 — 이미 있는 것 / 없는 것

코드 확인 결과:
- **볼린저 밴드**: `signals.mjs`(BB 하단 지지/상단 돌파) + `momentum.mjs::calcBBSqueeze`
  (스퀴즈→발산) + 신규 엔진 `volCompression.mjs`로 **이미 구현됨**. 재작업 불필요.
- **winsorize(이상치 방어)**: 신규 스코어링 엔진 피처가 `percentileVsUniverse`/
  `fixedCurve`/`vsOwnHistory` 정규화 사용 → 백분위 방식이 winsorize보다 강한
  이상치 방어. `volComboMult` 버킷 상한도 사실상 winsorize. **구조적으로 이미 처리됨**.
- **MDD·샤프**: `buildScorecard`는 승률·평균수익·평균MFE만 계산. **실제 공백** → 이 스펙의 대상.

## 아키텍처

수익 배열(number[])만 입력받는 순수 함수 모듈을 신설하고, `buildScorecard`가
두 종류의 수익 곡선을 만들어 이 모듈에 넘긴다.

- **전략 곡선**: `strategyOutcome`으로 청산된(sl/tp/time) 실현수익 `ret`을 진입일순 정렬.
  실제 매매 가능한 트레이드 시퀀스 → MDD·샤프가 가장 의미 있음.
- **스코어카드 곡선**: 채점된 픽을 진입일별로 묶어 그날 픽들의 +1일 수익 평균을
  일별 수익으로. 비중첩 일별 포트폴리오 곡선.

### 유닛: `lib/perf-metrics.mjs` (신규, 순수)

- `equityCurve(returns: number[]) -> number[]`
  누적곱 자산곡선. `[]` → `[]`. 곡선[i] = ∏(1+r₀..rᵢ).
- `maxDrawdown(returns: number[]) -> { mdd, peakIdx, troughIdx }`
  자산곡선의 러닝 피크 대비 최대 하락률. mdd ≤ 0. 빈 배열 → `{ mdd: null, peakIdx: -1, troughIdx: -1 }`.
- `sharpe(returns: number[], { riskFree = 0 } = {}) -> number | null`
  평균/표본표준편차(n-1). `n < 2` 또는 표준편차 0 → `null`. per-trade(연율화 안 함).
- `strategyReturns(episodes) -> number[]`
  `strategyOutcome.reason ∈ {sl,tp,time}`인 에피소드의 `ret`을 `entryTs` 오름차순 정렬.
- `dailyPortfolioReturns(episodes, horizon = 1) -> number[]`
  `ret{horizon}`이 채점된 에피소드를 진입일(UTC day)별 그룹→일평균, day 오름차순 정렬.

### 배선: `server/api.mjs::buildScorecard`

- 지평선(+1/+3/+7) 블록에 `sharpe` 필드 추가(해당 지평선 retN 분포 기준 `sharpe()`).
- 최상위 `risk` 블록 신설:
  ```js
  risk: {
    scorecard: { mdd, sharpe, n },  // dailyPortfolioReturns(eps, 1) 기준
    strategy:  { mdd, sharpe, n },  // strategyReturns(eps) 기준
  }
  ```
  각 `n`은 곡선에 들어간 관측치 수. n<2면 mdd·sharpe는 null.

### 표면

- 봇 `lib/bot-commands.mjs`: `formatScorecard`에 MDD·샤프 줄, `formatStrategy`에 MDD·샤프 줄.
  (telegram-bot.mjs가 risk 블록을 포맷터에 전달)
- 대시보드 스코어카드 카드: MDD·샤프 표기 행 추가.

## 정직성 원칙

- **샤프 per-trade**: 연율화하지 않음. 라벨에 명시. 연율화 가정으로 과대포장 금지.
- **MDD는 실현 곡선에서만**: pending/no-data 제외.
- **+1일 비중첩만 MDD**: +7일 곡선은 픽이 겹쳐 실제 매매곡선이 아니므로 MDD 산출 제외.
  +3/+7일은 분포 샤프(지평선 블록)만 제공.
- **계산 불가는 `-`**: n<2·표준편차0 등은 null → UI/봇에서 `-`. 가짜 0% 금지.

## 에러 처리

- 빈 입력·전부 null 수익 → 지표 null, 표면은 `-`.
- `strategyOutcome`/`retN` 누락 에피소드는 조용히 스킵(집계에서 제외).
- 부동소수 표준편차 0 판정은 `=== 0` 대신 `< 1e-12` 임계로.

## 테스트

- **perf-metrics 단위**:
  - `equityCurve([0.1,-0.2,0.05])` → `[1.1, 0.88, 0.924]`
  - `maxDrawdown([0.1,-0.2,0.05])` → mdd `0.88/1.1 - 1 = -0.2` (peakIdx 0, troughIdx 1)
  - `sharpe([0.1,-0.2,0.05])` → 평균 -0.01667 / 표본std, 수동검산값
  - 엣지: `[]`→null, `[0.05]`(n<2)→null, `[0.03,0.03]`(std0)→null
  - `strategyReturns`/`dailyPortfolioReturns` 정렬·그룹 픽스처
- **buildScorecard 통합**: strategyOutcome(sl/tp/time)+retN 픽스처 → `risk.scorecard`·`risk.strategy`·지평선 `sharpe` 검증.

## 범위 밖 (YAGNI)

- 연율화 샤프, 소르티노, 칼마 등 파생 지표.
- +3/+7일 MDD(중첩 곡선).
- 볼린저·winsorize 재작업(이미 구현됨).
