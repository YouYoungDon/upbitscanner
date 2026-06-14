# 주간 자동 분석 스케줄러 설계 문서

> 작성일: 2026-06-14
> 범위: 일요일 22:00 주간 분석 자동화 + "왜 맞았는지" 주간 리포트 + 대시보드 표시
> 플랫폼: 기존 zero-dep Node 스캐너/대시보드 위

---

## 1. 목적

매일 2회 도는 스캔은 그대로 유지하고, **매주 일요일 22:00 KST**에 자동으로
지난 7일 스캔을 분석한다. 신호별 적중률을 집계해 **"무엇이/왜 맞았는지"** 주간
리포트를 만들고, EWM으로 지표 가중치에 반영한다. 결과는 대시보드 신호검증 탭에서
확인한다.

현재 `scripts/weekly-analysis.mjs`는 적중률 집계 + EWM 갱신 + +1/+3/+7일 시간별
적중률까지 이미 계산하지만, ① 수요일에만 돌도록 게이트돼 있고 ② 스케줄러에 미등록
이며 ③ 최근 7스캔(약 3.5일)만 보고 ④ "왜 맞았는지" 사람이 읽을 요약이 없다.

## 2. 핵심 결정 (확정)

- **실행 시각**: 일요일 22:00 KST (21:00 일일 스캔 종료 후, 그 데이터 포함)
- **분석 범위**: `data/scan-archive.jsonl`에서 **지난 7일** 스캔 전부 (약 14회)
- **리포트 노출**: `data/weekly-analysis.json` 각 주차에 `report` 필드로 저장 +
  기존 `/api/verify`에 `report` 추가 → 신호검증 탭 "📅 이번 주 요약" 섹션

## 3. 데이터 흐름

```
(일요일 22:00) UpbitWeekly_Sun 작업
  → node scripts/weekly-analysis.mjs
      → readArchive() → scansInLastDays(scans, 7)        # 지난 7일
      → 현재가 조회 → judgeHit → records[{market,korean_name,side,signals,hit}]
      → aggregateHitRates(records)  → signalStats
      → updateWeights(oldWeights, stats) → signal-weights.json (EWM)
      → buildWeeklyReport(records, stats, old, new) → report
      → calcTimedHitRates(scans) → +1/+3/+7일
      → weekly-analysis.json.weeks += { ...result, report }
  → /api/verify (report 포함) → 신호검증 탭 "이번 주 요약"
```

## 4. 순수 함수 (테스트 대상)

### lib/archive.mjs — 추가

- `scansInLastDays(scans, days, now = Date.now())`
  - `new Date(s.timestamp).getTime() >= now - days*86400000` 인 스캔만 반환. 입력 순서 유지.

### lib/weekly.mjs — 추가

- `buildWeeklyReport(records, stats, oldWeights, newWeights)` → 객체:
  ```
  {
    topSignals:    [{ key, count, hitRate, hits }],   // hits=round(count*hitRate)
    weightChanges: [{ key, old, new, direction, reason }],
    hitCoins:      [{ market, korean_name, hits, total }],
    missCoins:     [{ market, korean_name, total }],
  }
  ```
  - `topSignals`: stats의 각 key에 hits=Math.round(count*hitRate). hits 내림차순,
    동률 시 hitRate 내림차순. 상위 8개.
  - `weightChanges`: `+oldW.toFixed(2) !== +newW.toFixed(2)` 인 key만.
    direction = new>old ? 'up' : 'down'.
    reason = `적중률 {pct}% (표본 {count}) → {상향|하향}` (stats[key] 없으면 표본 0).
    변화량(|new-old|) 내림차순.
  - `hitCoins`: market별 집계 {hits, total, korean_name}. hits>0인 종목, hits 내림차순 상위 10.
  - `missCoins`: hits===0인 종목, total 내림차순 상위 10.

기존 `judgeHit` / `aggregateHitRates` / `updateWeights`는 변경 없음
(`aggregateHitRates`는 record의 signals/hit만 사용하므로 필드 추가 무해).

