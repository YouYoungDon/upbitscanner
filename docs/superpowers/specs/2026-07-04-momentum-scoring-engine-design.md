# Momentum Scoring Engine — Subsystem A 설계 (2026-07-04)

## 상태
승인됨(2026-07-04). 이 문서는 전체 스코어링 재설계의 **subsystem A(피처 엔진 + 스코어링 코어)**만 다룬다.
B(outcome tracking) · C(5-state regime) · D(empirical confidence) · E(orderbook features)는 별도 스펙.

## 배경 / 목적
현재 `lib/signals.mjs`는 규칙 기반 신호 합산(base×weight + 콤보)이다. 이를 **가중 스코어링 엔진**으로 진화시켜,
가격 급등 **전**에 자본 유입이 시작되는 코인을 조기 포착한다. 핵심 원칙: **조기(pre-move) 편향, 후행 신호 회피.**

## 스코프 (subsystem A, v1)
- **스코어링 피처 10개**를 이미 가져오는 **일봉(daily candle)** 위에서 계산 → **신규 API 호출 0** (라이브 시스템 안전).
- **쉐도우 모드**: 기존 `signals.mjs` 출력은 절대 변경하지 않는다. 새 스코어링은 archive에 **병렬 저장만** 한다.
- **15개 중 분류**: 10개 = 0~100 스코어링 피처(아래) · **BTC Market Regime + Time-of-day Effect = 0~100 피처가 아니라 multiplier**로 처리 · **Orderbook Imbalance / Bid-Ask Pressure / Spread(3종) = Phase E로 연기**(신규 API·실시간 전용·백테스트 불가). → 10 + 2(multiplier) + 3(deferred) = 15.
- **연기(deferred)**: orderbook 3종(Phase E) · intraday/5m~4h 추적(Phase B) · empirical confidence(Phase D) · 완전한 5-state regime(Phase C, v1은 기존 bull/bear/neutral을 regime multiplier로 사용).

## 목표 커버리지
1 가중 엔진 ✓ · 2 피처 레이어 ✓(**10/15** 스코어링 + regime·time을 multiplier로) · 3 0~100 정규화 ✓ · 4 configurable weights ✓ · 5 plugin 확장성 ✓ ·
6 confidence(v1 heuristic → B 이후 empirical) ✓ · 8 regime multiplier 적용(완전 5-state = Phase C) · 9 tier ✓ · 10 조기편향(dual score + extension penalty) ✓ ·
7 = Phase B · orderbook = Phase E.

---

## 아키텍처

```
lib/scoring/
  context.mjs        FeatureContext 빌더 (coin 캔들·ticker, universe 통계, BTC regime, time-of-day)
  normalizers.mjs    percentileVsUniverse · vsOwnHistory · fixedCurve  → 모두 0~100 반환
  features/
    index.mjs        plugin registry (배열)
    relativeTradingValue.mjs   (early)
    moneyAcceleration.mjs      (early)
    relativeVolume.mjs         (early)
    consolidation.mjs          (early)
    volCompression.mjs         (early)
    absTradingValue.mjs        (early, quality-guard)
    liquidity.mjs              (early, quality-guard)
    breakoutStrength.mjs       (confirm)
    trendAlignment.mjs         (confirm)
    volExpansionOnBreakout.mjs (confirm)
  config.mjs         scoring-config.json 로더 + 검증
  engine.mjs         two-pass 실행 → dual composite → extension penalty → confidence/contextLabel → tier
scoring-config.json  weights, group membership(source of truth), tier cutoffs, regime/time multipliers, thresholds
```

### 설계 원칙
- 각 유닛은 단일 책임: normalizer는 순수함수, feature는 raw 계산만, engine은 조립만.
- feature는 `compute(ctx) → raw`만 담당. 정규화·가중·그룹핑은 engine이 config 기준으로 수행.

---

## 피처 plugin contract

