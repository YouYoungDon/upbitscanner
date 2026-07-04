# 코인게코 연동: 업비트 단독 펌프 감지 (Upbit Dominance) 설계

날짜: 2026-07-04
상태: 설계 승인 대기
관련: `docs/superpowers/specs/2026-07-04-momentum-scoring-engine-*.md` (스코어링 엔진 subsystem A)

## 목적

업비트 24h 거래대금을 코인게코의 글로벌 24h 거래대금과 비교해 **업비트 단독 점화(국내 세력/김프 펌프) 의심 코인을 감지**하고, 기존 `liquidityPenalty`와 동일한 패턴으로 **경고 라벨 + 점수 감점**을 적용한다. 시커·게임빌드 손절 사례처럼 "거래량은 급증했지만 업비트에서만 터진" 신호를 걸러내는 것이 목표.

## 실측 검증 (2026-07-04)

- Demo 키 정상 작동. base URL `https://api.coingecko.com/api/v3`, 헤더 `x-cg-demo-api-key`. 한도: 30콜/분, 10,000콜/월.
- `/coins/markets?vs_currency=krw&ids=...` → `total_volume`(글로벌 24h, KRW), `market_cap`, `market_cap_rank` 반환. **KRW 직접 지원 — 환율 변환 불필요.** `ids` 최대 250개/콜.
- 예시: 스페이스아이디(ID) 글로벌 24h 거래대금 약 648억 KRW, 업비트 약 200억 → **업비트 비중 30.9%** (임계 미달, 감점 없음 — 정상 범위 예시).

## 컴포넌트

### 1. `lib/coingecko.mjs` (신규)

- `loadApiKey()`: `COINGECKO_API_KEY` 환경변수 → 없으면 `data/coingecko-key.json`(`{"apiKey": "..."}`, **gitignore 필수**) → 둘 다 없으면 `null`.
- `fetchMarkets(ids, { apiKey })`: `/coins/markets?vs_currency=krw&ids=<250개씩>&per_page=250` 페이지 분할 호출. upbit.mjs `get()`과 동일한 지수 백오프(429/5xx 재시도, 4xx 즉시 포기).
- `fetchCoinsList({ apiKey })`: `/coins/list` — 매핑 재구축용.
- 키가 null이면 모든 fetch가 즉시 null 반환(무해).

### 2. 심볼 매핑 `data/coingecko-map.json`

- 구조: `{ builtAt, byMarket: { "KRW-ID": "space-id", "KRW-XYZ": null } }` — `null` = 코인게코에 없음(매 사이클 재시도 방지).
- 구축: 업비트 유니버스 심볼 ↔ `/coins/list` 심볼 대소문자 무시 매칭. **동일 심볼 충돌 시 `/coins/markets`로 후보들의 `market_cap_rank`를 조회해 순위가 가장 높은(숫자가 작은) 코인 선택.**
- 갱신: `builtAt` 7일 경과 또는 유니버스에 미등록 심볼 등장 시 재구축.

### 3. 시세 캐시 `data/coingecko-cache.json`

- 구조: `{ fetchedAt, byMarket: { "KRW-ID": { globalVolKrw, mcapKrw, rank, fdvKrw, circRatio, athChangePct, ret7dPct, ret30dPct } } }`
- **확장 필드(추가 콜 0)**: 같은 `/coins/markets` 응답에서 `fully_diluted_valuation`(→ `circRatio` = mcap÷FDV, 유통량 비율·언락 오버행 프록시), `ath_change_percentage`(ATH 대비 낙폭), `price_change_percentage_7d_in_currency`·`30d`(요청 파라미터 `price_change_percentage=7d,30d` 추가) 저장. **이번 사이클에선 감점 규칙에 쓰지 않고 데이터만 축적** — subsystem B 정량 검증 후 활용 판단. FDV 없는 코인은 `circRatio: null`.
- TTL 150분: 스캐너 시작 시 `fetchedAt`이 150분 이상 지났으면 갱신. 3시간 사이클의 첫 스캐너(monitor xx:00)가 보통 수행, momentum(xx:02)·flow(xx:05)는 캐시만 읽음.
- 쓰기는 store.mjs `withLock` + 원자적 `writeJson` 재사용(2026-06-29 경합 버그 재발 방지).
- 예상 사용량: 사이클당 1콜(유니버스 ~100-250종) × 8회/일 ≈ 월 250콜 + 주간 매핑 재구축. Demo 한도의 ~3%.

