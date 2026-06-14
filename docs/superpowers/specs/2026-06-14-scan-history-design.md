# 스캔 기록(아카이브) 메뉴 설계 문서

> 작성일: 2026-06-14
> 범위: 무제한 스캔 아카이브 + "스캔기록" 탭(날짜별/종목별)
> 플랫폼: 기존 zero-dep Node 스캐너/대시보드 위

---

## 1. 목적

매일 2회 도는 스캔 결과를 **영구 누적**하고, 대시보드에서 날짜별·종목별로
훑어볼 수 있는 "스캔기록" 탭을 추가한다.

현재 `monitor-log.json`은 최근 30회만 롤링 저장하므로 장기 이력이 사라진다.
별도의 append-only 아카이브를 두어 제한 없이 쌓는다.

## 2. 데이터 저장

- 신규 파일 `data/scan-archive.jsonl` — 한 줄당 스캔 1건(JSON), append-only, 롤링 없음.
  한 줄 형태: `{ "timestamp": ISO, "buy": [...], "sell": [...] }` (monitor-log의 scan 항목과 동일 스키마).
- `monitor.mjs`는 `monitor-log.json` 기록 직후 같은 scan 객체를 아카이브에 1줄 append.
- **초기 시드**: `scripts/seed-archive.mjs` — 아카이브가 없으면 기존 `monitor-log.json`의
  scans를 시각 오름차순으로 아카이브에 기록(1회성). 이미 있으면 아무것도 안 함(중복 방지).
- `.gitignore`에 `data/scan-archive.jsonl` 추가 여부: data/의 다른 JSON은 커밋 중이므로
  일관성을 위해 **커밋하지 않음**(런타임 누적 데이터, 개인 기록) → `.gitignore`에 추가.

## 3. 모듈 (lib/archive.mjs)

IO 래퍼 + 순수 집계 분리.

- `appendScan(scan, file = ARCHIVE)` — jsonl 한 줄 append (디렉토리 없으면 생성).
- `readArchive(file = ARCHIVE)` — 파일 읽어 줄 단위 파싱, 깨진 줄은 건너뜀, 배열 반환(없으면 `[]`).
- 순수 함수(테스트 대상):
  - `summarizeScans(scans)` → `[{ timestamp, buyCount, sellCount, topBuy: [korean_name...] }]`
    (topBuy = score 내림차순 상위 3 종목명). 입력 순서 유지.
  - `coinHistory(scans, market)` → `[{ timestamp, side: 'buy'|'sell', score, signals }]`
    해당 market이 등장한 스캔만, 시각 오름차순.

## 4. API (server)

`server/api.mjs`에 순수 빌더 추가, `server/server.mjs`에 라우트 추가.
아카이브 읽기는 mtime 기반 캐시(파일 안 바뀌면 재파싱 안 함).

| 엔드포인트 | 설명 |
|-----------|------|
| `GET /api/scans?limit=20&offset=0` | 날짜별 요약(최신순). `{ total, items: summarizeScans(...) 슬라이스 }` |
| `GET /api/scan-detail?timestamp=ISO` | 해당 timestamp 스캔의 `{ timestamp, buy, sell }` (없으면 404) |
| `GET /api/coin-history?market=KRW-XXX` | `coinHistory(scans, market)` (잘못된 market 400) |

`server/api.mjs` 빌더:
- `buildScans(scans, { limit, offset })` → `{ total, items }` (items는 최신순 요약).
- `findScanByTimestamp(scans, ts)` → scan 또는 null.
- (coinHistory는 lib에서 직접 사용)

## 5. 프론트엔드 — "스캔기록" 탭

- 사이드바 메뉴에 `📜 스캔기록`(`#/history`) 추가.
- 페이지 상단 DaisyUI `tabs`(또는 `join` 버튼)로 **날짜별 / 종목별** 전환.

**날짜별:**
- `/api/scans?limit=20&offset=0` → 카드/테이블: 각 행 = 스캔 시각 · 매수N · 매도M · 상위 종목 badge.
- 행 클릭 → `/api/scan-detail?timestamp=` 조회 → 그 아래 펼침 영역에 매수/매도 전체(기존 `topTable` 재사용, n=전체).
- 하단 "더 보기"(offset 증가) 버튼으로 페이지네이션.

**종목별:**
- 코인 검색 입력(개별분석의 marketsList 재사용) → `/api/coin-history?market=` 조회.
- 결과: 시간순 타임라인 테이블 — 시각 · 매수/매도 badge · 점수 · 신호 badge.

## 6. 데이터 흐름

```
monitor.mjs ──append──> data/scan-archive.jsonl ──readArchive(+mtime캐시)──> /api/scans|scan-detail|coin-history ──fetch──> 스캔기록 탭
                ▲ (최초 1회) scripts/seed-archive.mjs ← monitor-log.json
```

## 7. 에러 처리

- 아카이브 없음/빈 파일 → `readArchive` 빈 배열 → 탭에 "기록 없음".
- 깨진 jsonl 줄 → try/parse 건너뜀(전체 실패 방지).
- `coin-history` 잘못된 market → 400, 프론트 메시지.
- 기존 API 에러 처리 패턴 유지.

## 8. 테스트 전략

- `lib/archive.mjs`: `appendScan`/`readArchive` 임시파일 왕복, 깨진 줄 무시 검증.
- `summarizeScans`/`coinHistory`: 합성 스캔으로 요약·필터·정렬 검증.
- `server/api.mjs`: `buildScans`(limit/offset/total), `findScanByTimestamp` 검증.
- 기존 53개 테스트 회귀 유지.

## 9. 파일 변경 요약

```
lib/archive.mjs            # 신규: append/read + summarize/coinHistory
scripts/monitor.mjs        # 스캔 후 아카이브 append
scripts/seed-archive.mjs   # 신규: monitor-log → 아카이브 1회 시드
server/api.mjs             # buildScans / findScanByTimestamp
server/server.mjs          # /api/scans, /api/scan-detail, /api/coin-history (+mtime 캐시)
public/index.html          # 사이드바 메뉴에 스캔기록 추가
public/app.js              # routes.history (날짜별/종목별)
.gitignore                 # data/scan-archive.jsonl
__tests__/archive.test.mjs # 신규
__tests__/api.test.mjs     # buildScans/findScanByTimestamp 추가
```