## 5. 스크립트 — scripts/weekly-analysis.mjs (수정)

- import에 `readArchive, scansInLastDays`(archive), `buildWeeklyReport`(weekly) 추가.
- **게이트**: `kstDay !== 3`(수) → `kstDay !== 0`(일). `--force` 유지.
- **데이터 소스**: `readJson('monitor-log.json').scans.slice(-7)` →
  `scansInLastDays(readArchive(), 7)`. 비면 "스캔 이력 없음" 종료.
- **records**: `{ side, market, korean_name, signalPrice, signals }` 예측 →
  현재가 매핑 → `{ market, korean_name, side, signals, hit }` (market/korean_name 추가).
- stats/newWeights 계산 후 `const report = buildWeeklyReport(records, stats, oldWeights, newWeights)`.
- `result`에 `report` 추가, 나머지(timestamp/predictions/hits/overallHitRate/timedHitRates/signalStats) 유지.
- `calcTimedHitRates`는 변경 없음 (입력이 7일 스캔으로 바뀔 뿐).

## 6. 스케줄러 — scripts/install-scheduler.ps1 (수정)

- 등록 시: 일일 2개 + **주간 1개** 추가.
  ```powershell
  $weekly  = Join-Path $projectRoot 'scripts\weekly-analysis.mjs'
  $wAction  = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$weekly`"" -WorkingDirectory $projectRoot
  $wTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '22:00'
  $wSettings= New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd
  Register-ScheduledTask -TaskName 'UpbitWeekly_Sun' -Action $wAction -Trigger $wTrigger -Settings $wSettings -Force
  ```
- 제거 시: 일일 2개 + `UpbitWeekly_Sun` 모두 Unregister (제거 목록에 추가).

## 7. API — server/api.mjs (수정)

- `buildVerify(weekly, weights)` 반환 객체에 `report: latest.report ?? null` 추가.
  (기존 필드 유지, 새 엔드포인트 없음.)

## 8. 프론트엔드 — public/app.js (수정)

- `verify()` 라우트: 기존 stats/테이블 위에 `report`가 있으면 "📅 이번 주 요약" 카드 추가.
  - 적중 신호 TOP: key · 표본 · 적중률 · hits badge
  - 가중치 변화: key · old→new · 방향(▲/▼) · reason
  - 적중 코인: korean_name (hits/total) badge 나열
  - `report`가 null이면 섹션 생략 (주간 분석 미실행 시).

## 9. 에러 처리

- 아카이브 없음/7일 내 스캔 없음 → "스캔 이력 없음" 종료(가중치/리포트 미변경).
- 예측 0건 → "예측 없음" 종료.
- `report` 없음(구버전 주차) → 대시보드 섹션 생략, 기존 UI 정상.
- 현재가 조회 실패 종목 → records에서 제외(기존 동작 유지).

## 10. 테스트 전략

- `lib/archive.mjs`: `scansInLastDays` — 경계(정확히 7일), 순서 유지, now 주입.
- `lib/weekly.mjs`: `buildWeeklyReport` — topSignals 정렬/hits 계산, weightChanges
  변화분만/방향/reason, hitCoins·missCoins 집계.
- `server/api.mjs`: `buildVerify`가 `report`를 통과시키는지 (있을 때/null일 때).
- 기존 테스트 회귀 유지.

## 11. 파일 변경 요약

```
lib/archive.mjs              # scansInLastDays 추가
lib/weekly.mjs               # buildWeeklyReport 추가
scripts/weekly-analysis.mjs  # 게이트 일요일, 데이터 소스 아카이브 7일, report 생성
scripts/install-scheduler.ps1# UpbitWeekly_Sun 주간 태스크 등록/제거
server/api.mjs               # buildVerify에 report 추가
public/app.js                # 신호검증 탭 "이번 주 요약" 섹션
README.md                    # 주간 분석/스케줄 설명 갱신 (수→일, 아카이브 7일)
__tests__/archive.test.mjs   # scansInLastDays
__tests__/weekly.test.mjs    # buildWeeklyReport
__tests__/api.test.mjs       # buildVerify report
```