### 4. 판정 `upbitDominancePenalty()` (scan-universe.mjs에 추가)

```
upbitDominancePenalty(upbit24hKrw, globalVolKrw):
  globalVolKrw 없음/0 → { mult: 1.0, share: null, label: null }   // 중립
  share = min(1, upbit24hKrw / globalVolKrw)
  share ≥ 0.8 → { mult: 0.8, share, label: "⚠️업비트단독 NN%" }
  share ≥ 0.5 → { mult: 0.9, share, label: "⚠️업비트비중 NN%" }
  그 외       → { mult: 1.0, share, label: null }
```

- 적용 지점: monitor/momentum/flow에서 `liquidityPenalty`와 같은 곱셈 단계. 겹치면 곱연산(예: ×0.8 × ×0.8 = ×0.64).
- 아카이브 픽 엔트리에 `dominance: { share, mult }` + 확장 필드(`circRatio`·`athChangePct`·`rank`) 저장 → subsystem B(outcome tracking)에서 성과 정량 검증용.

## 명시적 비스코프 (다음 사이클 후보)

- `/global` BTC 도미넌스·글로벌 시총 (subsystem C 레짐 재료), `/search/trending` 교차확인 라벨, 픽 종목 `/tickers` 스프레드 조회 — 2026-07-04 사용자 결정으로 이번 스코프에서 제외.

## 의도적 설계 결정 (버그로 오인 금지)

- **스코어링 엔진(shadow) 피처로 지금 추가하지 않음.** subsystem A가 2026-07-04 출시돼 shadow vs 실제 비교 검증 중 — 피처 추가는 비교 기준을 오염시킴. 아카이브에 값만 쌓고, B에서 정량 검증 후 피처 승격 판단.
- **업비트도 글로벌 거래량에 포함**되므로 share는 자연히 0~1. 코인게코 total_volume에 워시트레이딩 거래소 물량이 섞여 share가 과소평가될 수 있음 → 임계값 0.5/0.9, 0.8/0.8로 보수적으로 시작, 몇 주 데이터 후 조정.
- **코인게코 미등록/신규 상장 코인은 중립**(감점·라벨 없음). 데이터 없음 ≠ 위험.

## 에러 처리 — 스캔 불사침 원칙

키 없음·429·타임아웃·매핑 실패·캐시 손상 등 어떤 코인게코 실패에도: 해당 코인(들) 중립 처리, 스캔·기존 점수·로그 기록은 무변. 로그 엔트리에 `cgCoverage`(유니버스 중 글로벌 데이터 확보 비율)만 기록해 관측 가능성 확보. `process.exit` 절대 금지.

## 테스트

- 단위: 임계 경계(0.5/0.8 정확값 포함), 글로벌 결측 중립, min(1,·) 캡, 심볼 충돌 rank 우선, null 매핑 재시도 억제, 캐시 TTL 판정, 키 부재 시 전 기능 무해 skip.
- 통합: fake fetch 주입 monitor 실행 → 감점 반영·라벨·아카이브 `dominance` 필드·캐시 파일 생성 검증.
- 기존 전체 테스트(256개) 통과 유지.

## 보안

- Demo 키는 `data/coingecko-key.json`에 저장하고 `.gitignore`에 추가. 코드·커밋·로그에 키 노출 금지.
