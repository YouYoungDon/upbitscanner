# 신호 신뢰도 개선 — 설계

작성일: 2026-07-13

## 배경

업비트 스캐너의 신호 신뢰도를 떨어뜨리는 구조적 문제 2건과, 코드리뷰에서 발견된 버그 4건, git 위생 1건을 함께 고친다.

- **미확정 캔들 판정(H1, 최우선 백로그)**: 일봉 신호가 오늘 아직 안 닫힌(형성 중) 캔들 기준으로 계산된다. `getDayCandles(200)`의 마지막 캔들은 오늘 봉이고, `candlesToOhlcv(...).at(-1)`로 모든 지표를 계산 → 09:00에 뜬 골든크로스가 종가에 사라질 수 있음. 시커·게임빌드 손절의 구조적 원인. `flow-scan.mjs`는 이미 `.slice(0, -1)`로 형성봉을 제외하지만(분봉), 일봉 신호 경로엔 미적용.
- **가중치 학습이 수익 크기 무시**: `ewmTarget`이 적중률만 3구간 계단(≥70→1.5 / ≥50→1.0 / <50→0.7)으로 보고, `avgReturn`을 무시. 55% 승률 +22% 수익 신호와 60% 승률 +0.1% 신호를 비슷하게 취급. `MIN_SAMPLES=3`으로 노이즈에도 민감.

## 목표

1. 일봉 신호를 **확정(닫힌) 캔들** 기준으로 판정 — 전 일봉 경로 일관 적용.
2. 가중치 학습이 **적중률 + 수익 크기**를 함께 보상(변동성 신호 과대평가 방지 클램프).
3. 코드리뷰 버그 4건 수정.
4. 가중치 파일 git 드리프트 정리.

## 비목표 (YAGNI)

- 분봉 자금유입(flow) 로직 변경 (이미 확정봉만 사용).
- 스코어링 엔진 B~E 단계.
- 학습 공식의 타임드(+1/3/7일) 적중률 반영 (이번엔 적중률+수익까지만).

### 보유기간 혼재 문제는 이번 스코프에 남음 (M7)

- 이번 #2는 **"적중률 + 평균수익" 반영까지만** 수행한다.
- 학습에 쓰는 `signalStats`가 current-price 기준 aggregate이므로, **보유기간 혼재(mixed horizon) 문제는 이번 작업에서 완전히 해결되지 않는다.**
- 이 문제는 **후속 작업에서 `+3일 고정 horizon` 기반 학습으로 교체**한다.
- 그 전까지 주간 리포트/검증 화면에 현재 방식이 **`current-price mixed horizon`** 임을 명시 표시한다(사용자가 한계를 인지하도록).

---

## #0 네트워크 안정성 (이미 구현됨 — 검증 + 테스트 갭 1건 보강)

> **중요(현재 코드 검증 결과)**: 2026-07-04 감사에서 H2/H3가 이미 반영되어, 아래 항목은 **코드도 테스트도 현재 존재**한다. 이 섹션은 "구현"이 아니라 "검증 + 미세 갭 보강"이다.

**이미 구현된 것 (검증 완료):**
- `lib/upbit.mjs::get()` — `return await r.json()`([upbit.mjs:9]), json() reject 시 try/catch→재시도 경로 진입, `AbortSignal.timeout(10_000)` 전달. 테스트 존재: `upbit.retry.test.mjs`(5xx 재시도 / 4xx 즉시포기 / json reject 재시도 / 소진 시 null / 10s signal 전달).
- `lib/notify.mjs::sendTelegram()` — `AbortSignal.timeout(5_000)`, 성공/실패 boolean 반환(`r.ok` / 토큰없음·예외 시 false). 테스트 존재: `notify.test.mjs`(토큰없음 false / 5s signal / non-2xx false / 2xx true).

**이번에 보강할 유일한 갭 (테스트 1건):**
- `get()`에서 **fetch가 AbortError(타임아웃 발화)를 throw하면 실제로 재시도**하는지 명시 테스트. 현재 테스트는 "signal이 전달되는지"만 확인하고, abort throw→retry 동작 자체는 미검증. `fetch` 목이 1회차 `AbortError` throw, 2회차 성공 → 최종 성공 + 호출 2회를 검증.

