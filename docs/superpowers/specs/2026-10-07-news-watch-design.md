# 뉴스·공지 감시 데몬 (news-watch) 설계

**작성일:** 2026-10-07
**상태:** 설계 확정 대기 (사용자 리뷰)
**선행:** [거래소 이벤트 방어 레이어 Phase 1](2026-09-08-exchange-events-defense-design.md) — 이 문서가 그 Phase 2(공격 쪽)와 알림 체계를 맡는다.

## 동기

2026-10-07 재생 분석 세 건이 같은 결론을 냈다.

- 메인 스캐너(일봉 18개월·289종목): 상승 동반 거래량 급증은 역방향 신호였다. 정리 후에도 픽 초과수익은 0 근처다.
- 자금유입(5분봉 61일·166종목): 급등의 69%를 일찍 "감지"는 하지만 같은 신호가 급락도 앞선다. 경보 시점의 특징 14종 어디에도 양(+)의 초과수익이 없었다.
- 모멘텀: 당일 과열을 빼야 겨우 양(+)이 된다.

**가격과 거래대금만으로는 "급등 전"을 가려낼 수 없었다.** 남은 후보는 가격 밖의 촉매, 즉 거래소 공지와 뉴스다. 이 데몬은 그것을 빠르게 받아 (1) 알리고 (2) 확실한 악재는 점수에 반영하며 (3) 나중에 "뉴스 → 가격" 효과를 측정할 데이터를 쌓는다.

## 결정 사항 (사용자 확정)

| 항목 | 결정 |
|---|---|
| 소스 | **무료만**: 코인니스, 업비트 공지, 바이낸스 공지, 빗썸 공지. X(트위터)는 유료(글 1건 $0.005)라 제외하되, 소스 플러그인 구조로 나중에 붙일 수 있게 한다. |
| 대응 방식 | **C**: 공식 악재 공지는 점수에 자동 반영(기존 방식), 그 외는 알림만. 공식 호재의 점수 가산은 과거 공지로 측정한 뒤 별도로 결정한다. |
| 알림 범위 | **B**: 보유 코인과 현재 매수 후보(메인+모멘텀) 관련 소식, 코인니스 중요 속보. 추가로 **업비트 KRW 코인에 대한 공식 상장 공지**(타 거래소 상장 포함)는 보유 여부와 무관하게 알린다. |
| 실행 형태 | **독립 상시 데몬** `scripts/news-watch.mjs` (작업 스케줄러가 로그인 시 시작, 실패 시 1분 뒤 재시작). |

## 범위 밖

- 일반 뉴스의 호재/악재 감성 판정과 점수 반영 (데이터를 쌓은 뒤 측정으로 판단)
- 공식 호재 공지의 점수 가산 (측정 스크립트는 이 작업에 포함하되, 가산 여부는 결과를 보고 별도 결정)
- 자동매매

## 아키텍처

```
news-watch.mjs (루프)
  ├─ lib/news/sources/{coinness,upbit,binance,bithumb}.mjs   수집기 → NewsItem[]
  ├─ lib/news/match.mjs      NewsItem → 업비트 KRW 마켓[]
  ├─ lib/news/classify.mjs   → { kind, type, tags }
  ├─ lib/news/store.mjs      news-state.json(본 id) · news-log.jsonl(누적)
  ├─ lib/news/route.mjs      알림 대상 판정 · 6시간 중복 묶기 · 메시지 생성
  └─ lib/exchange-events.mjs (기존) 공식 악재/해제 → event-log.json → 스캐너 점수
```

각 모듈은 순수 함수 중심으로 쓰고, 네트워크·파일 입출력은 주입(deps) 가능하게 해서 테스트한다. 기존 `ensureEvents`의 deps 패턴과 같다.

### 공통 형식 `NewsItem`

```js
{ id: 'coinness:1171041', source: 'coinness'|'upbit'|'binance'|'bithumb',
  title, body: string|null, ts: ISO string|null, url: string|null,
  important: boolean,          // 코인니스 isImportant, 공지는 false
  codes: string[] }            // 소스가 준 코인 코드(코인니스 originCodes), 없으면 []
```

### 수집기 (sources)

