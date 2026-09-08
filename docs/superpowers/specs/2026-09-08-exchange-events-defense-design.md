# 거래소 이벤트 방어 레이어 (Phase 1) 설계

**작성일:** 2026-09-08
**상태:** 설계 확정 대기
**동기:** 소폰(SOPH) -86% 사례 — 스캐너 TA는 정상이었으나 판을 흔든 건 "체인 마이그레이션·입출금 중단" 이벤트였고, 순수 TA 기반 스캐너는 이를 못 봤다. 2026-09-08 소폰 급등 분석 중 업비트 공지 API로 마이그레이션 공지를 실전 포착하며 이 소스의 가치가 검증됨.

## 범위 (Scope)

**이 spec은 Phase 1(방어)만 다룬다.** 뉴스 레이어는 성격이 정반대인 두 서브시스템으로 분해했다:

- **Phase 1 — 방어 (이 문서):** 공식 거래소 공지 **API** 기반. 상장폐지·유의지정·입출금중단·마이그레이션 등 구조화된 "판을 흔드는 이벤트"를 잡아 매수후보 제외/감점 + 즉시 알림. 신뢰성 높고 즉시 가치.
- **Phase 2 — 공격 (별도 spec, 추후):** 코인니스 등 크롤링+NLP 기반 뉴스 버즈/센티먼트 조기신호. 노이즈·법적 회색지대·거짓신호 위험이 커서 Phase 1 실전 검증 후 별도 진행.

Phase 1은 그 자체로 동작하는 완결 기능이다.

## 목표 (Goal)

스캔 유니버스의 각 종목에 대해 업비트·바이낸스 공식 공지를 조회하여, 위험 이벤트가 있으면 (1) 매수 점수를 감점 또는 후보에서 제외하고 (2) 신규 이벤트 발생 시 텔레그램으로 즉시 알린다. 소폰류 재발 방지가 1차 목적.

## 아키텍처

구조리스크 신호(`lib/structural-risk.mjs`)와 동일한 패턴을 따른다:

- 새 모듈 `lib/exchange-events.mjs` — 페처·분류기·매처·`ensureEvents()` 오케스트레이터
- 바이낸스 공지 페처는 기존 `lib/binance.mjs`에 추가(바이낸스 API 계열 응집)
- `scripts/monitor.mjs` 스캔 루프에서 `ensureEvents(universe)` 1회 호출 → 점수 반영 + 알림
- 실패 시 neutral 폴백(빈 이벤트맵) — 스캔 절대 무중단 (kimchi/funding과 동일 원칙)
- dedup 상태는 `data/event-log.json`에 영속

## 컴포넌트

### 1. 페처 (Fetchers)

**업비트** (검증됨):
- `GET https://api-manager.upbit.com/api/v1/announcements?os=web&page=1&per_page=30&category=all`
- 최근 2~3페이지 조회. 응답 `data.notices[]`: `{id, title, first_listed_at}`

**바이낸스** (보조 소스, best-effort):
- `GET https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=<ID>&pageNo=1&pageSize=20`
- catalogId=48(New Listing) 단발 호출은 성공 확인. **단, 설계 중 연속 호출 시 즉시 레이트리밋(빈 응답 `data:0`) 관찰됨** — 비공식 CMS라 지오블록·스로틀·포맷 변경에 취약.
- **결론: 업비트를 주(primary) 신뢰 소스로, 바이낸스는 있으면 좋은 선행 보조로 취급.** 바이낸스 실패는 정상 경로로 간주하고 업비트만으로 완전 동작해야 한다.
- 방어용 카탈로그: **상장폐지(Delisting)** + **Monitoring Tag / 유의**. 정확한 catalogId는 구현 단계에서 확정(레이트리밋 회피 위해 스캔당 1회·저빈도 조회, 백오프). 신규상장(48)은 Phase 2 공격용, Phase 1 미조회.
- 헤더 `lang: en`, `User-Agent` 필요. 응답 `data.catalogs[].articles[]`: `{id, title, releaseDate}`
- 실패 시 업비트만으로 degrade(neutral), 스캔 무중단.

### 2. 분류기 (Classifier)

제목 텍스트 → `{ exchange, symbol, market, type, severity, url, ts }`. 순수 함수, 정규식 기반.

**이벤트 타입 & 심각도:**

| type | 심각도(level) | 감점 배수(mult) | 매칭 키워드(예) |
|---|---|---|---|
| `delist` | `critical` | 후보 **제외**(mult=0) | "거래지원 종료", "상장 폐지", "Delisting", "Will Delist" |
| `caution` | `high` | ×0.5 | "유의 종목 지정", "Monitoring Tag", "유의 촉구" |
| `halt` | `mid` | ×0.7 | "입출금 중단", "네트워크 전환", "마이그레이션", "토큰 스왑" |
| `resume` | `clear` | 플래그 제거 | "입출금 재개", "유의 종목 지정 해제", "거래 재개" |
| `listing` | `neutral` | 1 (무시) | "신규 거래지원", "Will List" |