**결정 기록**: 사용자는 #0를 구현 항목으로 추가 요청했으나, 현재 코드를 검증한 결과 구현·테스트가 이미 존재하여 위와 같이 "검증 + 갭 테스트 1건"으로 축소함(없는 것을 새로 만들지 않음).

---

## #1 확정봉 판정

### 접근

신규 헬퍼를 **별도 유틸 `lib/ohlcv.mjs`** 에 둔다(API 클라이언트 `upbit.mjs`와 candle contract 혼재 방지):

```js
// lib/ohlcv.mjs — OHLCV 시계열 계약 유틸 (API 클라이언트와 분리)
//
// confirmedOhlcv 계약:
//   입력: candlesToOhlcv() 이후의 chronological(오래된 봉 → 최신 봉) 배열.
//   마지막 요소는 current forming candle(오늘/이번 봉)일 수 있으므로 신호 판정에서 제외한다.
//   반환: 마지막(형성 중) 봉을 뺀 확정 캔들 배열.
//   빈 배열/1개 배열/비배열 → [].
export function confirmedOhlcv(ohlcv) {
  return Array.isArray(ohlcv) && ohlcv.length > 1 ? ohlcv.slice(0, -1) : []
}

// 확정봉이 최소 min개 있는지 보장. 부족하면 null(호출부가 스킵).
export function ensureMinConfirmed(confirmed, min) {
  return Array.isArray(confirmed) && confirmed.length >= min ? confirmed : null
}
```

`candlesToOhlcv`(오름차순 변환, `upbit.mjs`에 유지)는 그대로 두고, **신호를 판정하는 지점에서만** `confirmedOhlcv`를 적용한다. 표시/차트용 전체 시계열은 유지.

> 주: `confirmedOhlcv`는 `length > 1`에서만 slice(0,-1) → 1개 배열도 `[]`(계약대로).

### 적용 지점

각 경로는 **fetch 개수를 +1** 하고(확정봉 제외 후에도 필요한 봉 수 확보), 신호 판정 입력에 `confirmedOhlcv`를 적용한다.

| 파일 | fetch 변경 | 판정 입력 변경 |
|------|------|------|
| `scripts/monitor.mjs` 메인 스캔 | `getDayCandles(market, 200)` → **201** | `detectSignals`/`detectPatterns`/`detectLiquiditySweep`/`detectVBottom`/`detectPumpStart` 입력을 `confirmedOhlcv(ohlcv)`로. `candleMap[market]=ohlcv`(전체)는 유지. |
| `scripts/monitor.mjs` `check4hStochGC` | `getMinuteCandles(market, 240, 60)` → **61** | `confirmedOhlcv(...)` (형성 중 4h봉 제외) |
| `scripts/monitor.mjs` `btcRegime` | `getDayCandles('KRW-BTC', 200)` → **201** (regime이 EMA200 사용) | `confirmedOhlcv(...)` |
| `scripts/momentum-scan.mjs` | `getDayCandles(market, 200)` → **201** (momentum이 EMA200·200봉 신고가 사용) | 판정 입력에 `confirmedOhlcv(...)` + `ensureMinConfirmed(confirmed, 60)` 가드 |
| `scripts/backtest.mjs`, `scripts/backtest-momentum.mjs` | `getDayCandles(m, 200)` → **201** | 라이브와 동일 판정 위해 `confirmedOhlcv(...)` |
| `server/server.mjs` `/api/analyze` | day: `getDayCandles(market, 200)` → **201**; minute: `getMinuteCandles(..., 200)` → **201** | 신호/지표는 `confirmedOhlcv`, **차트 `ohlcv`는 전체 유지**(응답 ohlcv는 전체, 지표만 확정봉) |

### 가격 기준

`detectSignals`가 반환하는 `sig.price = closes.at(-1)`는 확정봉 적용 후 **어제 확정 종가**가 된다. 이것이 신호 기준가이며, 주간 적중률 판정(`미래 종가 > item.price`)의 기준으로도 일관된다 — 별도 변경 불필요. 대시보드 "현재가" 표시는 이 확정 종가(최대 1일 지연, 신호 기준가와 동일)로 유지하며, 실시간가는 개별분석 탭(`/api/analyze`가 여전히 실시간 티커 조회)에서 확인.

### 최소 캔들 수 원칙 (중요)