각 feature 파일의 default export:
```js
export default {
  name: 'relative_volume',
  defaultGroup: 'early',            // config에 group 없을 때만 fallback (§group source of truth)
  normalizer: 'percentileVsUniverse',
  params: { window: 20 },           // normalizer/compute 파라미터
  compute(ctx) { return rawValue }  // 숫자 raw. 계산 불가 시 null 반환(throw 금지 권장)
}
```
- **신규 feature = `features/`에 파일 추가 + config에 weight 등록.** (goal 5)
- `compute`는 캔들 부족·데이터 이상 시 **null** 반환(엔진이 제외 처리). 예외를 던지면 엔진이 잡아 해당 feature만 null 처리.

### group source of truth (수정 6)
- **최종 그룹 판정은 `scoring-config.json`의 group membership.**
- plugin의 `defaultGroup`은 config에 해당 feature group이 없을 때만 fallback.
- config에 명시된 group이 `early|confirm`가 아니면 검증 단계에서 에러(§config validation).

---

## Normalizers (모두 0~100 반환)

| 이름 | 용도 | 방식 |
|------|------|------|
| `percentileVsUniverse` | 'Relative' 계열 (rel trading value, rel volume) | 이번 스캔 유니버스 raw 분포 대비 백분위 |
| `vsOwnHistory` | money accel, vol compression | 코인 자기 과거 분포 대비 백분위/z (params.window) |
| `fixedCurve` | abs trading value, liquidity, spread(후속) | params.breakpoints 기반 계단/보간 |

- 모두 **입력 raw가 null/NaN이면 null 반환** (엔진이 제외). (수정 8)
- percentileVsUniverse는 유니버스 분포(§two-pass)를 ctx에서 받는다.
- **percentileVsUniverse는 inclusive percentile로 정의(의도적)**: `score = (raw 이하 개수 / n) × 100`. 따라서 유니버스 최솟값도 0이 아니라 `100/n`을 받는다(단독 최저값이 0점으로 죽지 않게). 동점은 모두 동일 백분위. (`(rank−1)/(n−1)` 배타적 방식 대신 이걸 채택.)

---

## FeatureContext (engine이 각 feature에 공급)

```js
ctx = {
  coin: { market, ohlcvDaily, ticker: { trade_price, acc_trade_price_24h } },
  universe: { dist: { [featureName]: sortedRawArray } },  // pass2에서 percentile용 (§two-pass)
  market: { btcTrend: 'bull'|'bear'|'neutral' },
  timeOfDayHourKST: 0..23,
  history: /* 코인 자기 과거값 — ohlcvDaily에서 파생 */,
}
```

---

## 데이터 흐름 (two-pass — percentile normalizer에 필수)

1. **Pass 1**: 유니버스 전 코인에 대해 각 feature `compute(ctx)` → raw 수집.
2. percentile 계열 feature의 **유니버스 분포** 구성 (`universe.dist[featureName]`).
3. **Pass 2**: 각 코인 raw를 선언된 normalizer로 0~100 정규화.
4. **null 처리**: raw가 null이거나 정규화가 null이면 해당 feature는 **가중평균에서 제외**하고 weight도 분모에서 뺀다. (수정 8)
5. `earlyScoreRaw` = EARLY 그룹 feature normalized의 (null 제외) 가중평균.
6. `confirmScore` = CONFIRM 그룹의 가중평균.
7. **extension penalty**(engine-level) 적용 → `earlyScoreAfterExtension = earlyScoreRaw × (1 − extensionPenalty)`.
8. **multiplier 적용(v1에서 실제 곱함)**: `earlyScore = clamp(earlyScoreAfterExtension × regimeMultiplier × timeMultiplier, 0, 100)`.
   - `regimeMultiplier`: config `regimeMultiplier[btcTrend]` (bull 1.1 / neutral 1.0 / bear 0.9). **v1 적용.**
   - `timeMultiplier`: v1은 **1.0 고정**(Time-of-day = Phase 확장 seam). config `timeMultiplier`는 구조만 준비.
9. **tier는 최종 `earlyScore` 기준**으로만 결정. `confirmScore`는 tier 불변, contextLabel에만 사용.

---

## Dual score & extension penalty (수정 1·2)

