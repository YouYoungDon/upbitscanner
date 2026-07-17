# 픽 성과 스코어카드 설계 (2026-07-17)

## 목적

스캐너가 낸 매수 픽이 실제로 돈이 됐는지를 종목 단위로 자동 채점한다.
매 스캔의 매수 픽 중 **신규 진입 시점**을 에피소드로 기록하고, +1일/+3일/+7일
확정 종가 수익률과 최대상승폭(MFE)을 추적하는 대시보드 탭을 추가한다.
확정봉 체제(2026-07-13 cutover) 전/후 성과를 분리 집계해 새 체제의 효과를
숫자로 검증한다.

## 데이터 소스

`data/scan-archive.jsonl` — 스캔 1회당 1줄 JSON. 2026-06-11부터 전체 이력
(233회+). 각 줄: `{ timestamp, buy: [{ market, korean_name, price, score,
signals, lowLiquidity? }], sell: [...] }`. 신규 기록 없이 이 파일만으로 소급
채점이 가능하다.

## 에피소드 규칙

아카이브를 시간순으로 순회하며, **직전 스캔의 매수 리스트에 없던 마켓이
이번 스캔 매수 리스트에 등장한 순간**을 에피소드 1개로 만든다.

```
{
  id: `${market}@${entryTs}`,       // 예: "KRW-MANTRA@2026-07-17T00:33:21.929Z"
  market, korean_name,
  entryTs,                          // 진입 스캔의 timestamp
  entryPrice,                       // 픽 당시 price 필드
  score, signals,                   // 진입 시점 스냅샷
  lowLiquidity: boolean,            // 저유동성 플래그 (없으면 false)
  ret1: number|null, ret3: number|null, ret7: number|null,
  mfe1: number|null, mfe3: number|null, mfe7: number|null,
  status: 'pending'|'partial'|'done'|'no-data',
  scoredAt: string|null
}
```

- 코인이 리스트에서 빠졌다가 재진입하면 **새 에피소드** (의도된 동작).
- 아카이브 첫 스캔은 직전 스캔이 없으므로 전원 신규 취급.
- 스캔 공백(PC 꺼짐) 뒤에도 단순히 "직전 스캔"과 비교한다. 공백 사이에
  들어왔다 나간 코인은 감지할 수 없다 — 알려진 한계로 문서화만 한다.
- `buy` 배열 전체가 대상이다(저유동성 포함). `lowLiquidity`는 태그로 남겨
  UI 필터에 쓴다.

## 채점 규칙 (확정봉 기준)

진입 시각(`entryTs`)이 속한 일봉을 D0으로 한다. 업비트 일봉 경계는 KST
09:00 (UTC 00:00).

- **retN** = (D+N 확정 종가 ÷ entryPrice) − 1, N ∈ {1, 3, 7}
- **mfeN** = (D+1..D+N 확정봉 고가의 최대값 ÷ entryPrice) − 1
  - D0 고가는 진입 전 가격이 섞이므로 제외한다.
- **hit** 판정: retN > 0 (집계 시 계산, 저장은 retN만).
- D+N 봉이 아직 확정되지 않았으면 해당 지평선은 `null`로 두고 다음 실행 때
  증분 채점한다.
- `status`: 셋 다 null이면 `pending`, 일부만 채점이면 `partial`, ret7까지
  채점되면 `done`. 진입일로부터 10 UTC일이 지난 뒤에도(D+11부터) 미채점
  지평선이 남으면(상장폐지 등) `no-data`로 확정하고 더 이상 재시도하지 않는다.
- 캔들은 `lib/ohlcv.mjs`의 `confirmedOhlcv()`를 거쳐 확정봉만 사용한다.

## 파일 구조

| 파일 | 역할 |
|---|---|
| `lib/scorecard.mjs` (신규) | 순수 로직. `extractEpisodes(scans)`, `scoreEpisode(ep, confirmedCandles, nowTs)`, 병합 유틸 |
| `scripts/scorecard.mjs` (신규) | 러너. 아카이브 읽기 → 기존 scorecard.json과 병합 → 미채점 에피소드를 **마켓별로 그룹핑해 마켓당 일봉 1회 fetch** → 채점 → `data/scorecard.json` 원자적 저장(store.writeJson) |
| `server/api.mjs` | `buildScorecard(scorecard)` — 집계 계산 |
| `server/server.mjs` | `GET /api/scorecard` — 파일 읽고 buildScorecard 결과 반환 |
| `public/app.js`, `public/index.html` | 새 탭 "스코어카드" |
| `data/scorecard.json` | 출력. `{ updatedAt, episodes: [...] }`. gitignore 대상(런타임 데이터) |

## 러너 동작 (scripts/scorecard.mjs)

