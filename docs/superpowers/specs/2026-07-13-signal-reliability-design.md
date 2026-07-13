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

---

## #1 확정봉 판정

### 접근

신규 헬퍼를 `lib/upbit.mjs`에 추가:

```js
// 형성 중(닫히지 않은) 최신 봉을 제외한 확정 캔들만. 신호/지표 판정용.
export function confirmedOhlcv(ohlcv) {
  return Array.isArray(ohlcv) && ohlcv.length ? ohlcv.slice(0, -1) : []
}
```

`candlesToOhlcv`(오름차순 변환)는 그대로 두고, **신호를 판정하는 지점에서만** `confirmedOhlcv`를 적용한다. 표시/차트용 전체 시계열은 유지.

### 적용 지점

| 파일 | 현재 | 변경 |
|------|------|------|
| `scripts/monitor.mjs` 메인 스캔 | `detectSignals(ohlcv)`, `detectPatterns(ohlcv)`, `detectLiquiditySweep(ohlcv)`, `detectVBottom(ohlcv)`, `detectPumpStart(ohlcv)` | 모두 `confirmedOhlcv(ohlcv)` 입력. `candleMap[market]=ohlcv`(전체)는 유지. |
| `scripts/monitor.mjs` `check4hStochGC` | 4h `candlesToOhlcv(candles)` | `confirmedOhlcv(...)` (형성 중 4h봉 제외) |
| `scripts/monitor.mjs` `btcRegime` | `candlesToOhlcv(btcCandles)` | `confirmedOhlcv(...)` |
| `scripts/momentum-scan.mjs` | `candlesToOhlcv(candles)` | 신호 판정 입력에 `confirmedOhlcv(...)` |
| `scripts/backtest.mjs`, `scripts/backtest-momentum.mjs` | `candlesToOhlcv(candles)` | 라이브와 동일 판정 위해 `confirmedOhlcv(...)` |
| `server/server.mjs` `/api/analyze` | `candlesToOhlcv(candles)` → `analyzeMarket` | 신호/지표는 `confirmedOhlcv`, **차트 `ohlcv`는 전체 유지**(응답의 ohlcv는 전체, 지표만 확정봉) |

### 가격 기준

`detectSignals`가 반환하는 `sig.price = closes.at(-1)`는 확정봉 적용 후 **어제 확정 종가**가 된다. 이것이 신호 기준가이며, 주간 적중률 판정(`미래 종가 > item.price`)의 기준으로도 일관된다 — 별도 변경 불필요. 대시보드 "현재가" 표시는 이 확정 종가(최대 1일 지연, 신호 기준가와 동일)로 유지하며, 실시간가는 개별분석 탭(`/api/analyze`가 여전히 실시간 티커 조회)에서 확인.

### 최소 길이 가드