- `resume`/`해제`는 기존 활성 플래그를 상쇄(clear)한다. 같은 종목에 `caution`과 이후 `해제`가 둘 다 있으면 최신 것이 우선.
- 여러 이벤트 동시 활성 시 **가장 강한 것(min mult)** 적용.

### 3. 심볼 매처 (Symbol Matcher)

- 업비트 제목: `"소폰(SOPH)"`, `"소폰(SOPH), 게임빌드(GAME2)"` 등 → 괄호 안 티커 추출(복수 가능) → `KRW-<TICKER>`
- 바이낸스 제목: `"MarsCoin (MARSCOIN)"`, `"Will Delist XYZ"` → 티커 추출 → 업비트 유니버스에 같은 티커 있으면 `KRW-<TICKER>`로 매핑
- 유니버스에 없는 종목의 이벤트는 무시(스캔 대상 아님). 단, 보유 포지션(positions.json)에 있으면 유니버스 밖이어도 알림 대상.

### 4. 통합 (Integration)

**점수 감점:** `lib/buy-modifiers.mjs`의 배수 체인에 `eventRisk` 단계 추가.
- `ensureEvents`가 반환한 `byMarket[market]`의 활성 이벤트 mult를 곱한다.
- `mult===0`(delist)이면 해당 종목은 매수후보에서 제외.
- 시그널 배열에 `⚠️거래소이벤트(<type> <exchange>)` 추가.

**알림:** `scripts/monitor.mjs`에서 이번 스캔에 **처음 본**(event-log에 없는) 이벤트 중 유니버스/보유 종목에 해당하는 것을 텔레그램으로 즉시 발송.
- 형식: `🚨 [거래소이벤트] KRW-SOPH 소폰 — 입출금중단(업비트) · 9/8 11:00` + 공지 링크

### 5. dedup 상태 (`data/event-log.json`)

```json
{
  "seenIds": { "upbit:6548": "2026-09-07T12:20", "binance:12345": "..." },
  "active": {
    "KRW-SOPH": [
      { "type": "halt", "severity": "mid", "exchange": "upbit",
        "srcId": "upbit:6548", "ts": "2026-09-07T12:20", "expiresAt": "2026-09-21T12:20" }
    ]
  }
}
```
- `seenIds`: 재알림 방지(공지 ID 최초 1회만 알림)
- `active[market]`: 종목별 활성 이벤트. `resume`/`해제` 수신 시 해당 종목 상쇄. `halt`/`caution`은 재개 공지 전까지 유지하되 안전장치로 만료일(halt 14일·caution 30일) 부여 — 재개 공지를 놓쳐도 무한 감점 방지.

## 데이터 흐름

```
monitor.mjs 스캔 시작
  → ensureEvents(universe, {positions, deps})
      → 업비트 공지 조회 + 바이낸스 카탈로그 조회 (병렬, best-effort)
      → 분류 → 매칭 → event-log 갱신(신규 ID 판별, active 갱신, 만료 청소)
      → 반환 { byMarket, newEvents }
  → 각 종목 채점 시 byMarket[market] mult 적용 (buy-modifiers)
  → newEvents 중 유니버스/보유 해당 → 텔레그램 즉시 알림
```

## 에러 처리

- 페처 각각 try/catch. 한 거래소 실패 → 나머지로 진행. 둘 다 실패 → 빈 `byMarket` 반환, 스캔 정상 진행(감점·알림만 스킵).
- event-log.json 손상/부재 → 빈 상태로 시작(모든 현재 이벤트를 "신규"로 간주해 1회 재알림될 수 있음 — 허용).
- 분류 불가 제목 → 무시(로그만).

## 테스트

- `__tests__/exchange-events.test.mjs`:
  - 분류기: 대표 제목 20종(소폰 마이그레이션, 유의지정, 해제, 상폐, 신규상장, 복수종목) → `{symbol,type,severity}` 검증
  - 매처: 업비트/바이낸스 제목 → market 매핑, 유니버스 밖·보유종목 케이스
  - dedup: 같은 공지 재조회 시 newEvents 비어야 함, 만료 청소, resume가 active 상쇄
  - `ensureEvents`: deps 주입 목(cg-data/kimchi 패턴) — 페처 성공/실패/부분실패
- `__tests__/buy-modifiers.test.mjs`: eventRisk mult 적용(delist=제외, caution=×0.5, halt=×0.7)

## YAGNI (의도적 제외)

- 신규상장·이벤트/에어드랍 등 비방어 카테고리 — Phase 2
- 크롤링·NLP·센티먼트 — Phase 2
- 빗썸 — 파서 추가부담 대비 한계효용 낮아 제외(교훈: 바이낸스가 선행지표)
- 과거 공지 백필 — 현재 시점부터 전방 감시만
```