- `earlyScoreRaw` : 조기유입 그룹 가중평균 (penalty·multiplier 적용 전).
- **`extensionPenalty`** : **engine-level penalty (feature 아님)**, 범위 `0~1`. EMA20 대비 stretch가 클수록 커짐.
- `earlyScoreAfterExtension = earlyScoreRaw × (1 − extensionPenalty)`.
- `regimeMultiplier` · `timeMultiplier` (v1: time=1.0).
- **`earlyScore` (최종, tier 기준) = clamp(earlyScoreAfterExtension × regimeMultiplier × timeMultiplier, 0, 100)`.**
- `confirmScore` : 돌파확인 그룹 가중평균.
- **archive에 아래 6개를 분리 저장** (수정 2·7): `earlyScoreRaw` · `extensionPenalty` · `earlyScoreAfterExtension` · `regimeMultiplier` · `timeMultiplier` · `earlyScore`.

### tier (earlyScore 기반, 수정 1)
config `tierCutoffs`로 결정 (예시): `S ≥ 85 · A ≥ 70 · B ≥ 55 · C ≥ 40 · (미만은 무티어/제외)`.
`confirmScore`는 tier를 바꾸지 않는다.

### contextLabel (수정 1)
`earlyScore`·`confirmScore`를 config threshold(`earlyHigh`, `confirmHigh`)로 조합:
| earlyScore | confirmScore | contextLabel |
|-----------|-------------|--------------|
| ≥ earlyHigh | < confirmHigh | `early_inflow_unconfirmed` (이상적 '전' 상태) |
| ≥ earlyHigh | ≥ confirmHigh | `early_inflow_with_confirmation` |
| < earlyHigh | ≥ confirmHigh | `breakout_already_confirmed` (후행) |
| < earlyHigh | < confirmHigh | `weak_signal` |

---

## Confidence (object, 수정 3)

v1은 **heuristic**. 구조는 empirical 교체를 염두에 둔다(Phase D).
```js
confidence: {
  type: 'heuristic',          // 후속: 'empirical'
  label: 'high'|'medium'|'low',
  reasons: [
    '5 early features above 70',
    'extension penalty low',
    'liquidity sufficient',
  ],
}
```
- 판정 인자: (a) 70 초과 early feature 개수, (b) extensionPenalty 낮음, (c) **quality-guard를 개별 판정**(수정 5) — `liquidity ≥ 40 → 'liquidity sufficient'`, `absTradingValue ≥ 40 → 'absolute trading value sufficient'`, **둘 다 낮으면** confidence 하향, (d) **coverage**(정상 계산된 feature 비율).
- **coverage가 낮으면 confidence를 낮춘다/캡한다.** (수정 8)
- reasons에는 두 quality guard를 **구분해서** 남긴다(어느 쪽이 충분/부족인지 디버깅 가능).

---

## Quality guard: liquidity · absTradingValue (수정 4)

- 둘 다 **early group에 두되 초입 신호가 아니라 품질 가드** 성격.
- **v1: 하드 필터로 자르지 않고 낮은 weight로 반영.**
- 구조는 나중에 **tier cap / filter**로 전환 가능하게 열어둔다(config 플래그 `qualityGuard: true` + 미래 `mode: 'weight'|'cap'|'filter'`).

---

## Config (`scoring-config.json`) + 검증

```jsonc
{
  "version": "scoring-v1",
  "weights": { "relative_volume": 1.0, "money_acceleration": 1.2, ... },
  "groups":  { "relative_volume": "early", "breakout_strength": "confirm", ... },  // source of truth
  "tierCutoffs": { "S": 85, "A": 70, "B": 55, "C": 40 },
  "thresholds": { "earlyHigh": 70, "confirmHigh": 60, "extensionLow": 0.15 },
  "regimeMultiplier": { "bull": 1.1, "neutral": 1.0, "bear": 0.9 },
  "timeMultiplier": { "0": 1.0, ... , "23": 1.0 },
  "qualityGuard": { "liquidity": { "mode": "weight" }, "abs_trading_value": { "mode": "weight" } }
}
```

### config validation (수정 8)
- **음수 weight 금지** → 에러.
- registry에 **없는 feature의 weight** → 경고.
- **group 충돌 방지**: group 값이 `early|confirm` 외면 에러. registry에 있으나 config group 없으면 plugin `defaultGroup` fallback + 경고.
- tierCutoffs 단조성(S>A>B>C) 위반 시 경고.

---

## Archive 저장 구조 (디버깅 친화, 수정 7)

**저장 범위**: 엔진은 percentile 정규화를 위해 **전 유니버스(~250)를 계산**하지만, archive에는 **surfaced 후보만 저장**한다 — 기존 `buy` 후보 ∪ `earlyScore` 상위 top-N(config `archiveTopN`, 기본 20). 250개 전부 저장 시 archive 비대 방지. (스캔 레벨에는 요약 `scoringMeta: { universeSize, coverageAvg }`도 남긴다.)

기존 archive 엔트리(`buy`/`sell`/`regime`)는 **그대로 두고**, 위 후보 코인별로 `scoring` 필드를 병렬 추가:
```js
scoring: {
  version: 'scoring-v1',
  earlyScoreRaw,               // penalty·multiplier 전
  extensionPenalty,            // 0~1
  earlyScoreAfterExtension,    // = earlyScoreRaw × (1 − extensionPenalty)
  regimeMultiplier,            // v1 적용
  timeMultiplier,              // v1 = 1.0
  earlyScore,                  // 최종(tier 기준) = clamp(afterExtension × regimeMult × timeMult, 0, 100)
  confirmScore,
  tier,                        // earlyScore 기반
  contextLabel,
  confidence: { type, label, reasons },
  features: {
    [featureName]: { raw, normalized, group, weight, normalizer },
  },
}
```
- 실패 시(§shadow fallback) `scoring` 대신 `scoringError` 기록.

---

## Shadow mode 통합 + fallback (수정 8)

- `monitor.mjs`는 **이미 가져온 동일 캔들**로 새 엔진을 **추가 실행**(신규 API 0). 기존 `detectSignals` 출력·흐름은 **불변**.
- archive에 새 `scoring` 필드를 병렬 저장. 사용자 노출 화면은 신·구 비교 검증 전까지 **변경 없음**.
- **fallback**: 새 엔진이 throw해도 **기존 output은 그대로 유지**되고, 해당 코인/스캔에 **`scoringError: { message }`**만 남긴다. 새 스코어링 실패가 라이브 스캔을 절대 깨뜨리지 않는다.
- old scoring(`signals.mjs`)은 **fallback으로 영구 유지**.

---

## 엣지/에러 처리

- feature raw **null/NaN** → 해당 feature 제외(가중평균 분모에서도 제외).
- **캔들 부족**(예: `ohlcvDaily.length` < feature 최소요건) → 그 feature만 null(제외 또는 fallback).
- **coverage 낮음** → confidence 하향.
- 새 엔진 예외 → shadow fallback(scoringError), 기존 output 유지.

---

## 테스트 계획 (TDD)

**정규화/피처/엔진 기본**
- normalizer 3종 경계값(percentile 0/50/100, z, fixedCurve breakpoints).
- 각 feature.compute: 합성 캔들에서 결정적 raw.
- engine: dual composite 수학, extension penalty 적용, tier 배정, contextLabel 매트릭스, confidence 판정.
- two-pass 유니버스 정규화: 소규모 합성 유니버스.

**견고성 (수정 8)**
- missing raw / null / NaN 처리 → feature 제외.
- 캔들 부족 → feature 제외 또는 fallback.
- weighted average에서 null feature 제외(분모 재정규화).
- coverage 낮으면 confidence 하향.
- config validation: 음수 weight 거부 · 없는 feature weight 경고 · group 충돌 방지 · tierCutoffs 단조성.
- shadow mode fallback: 새 엔진 throw → 기존 output 유지 + archive `scoringError` 기록.

---

## 롤아웃

1. 새 모듈·config를 쉐도우로 배포(기존 출력 불변).
2. 며칠간 archive의 `scoring` vs 기존 buy/sell·실제 가격을 비교.
3. subsystem B(outcome tracking)로 신/구 우위 정량 검증.
4. 검증 후 monitor 표시를 새 엔진으로 전환(별도 결정).

## 미래 seam
- confidence `type: 'heuristic' → 'empirical'` 교체 지점(Phase D).
- quality guard `mode: 'weight' → 'cap'/'filter'` 전환(config).
- feature registry에 orderbook 3종 추가(Phase E).
- regime multiplier를 5-state 분류로 확장(Phase C).