`confirmedOhlcv`로 1개 줄어들므로, 기존 최소 길이 체크(`candles.length < 60` 등)는 확정봉 기준으로 여전히 충분(60→59). 지표 계산 함수들의 최소 길이 가드는 이미 존재(2026-07-04 감사에서 calcStochastic off-by-one 수정). 빈 배열/1개 캔들 입력 시 `confirmedOhlcv`는 `[]` 반환 → 기존 길이 가드가 걸러냄.

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
// 평균수익(%) 배수: avgReturn은 퍼센트값(예 9.79). 계수 0.05 → +5% 수익이면 상한 1.25 도달.
// 손실이면 1 미만, 하한 0.85. 변동성 큰 신호가 폭주하지 않도록 상하 클램프.
export function returnComponent(avgReturn) {
  if (avgReturn == null || Number.isNaN(avgReturn)) return 1
  return Math.max(0.85, Math.min(1.25, 1 + avgReturn * 0.05))
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

`returnComponent` 수식 확정: `1 + (avgReturn/100)*5`, 클램프 [0.85, 1.25]. 즉 avgReturn +5% → 1.25(상한), -3% → 0.85(하한). 큰 수익 신호를 보상하되 상한으로 폭주 방지.

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

---

## #3 코드리뷰 버그 4건

1. **게이지 널 시세** (`public/app.js` posCardInner): `p.price == null`이면 `.pos-cur` 마커를 렌더하지 않음(또는 gauge를 fallback 텍스트로). curPos NaN/오표시 제거.
2. **저장/삭제 핸들러 try/catch** (`public/app.js` posSave onclick, .pos-del onclick): `api()` 네트워크 예외를 잡아 `#posErr`(저장) 또는 조용한 무시 대신 알림(삭제). 모달 안 닫힘 유지.
3. **readBody Buffer.concat** (`server/server.mjs`): `data += c` → chunk 배열에 모아 `Buffer.concat(chunks).toString('utf-8')`로 1회 디코드. 멀티바이트 한글 분할 손상 방지. 16KB 상한 유지(누적 바이트 길이 체크).
4. **positions.json withLock** (`server/server.mjs` POST/DELETE): `readPositions()`→`writePositions()` RMW를 `store.withLock('positions.json', ...)`로 감싸 동시 요청 유실 방지. `lib/positions.mjs`는 순수 유지, 락은 라우트 레벨.

---

## #4 위생 — 가중치 파일 git 드리프트

- 현재 `data/signal-weights.json`(학습으로 런타임 갱신, 매주 dirty)을 **시드/라이브로 분리**:
  - `data/signal-weights.default.json` — 현재 학습값 스냅샷을 시드로 커밋(추적). `cp data/signal-weights.json data/signal-weights.default.json`.
  - `data/signal-weights.json` — `.gitignore`에 추가 + `git rm --cached data/signal-weights.json`(파일은 남기고 추적만 해제).
  - **신규 헬퍼** `lib/store.mjs::readWeights()`: 라이브(`signal-weights.json`)를 읽되 없으면 default(`signal-weights.default.json`)로 폴백.
    ```js
    export async function readWeights() {
      const live = await readJson('signal-weights.json', null)
      if (live && Object.keys(live).length) return live
      return await readJson('signal-weights.default.json', {})
    }
    ```
  - 교체 대상 호출부(`readJson('signal-weights.json', {})` → `readWeights()`): `scripts/monitor.mjs`, `scripts/momentum-scan.mjs`(있으면), `server/server.mjs` `/api/analyze`·`/api/weights`, `scripts/weekly-analysis.mjs`(학습 전 현재값 읽기). 쓰기(`writeJson('signal-weights.json', ...)`)는 그대로 라이브 파일에 기록.
- 결과: 학습 baseline은 커밋 유지, 주간 드리프트가 git status를 더럽히지 않음. 신선한 clone은 default로 시작해 재학습.

---

## 테스트 계획

- `confirmedOhlcv`: 빈 배열→[], 1개→[], N개→N-1개(마지막 제외), 비배열→[].
- `hitComponent`: 0.4→0.7, 0.7→1.5, 0.55→중간, <0.4 클램프 0.7, >0.7 클램프 1.5.
- `returnComponent`: 0→1.0, +5%→1.25(상한), +10%→1.25, -3%→0.85(하한), null→1.
- `qualityTarget`/`newWeight`: 경계·클램프, 블렌드 0.7/0.3, avgReturn 반영.
- `updateWeights`: MIN_SAMPLES 8 미만 스킵, avgReturn 전달, count≥8 갱신.
- positions withLock: 동시 POST 2건이 둘 다 반영(유실 없음) — 락 순차화 검증.
- readBody: 멀티바이트 UTF-8을 청크 경계로 쪼개 넣어도 온전히 파싱됨.
- 회귀: 기존 스캐너 신호 테스트, evalPositions, 전체 스위트 그린.

## 롤아웃

- 확정봉 전환 후 첫 스캔은 어제 확정 종가 기준 → 픽이 하루 전 기준으로 안정화됨(의도).
- 가중치 학습 변경은 다음 주간 분석부터 적용. 기존 `signal-weights.json`(방금 재보정+커밋)이 baseline.
- `docs/CHANGELOG-2026-07.md` 항목 추가.
- 대시보드/모니터 재시작 필요(신규 라우트 아님이나 서버 코드 변경 반영 위해).
