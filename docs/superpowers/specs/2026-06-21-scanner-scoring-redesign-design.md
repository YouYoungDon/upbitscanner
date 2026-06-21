# 스캐너 점수 로직 재설계 — 거래량 등급화·유동성 차등·지속성

**작성일:** 2026-06-21

**목표:** 검증된 핵심 예측변수(거래량 크기·유동성·지속성)를 스캔 점수에
제대로 반영해, 이번 주 실전 실패(왁스 1회성 점화, 게임빌드/파워렛저 저유동성)를
구조적으로 줄인다.

**배경:** 현재 코드는 거래량을 2배 이상 무조건 +1로 납작하게 처리(바운드리스
25.5배 적중 = 거래량 크기가 단일 최고 예측인자인데 정보가 버려짐), 저유동성
페널티가 ×0.9 단일 컷(4억과 400억 차이가 10%), 지속성(반복 등장+거래량 유지)은
저널 분석에만 있고 점수엔 0 반영이다.

**범위:** 아래 3개 항목. 가중치 학습 저유동성 제외·시장심리 정규화는 다음 사이클.

---

## 1. 거래량 등급화

**파일:** `lib/signals.mjs` (수정)

현재 거래량 블록(`volR >= 2` → +1 고정)을 계단형 등급으로 교체한다.

| 거래량 배율(volR) | 기본 점수 |
|------------------|----------|
| 2x ~ 5x          | +1        |
| 5x ~ 10x         | +2        |
| 10x ~ 20x        | +3        |
| 20x+             | +4        |

- 라벨은 `거래량 급증 (Nx)` 형식 유지 → `keyOf` 접두어 매칭·주간 EWM 학습 그대로 작동.
- **`up` 조건 강화:** 현재 `close ≥ 직전 close`(0.1%도 통과) → **당일 종가가 직전 종가 대비 +2% 이상**일 때만 매수 거래량으로 인정. 미달이면 거래량 신호 부여 안 함(미지근한 점화 배제).
- 매도 측 거래량 급증도 동일 등급화(대칭). 단 매도는 `up`이 거짓(하락)일 때 부여하는 기존 의미 유지.
- **콤보 배수 비례:** `applyCombos`의 거래량확인 보너스를 고정 ×1.3에서 배율 구간 비례로:
  - 최고 거래량 배율 2~10x → ×1.3
  - 10~20x → ×1.45
  - 20x+ → ×1.6
- `applyCombos`가 배율을 알아야 하므로, `applyCombos` 시그니처에 최고 거래량 배율을 전달한다(예: `applyCombos(buy, sell, buyScore, maxVolRatio)`). `maxVolRatio`는 `detectSignals`가 계산해 반환값에 포함하거나 monitor가 전달.

**테스트(`__tests__/signals.test.mjs`):**
- volR 2/5/10/20 경계에서 각각 +1/+2/+3/+4 부여
- +2% 미달 상승 시 매수 거래량 신호 미부여
- 콤보 배수가 maxVolRatio 구간 따라 1.3/1.45/1.6 적용

---

## 2. 유동성 차등 감점 + 별도 분리

**파일:** `scripts/monitor.mjs`(감점·분리 로직), `lib/scan-universe.mjs`(상수)

### 2-A. 차등 감점

24h 거래대금(`tradePrice[market]`) 기준 구간별 배수. 곱셈 보정 단계에서 적용.

| 24h 거래대금       | 배수  |
|-------------------|-------|
| 50억 이상          | ×1.0  |
| 20억 ~ 50억        | ×0.9  |
| 5억 ~ 20억         | ×0.8  |
| 1억 ~ 5억          | ×0.6  |

- 유니버스 진입 컷(1억, `MIN_TRADE_PRICE_24H`)은 그대로 — 1억 미만은 스캔 대상 제외.
- 헬퍼 `liquidityMultiplier(tradePrice24h)` 추가(테스트 가능하도록 `lib/scan-universe.mjs`에 둠).

### 2-B. 별도 분리

- 데이터 구조는 단일 `buy` 배열 유지 + 종목별 `lowLiquidity` 플래그 사용(아카이브 호환 유지). 분리는 **출력단의 표시 책임**.
- 저유동성 기준선: `LOW_LIQUIDITY_24H` 기존 3억 → **5억**으로 상향. `lowLiquidity = tradePrice24h < 5억`.
- **Telegram:** 메인 매수(유동성 5억+)만 상위 5개. 저유동성은 `⚠️ 저유동성 후보 N개` 한 줄 요약.
- **대시보드 추천 탭(`server/api.mjs` + `public/app.js`):** 메인 / 저유동성 섹션 분리 렌더. 거래량 배율·지속성 라벨 노출.