1. `scan-archive.jsonl` 전체를 읽어 `extractEpisodes`로 에피소드 목록 생성.
2. 기존 `data/scorecard.json`이 있으면 id 기준 병합 — 이미 채점된 값은
   보존하고, 새 에피소드만 추가한다.
3. `status`가 `pending`/`partial`인 에피소드를 **마켓별로 그룹핑**하고,
   마켓당 `getDayCandles(market, 40)` 1회 호출로 해당 마켓의 모든 미채점
   에피소드를 채점한다 (rate limit 안전).
4. fetch 실패한 마켓은 이번 실행에서 건너뛰고 pending 유지 — 다음 실행에서
   재시도 (기존 upbit.mjs 재시도/타임아웃 로직 재사용).
5. `store.writeJson('scorecard.json', ...)`으로 원자적 저장.
6. 콘솔 요약 출력: 총 에피소드 / 신규 / 이번에 채점 / 남은 pending.

주의: 진입 후 7일이 지난 에피소드는 40개 캔들로 충분히 커버된다
(에피소드 최대 나이는 아카이브 시작 기준이지만, 채점에 필요한 것은 D0~D+7
구간이므로 D0이 40일 이상 과거인 에피소드는 count를 늘려 fetch한다 —
필요 캔들 수 = 오늘 − D0 + 여유 3봉, 최대 200 cap 준수).

## 집계 (buildScorecard)

```
{
  updatedAt,
  total, pendingCount, noDataCount,
  horizons: {
    h1: { n, winRate, avgRet, avgMfe },
    h3: { ... }, h7: { ... }
  },
  regimes: {                         // 확정봉 체제 전/후 분리
    pre:  { h1: {...}, h3: {...}, h7: {...} },   // entryTs < 2026-07-13T00:00:00+09:00
    post: { h1: {...}, h3: {...}, h7: {...} }
  },
  episodes: [...]                    // 최신순 정렬
}
```

- 승률/평균은 해당 지평선이 채점된(`null` 아닌) 에피소드만 대상으로 한다.
- cutover 경계는 KST 2026-07-13 00:00 (= UTC 2026-07-12T15:00:00Z).

## UI (스코어카드 탭)

- 상단 KPI 타일: +1일/+3일/+7일 승률·평균수익률·평균 MFE·표본수.
- 체제 비교 배지: 확정봉 전환 전/후 +1일 승률 나란히 표시.
- 에피소드 테이블(최신순): 코인 · 진입일 · 진입가 · 점수 · +1일 · +3일 ·
  +7일 · MFE(7일) · 상태. 수익 양수는 초록/음수는 빨강, pending은 "—".
- 필터: 전체 / 저유동성 제외.
- `scorecard.json` 없거나 비어 있으면 "아직 채점 전" 빈 상태 표시.
- 기존 탭들과 동일한 daisyUI 스타일을 따른다.

## 스케줄

Windows 작업 스케줄러에 `UpbitScorecard` 등록:
- 매일 KST 09:10 (일봉 확정 직후), `node scripts/scorecard.mjs`
- `StartWhenAvailable` 켬 (부팅 시 놓친 실행 따라잡기) — 기존
  UpbitMonitor와 동일 정책.
- 첫 수동 실행으로 과거 아카이브 소급 채점을 완료한다.

## 에러 처리

- 캔들 fetch 실패 → 해당 마켓 에피소드 pending 유지, 다음 실행 재시도.
- 아카이브 줄 파싱 실패 → 해당 줄 건너뛰고 계속 (경고 로그).
- scorecard.json 손상 → 빈 상태에서 재생성 (아카이브가 원본이므로 소급
  채점으로 전부 복구 가능).
- API는 파일이 없으면 `{ empty: true }` 반환 — 서버는 죽지 않는다.

## 테스트 (vitest, fetch 전부 mock)

- `extractEpisodes`: 신규 진입 감지 / 연속 등장 시 중복 없음 / 재진입 시 새
  에피소드 / 첫 스캔 전원 신규 / 빈 스캔 처리.
- `scoreEpisode`: D+1만 확정 → partial / 전부 확정 → done / 미확정 경계
  (D+N 봉이 마지막 미확정 봉) → null 유지 / no-data 판정 / MFE가 D0 고가를
  제외하는지 / 진입가 0 방어.
- `buildScorecard`: 지평선별 집계 / null 제외 / 체제 전·후 분리 / 빈 입력.
- 러너는 순수 함수 조합이므로 통합 테스트는 병합 로직(기존 값 보존)만.

## 명시적 비범위 (YAGNI)

- 매도 픽 채점 (매수만).
- 텔레그램 알림 연동.
- 신호별 기여도 분해 (weekly-analysis가 이미 신호 단위 적중률을 담당).
- 손절/익절 시뮬레이션.