`confirmedOhlcv`가 봉 1개를 제거하므로, **"지표가 N개의 확정봉을 요구하면 API fetch는 최소 N+1개를 요청한다"** 를 원칙으로 한다.

- 60 확정봉 필요 → `getDayCandles(61)`; 200 확정봉 필요 → `getDayCandles(201)`.
- 기존 `getDayCandles(200)` 경로 중 **EMA200 또는 200봉 신고가**를 쓰는 곳(`lib/momentum.mjs` calcEMA(closes,200)·`highs.slice(-200)`, `lib/regime.mjs` calcEMA(closes,200))은 확정봉 200개가 필요 → **fetch 201**로 변경.
- 구현은 판정 직전 `ensureMinConfirmed(confirmed, min)`(또는 명시적 `confirmed.length < min` 체크)로 부족 시 스킵. 예: momentum은 `ensureMinConfirmed(confirmed, 60)`, 200봉 신고가 계산부는 `confirmed.length >= 200` 확인 후에만.
- (삭제된 이전 표현: "기존 최소 길이 체크가 확정봉 전환 후에도 충분하다" — 위험하므로 폐기. N+1 fetch로 명시 확보.)

---

## #2 가중치 학습 = 적중률 + 수익크기

### 현재

`lib/store.mjs`:
```js
export function ewmTarget(hitRate) { return hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7 }
export function newWeight(oldWeight, hitRate) { return clampWeight(oldWeight * 0.8 + ewmTarget(hitRate) * 0.2) }
```
`lib/weekly.mjs`: `updateWeights(weights, stats)` — `stats[key] = {count, hitRate}` (avgReturn 미전달), `MIN_SAMPLES = 3`.

### 변경

**연속 타겟 함수** (`lib/store.mjs`):
```js
// 적중률을 [0.7, 1.5]로 선형 매핑 (0.4 이하 → 0.7, 0.7 이상 → 1.5)
export function hitComponent(hitRate) {
  const t = (hitRate - 0.4) / (0.7 - 0.4) // 0.4→0, 0.7→1
  return 0.7 + Math.max(0, Math.min(1, t)) * (1.5 - 0.7)
}
// 평균수익(%) 배수 — B안(보수적). avgReturn은 퍼센트값(예 9.79).
// 계수 1/100 → +25% 수익에서 상한 1.25 도달(완만). 손실이면 1 미만, 하한 0.85.
// 수익 크기 반영은 완만하게, 학습은 승률 중심. 변동성 큰 신호 폭주 방지 상하 클램프.
export function returnComponent(avgReturn) {
  if (avgReturn == null || Number.isNaN(avgReturn)) return 1
  return Math.max(0.85, Math.min(1.25, 1 + avgReturn / 100))
}
// 목표 가중치
export function qualityTarget(hitRate, avgReturn) {
  return clampWeight(hitComponent(hitRate) * returnComponent(avgReturn))
}
// 유지: 기존 시그니처 호환. avgReturn 선택 인자.
export function newWeight(oldWeight, hitRate, avgReturn) {
  return clampWeight(oldWeight * 0.7 + qualityTarget(hitRate, avgReturn) * 0.3)
}
```

**`returnComponent` 수식 확정 (B안 채택)**: `clamp(1 + avgReturn/100, 0.85, 1.25)`.
- avgReturn **+25% → 상한 1.25**(완만하게 도달), +10% → 1.10, +9.79%(역삼중바닥) → 1.098, 0% → 1.0, -3.76%(MACD 하락) → 0.962, -15% 이하 → 하한 0.85.
- A안(공격적, `1 + avgReturn*0.05` → +5%에서 상한)은 채택하지 않음 — 상한에 너무 빨리 닿아 변동성 신호 과대평가 우려. **테스트 expected value·주석은 B안 기준으로 고정**한다.
- 검증 예: `qualityTarget(0.754, 9.79)` = hitComponent 1.5 × returnComponent 1.098 ≈ **1.647**; `qualityTarget(0.318, -1.96)` = 0.7 × 0.980 ≈ **0.686**.

**`updateWeights`** (`lib/weekly.mjs`): stats에 avgReturn 포함, MIN_SAMPLES 8:
```js
const MIN_SAMPLES = 8
export function updateWeights(weights, stats) {
  const out = { ...weights }
  for (const [key, { count, hitRate, avgReturn }] of Object.entries(stats)) {
    if (count < MIN_SAMPLES) continue
    out[key] = newWeight(out[key] ?? 1, hitRate, avgReturn)
  }
  return out
}
```