| 소스 | 엔드포인트 (2026-10-07 확인) | 주기 | 비고 |
|---|---|---|---|
| 코인니스 | `GET https://api.coinness.com/feed/v3/breaking-news?languageCode=ko&limit=30` | 60초 | 최신 30건. 1분에 30건을 넘을 일이 없어 페이지 넘김 불필요. `originCodes`, `isImportant`, `publishAt` 사용 |
| 업비트 | 기존 `fetchUpbitAnnouncements` (api-manager announcements, 1페이지 30건) | 60초 | 재사용 |
| 바이낸스 | 기존 `fetchBinanceAnnouncements` + 신규 상장 catalog(48) | **5분** | 비공식 CMS, 연속 호출 시 레이트리밋 기록 있음(Phase 1 스펙) |
| 빗썸 | `GET https://api.bithumb.com/v1/notices?count=20` (공식 API) | 120초 | `categories`(입출금·거래유의 등), `published_at`(KST) |

- 모든 수집기는 **실패 시 빈 배열**을 돌려주고 예외를 던지지 않는다. 타임아웃은 8초다.
- 한 사이클의 소스들은 병렬로 받는다. 각 소스는 자기 주기가 된 사이클에만 호출한다.

### 코인 매칭 (match)

업비트 KRW 마켓 목록(`getMarkets`: 티커, 한글명, 영문명)을 1시간마다 갱신한다. 우선순위는 다음과 같고, 결과는 합집합이다.

1. `codes`(소스 제공 코드) → `KRW-<code>`가 유니버스에 있으면 매칭
2. 괄호 티커 `(SOPH)` — 기존 `parseTickers` 재사용(기준통화 괄호 제외)
3. 한글명: 앞뒤 글자가 한글이 아닐 때만. 3글자 이상만 매칭한다.
4. 영문 티커 단독 대문자 단어: 3글자 이상. 일반어와 겹치는 티커는 `AMBIGUOUS_TICKERS`(ONE, GAS, MOVE, AI 등)로 제외한다.

오탐은 제외 목록에 추가해서 고친다. 매칭 근거(`via: code|paren|ko|en`)를 로그에 남긴다.

### 분류 (classify)

| kind | type | 판정 근거 | 처리 |
|---|---|---|---|
| `official-risk` | delist / caution / halt | 기존 `classifyAnnouncement` (업비트·바이낸스·빗썸 공지) | `event-log.json` 반영(점수) + 알림 대상 |
| `official-clear` | resume | 기존 규칙 | 감점 해제 |
| `official-listing` | upbit-krw / binance-spot / binance-futures / bithumb-krw | 신규 규칙: "KRW 마켓 디지털 자산 추가", "신규 거래지원 (KRW", "Binance Will List", "Will Launch … Perpetual", 빗썸 원화 마켓 추가 | **저장 + 알림만** |
| `news` | — | 코인니스 일반 속보 | 저장 + 알림 판정 |

일반 뉴스에는 키워드 태그를 단다: 해킹(해킹·익스플로잇·탈취), 규제(SEC·소송·기소·제재), 고래(이체·매수·매도 + 금액/수량), 파트너십(파트너십·MOU·협력), 언락(언락·락업 해제), 업그레이드(메인넷·업그레이드·하드포크), 소각(소각·바이백). 태그는 알림 문구와 나중의 측정에만 쓰고, 점수에는 쓰지 않는다.

빗썸 공지는 `categories`가 "거래유의"면 caution, "입출금"이면 제목 규칙으로 halt/resume을 판정한다. 빗썸은 업비트가 아니므로 **점수 배수는 업비트 공지보다 약하게**(유의 ×0.8, 입출금 중단 ×0.85) 적용하고, 상폐는 알림만 한다(업비트 상폐가 아니므로 제외하지 않는다).

### 저장 (store)

- `data/news-state.json`: `{ seen: { [id]: firstSeenISO }, lastLoopAt, sourceFail: { [source]: { since, notified } }, alerted: { [market|type]: ISO } }`. seen은 7일, alerted는 6시간 지나면 정리한다. 쓰기는 기존 `withLock`/원자적 `writeJson`을 쓴다.
- `data/news-log.jsonl`: 새 항목마다 한 줄 `{ ts, seenAt, source, id, title, url, markets, via, kind, type, tags, important }`. 측정용이다. `.gitignore`에 추가한다.

### 알림 (route)

알림 대상 = 아래 중 하나라도 해당하는 새 항목이다.

