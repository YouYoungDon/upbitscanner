# 펀딩비 점수 신호 (#2) 설계

코인 네이티브 신호 3종 중 둘째. 바이낸스 무기한선물 펀딩비를 단기 반전 신호로
**매수 점수에 개입**. (#1 김치프는 표시 전용, #2는 점수 개입 — 사용자 결정.)

**목표:** 붐빈 롱(과열 펀딩) 자리 진입을 억제하고, 숏 과밀(음수 펀딩) 스퀴즈 연료를
반등픽에 반영. 순수 TA의 약한 엣지([[user-motivation-recovery]])를 코인 고유 포지셔닝
신호로 보강.

## 핵심 결정 (brainstorming 확정)

1. **전면 점수 개입** — 펀딩비가 매수 점수를 직접 조정(배수).
2. **펀딩비만** — OI(미결제약정)는 심볼별 N콜+델타 인프라 필요라 #2b로 연기.
3. **방향(매수 스캐너 기준)**: (+)펀딩=롱 과밀→감점, (−)펀딩=숏 과밀 스퀴즈연료→가산.

## 아키텍처 (#1 바이낸스 통합 재사용)

### `lib/binance.mjs` 확장
- `fetchFundingRates({ timeoutMs }) -> Map<symbol, { rate, markPrice }> | null`
  `/fapi/v1/premiumIndex` 1콜 → 전체 USDT 무기한 심볼. `lastFundingRate`(정산된 최근
  8h 펀딩) → rate. 실패/비배열 → null.

### `lib/funding.mjs` (신규, 순수 + 조회)
- `fundingScoreMult(rate) -> number`  점수 배수(비대칭). rate null → 1.
- `fundingSignal(rate) -> string | null`  `'⚡펀딩 과열'|'⚡펀딩 경계'|'⚡펀딩 스퀴즈연료'|'⚡펀딩 스퀴즈연료(강)'|null`.
- `ensureFunding(markets, { now, deps }) -> { byMarket:{market:{rate,markPrice}}, medianRate, coverage, fetchedAt, reason? }`
  `mapToBinance`(kimchi에서 export) 재사용. 어떤 실패에도 neutral(스캔 불사침).

### 점수 배수 (비대칭 — 방어>공격)

| 펀딩(8h) rate | mult | signal |
|---|---|---|
| ≥ +0.0010 | 0.82 | ⚡펀딩 과열 |
| +0.0005 ~ +0.0010 | 0.92 | ⚡펀딩 경계 |
| −0.0005 ~ +0.0005 | 1.00 | (null) |
| −0.0010 ~ −0.0005 | 1.04 | ⚡펀딩 스퀴즈연료 |
| ≤ −0.0010 | 1.06 | ⚡펀딩 스퀴즈연료(강) |

경계는 하한 포함(≥, ≤). 감점 세게(0.82), 가산 약하게(≤1.06) — 크롱된 롱 반전 회피가
스퀴즈 베팅보다 신뢰도 높음.

### 상수 (lib/funding.mjs)
`FUND_EXTREME = 0.0010`, `FUND_ELEVATED = 0.0005`. 배수는 위 표.

## 데이터 흐름 (scripts/monitor.mjs)

- 스캔 루프 **전에** `ensureFunding(targets)` 1회(cg처럼 루프 밖 fetch).
- 루프 안 마켓별: `const fm = fundingScoreMult(funding.byMarket[market]?.rate)`;
  `finalBuyScore *= fm`; 신호 있으면 `buySignals` 추가. **기존 배수군(추격·레짐·유동성·
  dominance)과 같은 위치 — 지속성 보너스 가산 전.**
- 매수 아이템에 `item.funding = { rate, mult }`(mult≠1일 때). 스캔 엔트리에
  `entry.funding = { medianRate, coverage }`.
- 매도 점수엔 미개입(매수 스캐너).

## 표면

- 점수 신호라 `signals[]`에 `⚡펀딩...` 라벨 → 스코어카드 에피소드가 자동 기록(효과 추적).
- 알림(monitor notifyTelegram): 코인 블록에 펀딩 라인(mult≠1), 시장 라인에 중앙 펀딩 게이지.
- `/api/results` 엔트리에 `funding` + 매수 아이템 `funding` 노출(buildResults).
- 대시보드: 코인별 펀딩 배지 + 시장 펀딩 KPI. 봇 `/status` 펀딩 게이지 줄.

## 에러 처리

- 바이낸스 조회 실패 → 전부 rate 없음 → mult 1(무개입), coverage 0. 스캔 무중단.
- 미상장 심볼 → 해당 마켓 funding 없음(coverage 집계).
- rate 비유한 → mult 1.

## 정직성

- 배수 비대칭(감점>가산), 가산 단독으로 나쁜 픽 승격 불가(약한 캡).
- **점수 신호이므로 스코어카드로 효과 검증 가능** — 향후 배수 재보정([[scanner-weight-recalibration-2026-07]] 선례).
- 펀딩은 단기(8h) 신호, 추세 반전 확정 아님. 극단 (−)펀딩은 falling-knife 가능 — 기존
  fallingKnifePenalty가 방어.

## 테스트

- `fundingScoreMult`: 경계값(+0.0010→0.82, +0.0005→0.92, 0→1.0, −0.0005→1.04, −0.0010→1.06),
  null→1.
- `fundingSignal`: 라벨 매핑 + 정상대(무신호).
- `ensureFunding`(fetch 목킹): coverage·medianRate(홀/짝수)·null·미상장 제외·neutral.

## 범위 밖 (YAGNI)

- OI(미결제약정) — #2b.
- 매도 점수 개입.
- 펀딩 히스토리/추세, 예측 펀딩(다음 정산 예상).
- #3 언락(별도 스펙).