**호출부** (`scripts/weekly-analysis.mjs`): `updateWeights`에 넘기는 stats를 `aggregateHitRates` + `aggregateReturns` 병합으로 구성(`{count, hitRate, avgReturn}`). `aggregateReturns`는 이미 존재하나 학습에 미연결 → 연결.

`clampWeight`(0.5~2.0), `newWeight` 블렌드 0.7/0.3, `hitComponent`/`returnComponent`/`qualityTarget`는 순수 함수 → 단위테스트.

**mixed-horizon 라벨(비목표 M7 연결)**: 학습이 current-price aggregate라는 한계를 사용자가 인지하도록, 주간 분석 결과(`weekly-analysis.json`의 주 항목 또는 `buildVerify` 응답)에 `horizonMode: "current-price-mixed"` 필드를 추가하고, 대시보드 검증 화면 신호통계 헤더에 작은 배지/주석으로 표기한다. (후속 +3일 고정 horizon 작업에서 `"fixed-3d"`로 교체.)

---

## #3 코드리뷰 버그 4건

1. **게이지 널 시세** (`public/app.js` posCardInner): `p.price == null`이면 `.pos-cur` 마커를 렌더하지 않음(또는 gauge를 fallback 텍스트로). curPos NaN/오표시 제거.
2. **저장/삭제 핸들러 try/catch** (`public/app.js` posSave onclick, .pos-del onclick): `api()` 네트워크 예외를 잡아 `#posErr`(저장) 또는 조용한 무시 대신 알림(삭제). 모달 안 닫힘 유지.
3. **readBody Buffer.concat** (`server/server.mjs`): `data += c` → chunk 배열에 모아 `Buffer.concat(chunks).toString('utf-8')`로 1회 디코드. 멀티바이트 한글 분할 손상 방지. 16KB 상한 유지(누적 바이트 길이 체크).
4. **positions.json withLock** (`server/server.mjs` POST/DELETE): `readPositions()`→`writePositions()` RMW를 `store.withLock('positions.json', ...)`로 감싸 동시 요청 유실 방지. `lib/positions.mjs`는 순수 유지, 락은 라우트 레벨.

---

## #4 위생 — 가중치 파일 git 드리프트 + 확정봉 regime 분리 (B안)

확정봉 전환은 **신호 기준 자체를 바꾸므로**, 미확정봉 기반으로 학습된 기존 weight를 그대로 seed로 쓰지 않는다(B안 채택). 기존 튜닝은 백업으로 보존하고, 새 regime은 보수적 baseline에서 깨끗하게 재학습한다.

**파일 구성:**
- `data/signal-weights.backup-preconfirmed.json` — **현재 라이브 학습값(7주+수동재보정)을 그대로 백업 커밋(추적)**. 운영 경험 보존·롤백용.
- `data/signal-weights.default.json` — **보수적 baseline seed(추적)**: 현재값을 1.0 쪽으로 50% 완화 `w' = 1 + (w - 1) * 0.5`. 학습 방향(과매도군↑·MACD군↓)은 절반 보존하되 크기를 줄여 확정봉 regime이 재학습할 여지를 줌.
- `data/signal-weights.json` — **라이브. 컷오버 시 default(완화 baseline)로 리셋** 후 gitignore. (기존 라이브 튜닝은 backup에 보존됨 — B안 단점 수용.)
- `data/signal-weights.meta.json` — **버전 태그(추적)**: `{ "signalVersion": "confirmed-candle-v1", "seededFrom": "preconfirmed-7wk-relaxed50", "createdAt": "2026-07-13" }`. 확정봉 전/후 학습값이 섞이지 않도록 provenance 기록. (weights 파일은 순수 숫자 유지 — meta는 별도 파일이라 `readWeights`/`updateWeights` 반복에 오염 없음.)

**gitignore/추적:** `.gitignore`에 `data/signal-weights.json` 추가 + `git rm --cached data/signal-weights.json`(파일 유지, 추적 해제). backup/default/meta는 추적.

