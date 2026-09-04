# 구조 리스크 스크린 (#3) 설계

코인 네이티브 신호 3종 중 마지막. 물량 잠김(언락 오버행)·거래소 유의지정 등 구조
리스크로 매수 점수를 **감점**하는 방어 스크린. **소폰(-86%) 재발 방지**가 목적.

**목표:** 소폰형 함정(유통물량 절반 이상 잠김 + 거래소 유의 + 차트 붕괴)을 점수 감점 +
플래그로 걸러 사용자가 피하게 한다. 순수 TA는 기술적 셋업만 보고 구조를 못 봐서 소폰을
놓쳤음([[coin-sophon-structural-risk]]) — 그 축을 메운다.

## 핵심 결정 (brainstorming 확정)

1. **기존 데이터 결합** — 새 소스 없음. 이미 받는 coingecko(circRatio·athChangePct·rank) +
   거래소 지정(warnOf). 정밀 언락 날짜는 유료라 제외, 언락 "오버행"(circRatio)이 더 핵심.
2. **감점만** — 구조리스크 배수로 점수만 깎음. 매수목록 제외는 안 함(최종 판단 사용자).

## 리스크 모델

감점은 "진짜 구조 리스크" 2개에 집중(정상 베스팅 과제외 방지):

| 요소 | 조건 | mult |
|---|---|---|
| 언락 오버행 (circRatio) | < 0.3 | 0.85 |
| | 0.3 ~ 0.5 | 0.93 |
| | ≥ 0.5 or null | 1.0 |
| 거래소 주의 (caution) | 지정 | 0.90 |
| | 미지정 | 1.0 |

**mult = 두 배수의 곱, 하한 캡 0.7.** (소폰 예: circRatio 0.41 → 0.93, caution 겹치면
0.93×0.90 = 0.837.)

### 컨텍스트 플래그 (감점 없음 — 표시만)
- `ATH −90%↓`: athChangePct ≤ −90 → 차트 붕괴. 단독 감점 X(약세장 알트 과제외 방지).
- `저순위 N위`: rank > 500 → 무명. 단독 감점 X.
- 언락/주의 감점과 겹치면 소폰 패턴으로 강조.

## 아키텍처

### `lib/structural-risk.mjs` (신규, 순수)
- `structuralRisk({ circRatio, athChangePct, rank, caution }) -> { mult, flags, level }`
  - flags: 사람이 읽는 라벨 배열 (`'언락오버행(유통 41%)'`, `'거래소 주의'`, `'ATH −97%'`, `'저순위 946위'`)
  - mult: 감점 배수(위 표, 곱, 하한 0.7). 감점 요소 없으면 1.
  - level: `'none' | 'low' | 'mid' | 'high'` (mult 기반: 1→none, ≥0.9→low, ≥0.8→mid, else high)
- 상수: `OVERHANG_SEVERE = 0.3`, `OVERHANG_ELEVATED = 0.5`, `MULT_FLOOR = 0.7`,
  `ATH_BROKEN = -90`, `RANK_OBSCURE = 500`.

### 통합 (scripts/monitor.mjs)
- 루프에서 기존 `cg.byMarket[market]`(circRatio·athChangePct·rank) + `warnOf[market]`로
  `structuralRisk(...)` 호출(새 fetch 없음).
- `finalBuyScore *= sr.mult` + 감점 발생 시 시그널(`⚠️구조리스크(언락오버행·거래소주의)`).
  **배수군 위치**(펀딩·추격·dominance와 같은 곳, 지속성 보너스 가산 전).
- `item.structuralRisk = { mult, flags, level }` (mult<1 또는 flags 있을 때).

## 표면

- 시그널 라벨 → 스코어카드 에피소드가 자동 기록(효과 추적).
- 알림(monitor): 코인 블록에 `⚠️ 구조리스크: {flags}` 줄. signal-format 분류 추가.
- 대시보드: 매수표에 구조리스크 배지(level 색). 봇 `/코인`: 구조리스크 줄.
- API: item.structuralRisk 그대로 노출(buildResults가 buy 아이템 통과).

## 에러 처리

- circRatio/athChangePct/rank null(coingecko 미커버) → 해당 요소 무시(감점 없음).
- 전 요소 없음 → mult 1, flags [], level 'none'. 스캔 무중단.

## 정직성

- **circRatio 낮음 자체는 죄 아님**(정상 베스팅 많음) → 감점 modest + 컨텍스트 플래그 분리.
  진짜 방어는 **조합 표시**(언락+주의+붕괴)로 소폰형 함정 회피.
- 감점만(제외 X) — 최종 판단 사용자. 점수 신호라 스코어카드로 효과 검증.
- 소폰은 이미 청산·진입금지 — 이건 **다음 소폰 예방**.

## 테스트

- `structuralRisk`:
  - 소폰형(circRatio 0.41, caution) → mult 0.837, flags에 언락오버행·거래소주의, level mid.
  - 심각 언락(circRatio 0.2) → 0.85, 정상(circRatio 1, 무지정) → mult 1 level none.
  - 경계값(0.3, 0.5), 하한 캡(다중 감점 → 0.7 이하로 안 내려감).
  - null 안전(circRatio null → 감점 없음).
  - 컨텍스트만(ATH −95%, rank 900, circRatio 0.8, 무지정) → mult 1(감점 없음) + flags에 표시.

## 범위 밖 (YAGNI)

- 실제 언락 날짜 캘린더(유료), 체인이전·입출금중단 실시간 감지(뉴스 파싱), 매도 개입.
- #2b OI.