**테스트:**
- `__tests__/scan-universe.test.mjs`: `liquidityMultiplier` 구간 경계(5억/20억/50억) 배수
- api 빌더가 buy를 메인/저유동성으로 가르는지(`__tests__/api.test.mjs`)

---

## 3. 지속성 모듈

**파일:** `lib/persistence.mjs`(신규), `scripts/monitor.mjs`(통합)

직전 스캔 이력을 입력받아 지속성 점수를 산출하는 순수 함수 모듈.

### 인터페이스

```
appearanceStreak(market, priorScans) → number
  // priorScans: 최근→과거 순 또는 과거→최근 순(구현에서 명시). 각 원소는 { buy: [{market,...}] }.
  // 최근 스캔부터 연속으로 buy에 market이 있던 횟수.

scorePersistence({ market, hasVolumeSurge }, priorScans) → { bonus, signals }
```

### 점수 규칙

| 조건 | bonus | 라벨 |
|------|-------|------|
| 직전 스캔들에 3회 이상 연속 등장 | +2 | `🔥지속 매수권 (3회+)` |
| 2회 연속 등장 | +1 | `지속 매수권 (2회)` |
| 이번 + 직전 스캔 모두 거래량 급증 | +1 | `거래량 지속` |
| 직전엔 거래량 급증, 이번엔 소멸 | 0 (경고) | `⚠️거래량 소멸 (1회성)` |

- 연속 등장 보너스는 streak 3회+ 와 2회를 **중복 적용하지 않음**(둘 중 하나).
- "거래량 소멸"은 감점하지 않음(거래량 점수가 이미 빠져 이중차감 방지) — 경고 라벨만.
- 거래량 지속 판정: 직전 스캔의 해당 종목 buy 항목 signals에 `거래량 급증` 포함 여부로 확인.
- 빈 `priorScans`(첫 스캔)면 `{ bonus: 0, signals: [] }` 안전 반환.

### monitor 통합

- 현재 monitor는 스캔 루프 **뒤**에서 monitor-log를 읽음 → **루프 앞으로 이동**해 `log.scans`를 priorScans로 확보.
- 종목별 매수 확정 직후 `scorePersistence` 호출, bonus를 **곱셈 보정·SMC 가산 모두 끝난 마지막**에 더하고 라벨을 signals에 추가.
- priorScans는 monitor-log(최근 30) 기준.

**테스트(`__tests__/persistence.test.mjs`, 신규):**
- 2회 연속 → +1, 3회 연속 → +2(중복 없음)
- 거래량 지속(이번+직전 급증) → +1
- 거래량 소멸(직전 급증, 이번 미발) → 경고 라벨, bonus 0
- 빈 이력 → bonus 0, 라벨 없음

---

## 점수 합성 순서 (monitor.mjs 최종)

```
1. detectSignals (거래량 등급화 반영)   → 기본 점수
2. detectPatterns                       → 패턴 가산
3. applyCombos (거래량 배수 비례)        → ×콤보
4. MTF 4h Stoch GC                       → ×1.2
5. SMC (스윕/V-Bottom/Pump)              → 가산
6. 레짐 게이트 (BTC 약세)                → ×0.85
7. 유동성 차등 감점 (구간별)             → ×0.6~1.0
8. 지속성 보너스 (이력)                  → +1~+3 가산  (신규, 마지막)
```

곱셈 보정을 먼저 다 적용한 뒤 SMC·지속성 같은 가산을 더하는 기존 패턴을 유지한다.

---

## 검증 (선택)

누적 archive(20스캔)에 새 점수 로직을 소급 적용해, 왁스(1회성·저유동성)와
바운드리스형(거래량 폭발+지속)이 의도대로 차등되는지 1회 확인. 정식 백테스트
스크립트는 아니고 일회성 점검.

## 회귀

기존 112 테스트 통과 유지 + monitor 라이브 1회 실행으로 통합 확인.

## 파일 변경 요약

- **수정:** `lib/signals.mjs`(거래량 등급+콤보 배수+maxVolRatio 반환), `scripts/monitor.mjs`(유동성 차등·지속성 통합·log 선읽기), `lib/scan-universe.mjs`(LOW_LIQUIDITY_24H 5억·liquidityMultiplier), `server/api.mjs`+`public/app.js`(메인/저유동성 분리 표시), `lib/notify.mjs` 또는 monitor의 notifyTelegram(저유동성 요약)
- **신규:** `lib/persistence.mjs`, `__tests__/persistence.test.mjs`