- 매칭 코인이 **보유 포지션**(`positions.json`) 또는 **현재 후보**(monitor-log 최신 buy ∪ momentum-log 최신 picks)에 있다.
- 코인니스 `important === true`
- `official-listing`이면서 매칭 코인이 업비트 KRW에 있다.
- `official-risk`이면서 매칭 코인이 보유 또는 후보에 있다. 그 외의 공식 악재 알림은 기존처럼 monitor의 `notifyEventAlerts`가 맡는다(중복 방지).

중복 묶기: 같은 `market|type`(뉴스는 `market|news`)이 6시간 안에 다시 오면 알림을 보내지 않고 로그에만 남긴다. 한 사이클의 알림은 메시지 하나로 합친다. 형식은 이렇다.

```
📰 뉴스·공지 (22:41)
🟢상장 · 업비트 · 뉴메레르(NMR) KRW 마켓 디지털 자산 추가
⭐중요 · 코인니스 · 미 10년물 국채 수익률 5.35%, 2002년 이후 최고
💼보유 · 코인니스 · [고래] 2,500 BTC 이체… 익명 → 비트파이넥스
```

### 첫 실행과 재시작

`news-state.json`이 없으면 첫 사이클에 받은 항목을 **모두 seen으로만 기록하고 알림을 보내지 않는다**(켜자마자 수십 건이 쏟아지는 것 방지). 재시작할 때는 seen이 남아 있으므로 그동안 놓친 새 항목만 처리한다.

### 장애 처리

- 소스 실패는 해당 소스만 건너뛴다. 30분 연속 실패하면 "⚠️뉴스 소스 중단: 바이낸스"를 한 번 보내고, 회복되면 "✅ 회복"을 보낸다.
- 루프 본문 전체를 try/catch로 감싼다. 한 사이클이 실패해도 다음 사이클은 진행한다.
- 매 사이클 `lastLoopAt`을 기록한다. `monitor.mjs`는 정시 스캔 때 `lastLoopAt`이 10분 넘게 갱신되지 않았으면 "⚠️뉴스 데몬 정지"를 알린다(하루 1회로 제한).
- 작업 스케줄러 등록은 `scripts/install-scheduler.ps1`에 `UpbitNewsWatch`를 추가한다(로그인 시 시작, 실패 시 1분 간격으로 재시작, 여러 인스턴스 금지).

## 측정 (호재 공지 점수 가산 판단용)

`scripts/research/news/listing-effect.mjs`:

- 업비트 공지(api-manager 페이지 넘김)와 바이낸스 신규 상장 catalog의 과거 공지를 수집하고, 공지 시각 기준으로 업비트 KRW 가격(분봉·일봉)을 붙인다.
- 공지 직후, +5분, +1시간, +1일 진입 시의 1h/24h/7d 초과수익을 같은 시각 전 종목 평균 대비로 잰다. 공지 유형별(업비트 KRW 추가 / 바이낸스 현물 / 바이낸스 선물)로 나눈다.
- 결과는 README에 기록한다. 점수 가산 여부는 **사용자와 결과를 본 뒤 결정**한다. 이번 작업에서는 가산을 구현하지 않는다.

## 테스트

- 수집기: 실제 응답을 축약한 고정 픽스처로 파싱을 시험하고, 실패·타임아웃 시 빈 배열을 돌려주는지 확인한다.
- 매칭: 괄호 티커, 한글명 경계("솔라나" vs "솔라나파이"), 모호 티커 제외, `codes` 우선을 시험한다.
- 분류: 각 공식 유형별 실제 제목 예시와, 빗썸 categories 처리를 시험한다.
- 라우팅: 보유·후보·중요·상장 조건, 6시간 묶기, 첫 실행 무알림을 시험한다.
- 데몬 한 사이클을 deps 주입으로 끝까지 돌리는 통합 테스트(네트워크 없음)를 둔다.
- 격리 디렉터리에서 실제 1사이클 실행(Telegram 끔)으로 수집·매칭 결과를 눈으로 확인한다.

## 이후 (이 스펙 밖, 사용자 요청)

이 작업이 끝나면 메인 스캐너·모멘텀·자금유입·뉴스 데몬 전체가 같은 방향(과열 회피 + 촉매 포착)을 보고 있는지 종합 점검한다.