**신규 헬퍼** `lib/store.mjs::readWeights()`: 라이브 없으면 default 폴백.
```js
export async function readWeights() {
  const live = await readJson('signal-weights.json', null)
  if (live && Object.keys(live).length) return live
  return await readJson('signal-weights.default.json', {})
}
```
- 교체 대상 호출부(`readJson('signal-weights.json', {})` → `readWeights()`): `scripts/monitor.mjs`, `scripts/momentum-scan.mjs`, `server/server.mjs`(`/api/analyze`·`/api/weights`), `scripts/weekly-analysis.mjs`(학습 전 현재값). 쓰기(`writeJson('signal-weights.json', ...)`)는 그대로 라이브에 기록.

**결과:** 학습 baseline·백업·버전은 커밋 유지, 주간 드리프트는 git 미추적, 확정봉 regime은 완화 baseline에서 재학습. 롤백 필요 시 backup→live 복사.

---

## 테스트 계획

- **#0 갭**: `get()`에서 fetch가 1회차 `AbortError` throw → 2회차 성공이면 재시도해 결과 반환(호출 2회). (나머지 #0 테스트는 이미 존재 — 재작성 금지.)
- `confirmedOhlcv`: 빈 배열→[], **1개→[]**, N개→N-1개(마지막 제외), 비배열→[]. `ensureMinConfirmed`: 길이<min→null, ≥min→그대로.
- `hitComponent`: 0.4→0.7, 0.7→1.5, 0.55→중간(1.1), <0.4 클램프 0.7, >0.7 클램프 1.5.
- `returnComponent`(B안): 0→1.0, **+25%→1.25(상한)**, +10%→1.10, +9.79→≈1.098, -3%→0.97, **-15%↓→0.85(하한)**, null→1.
- `qualityTarget`/`newWeight`: 경계·클램프, 블렌드 0.7/0.3, avgReturn 반영. 검증값 `qualityTarget(0.754, 9.79)≈1.647`, `qualityTarget(0.318, -1.96)≈0.686`.
- `updateWeights`: MIN_SAMPLES 8 미만 스킵, avgReturn 전달, count≥8 갱신.
- `readWeights`: 라이브 존재→라이브, 라이브 없음/빈객체→default.
- positions withLock: 동시 POST 2건이 둘 다 반영(유실 없음) — 락 순차화 검증.
- readBody: 멀티바이트 UTF-8을 청크 경계로 쪼개 넣어도 온전히 파싱됨.
- 회귀: 기존 스캐너 신호 테스트, evalPositions, 전체 스위트 그린.

## 구현 Task 분해 (작은 단위, 각 Task는 RED→fail확인→구현→pass확인→diff요약→커밋 전 사용자 승인)

- **Task 0** — #0 네트워크 하드닝 **검증 + 갭 테스트 1건**(AbortError→retry). 코드는 이미 존재하므로 신규 구현 없음.
- **Task 1** — `lib/ohlcv.mjs` `confirmedOhlcv`/`ensureMinConfirmed` + 단위테스트.
- **Task 2** — 확정봉 적용: monitor(메인·4h·btcRegime) / momentum-scan / backtest 2종 / server `/api/analyze`. **fetch N+1** 반영, 판정 입력 `confirmedOhlcv`, 200봉 의존부 가드.
- **Task 3** — `qualityTarget`/`returnComponent`/`hitComponent`/`newWeight`(store) + `updateWeights` avgReturn·MIN_SAMPLES 8 + weekly-analysis 연결 + mixed-horizon 라벨. 단위테스트.
- **Task 4** — 코드리뷰 버그 4건(게이지 널 / 핸들러 try-catch / readBody Buffer.concat / positions withLock) + 테스트.
- **Task 5** — 가중치 파일 분리(backup/default/meta + gitignore + `readWeights` + 호출부 교체). B안 완화 baseline seed.
- **Task 6** — 회귀: 전체 테스트 그린 + `docs/CHANGELOG-2026-07.md` 항목 추가.

## 롤아웃

- 확정봉 전환 후 첫 스캔은 어제 확정 종가 기준 → 픽이 하루 전 기준으로 안정화됨(의도).
- 가중치는 컷오버 시 **완화 baseline(default)으로 리셋**되어 확정봉 regime을 재학습. 기존 튜닝은 `signal-weights.backup-preconfirmed.json`에 보존.
- `docs/CHANGELOG-2026-07.md` 항목 추가.
- 대시보드/모니터 재시작 필요(서버 코드 변경 반영).
