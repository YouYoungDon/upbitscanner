# 김치 프리미엄 (#1) 설계

코인 네이티브 신호 3종 중 첫 번째. 업비트(KRW) vs 바이낸스(USDT) 가격 괴리를
시장 과열/심리 게이지 + 코인별 플래그로 노출. **표시·경고 전용, 점수 미개입.**

**목표:** "지금 국내(업비트) 시장이 글로벌 대비 얼마나 과열/공포인가"를 한 숫자로,
그리고 특정 코인이 국내에서 유독 추격당하는지를 플래그로 보여준다. 소폰 -86%
회복 도구의 방어·맥락 축([[user-motivation-recovery]]) 연장.

## 핵심 결정 (brainstorming 확정)

1. **시장전체 게이지(BTC 기준) + 코인별 플래그.** 점수 직접 개입 안 함(노이즈 회피).
2. **환율 = 업비트 KRW-USDT 시세** (외부 FX API 없이 자기완결, 스테이블코인 프리미엄 포함).
3. **게이지 = BTC 프리미엄** (교과서적 김치프, 노이즈 적고 해석 명확).

## 아키텍처 (코인게코/cg-data 패턴 준수)

### `lib/binance.mjs` (신규) — 원시 API
- `fetchBinancePrices(opts?) -> Map<symbol, number> | null`
  `https://api.binance.com/api/v3/ticker/price` 1콜로 전체 USDT 심볼 시세. 공개 API
  (키 불필요). `AbortSignal.timeout`. 실패 시 null(스캔 무중단).

### `lib/kimchi.mjs` (신규) — 순수 + 캐시
- `computePremium(krwPrice, binanceUsdt, usdtKrw) -> number | null`
  `krwPrice / (binanceUsdt * usdtKrw) - 1`. 입력 하나라도 유효치 아니면(≤0/비유한) null.
- `mapToBinance(market) -> string`  `'KRW-BTC' -> 'BTCUSDT'` (KRW- 제거 + USDT).
- `premiumBand(pct) -> 'overheat'|'normal'|'discount'|null`  게이지 밴드 분류.
- `coinFlag(coinPremium, btcPremium) -> 'overheat'|'discount'|null`  BTC 대비 상대.
- `ensureKimchi(targets, { allowFetch, now }) -> { byMarket, btcPremium, usdtKrw, coverage, fetchedAt, reason? }`
  바이낸스 시세(캐시 `data/binance-cache.json`, TTL 150분 — 3시간 사이클 첫 스캐너만
  fetch) + 업비트 KRW-USDT 환율 조회. `byMarket[market] = { premium, binanceUsdt }`.
  coverage = 프리미엄 산출 성공 마켓 / 전체 targets.

### 상수 (lib/kimchi.mjs)
- `CACHE_TTL_MS = 150 * 60 * 1000` (cg와 동일)
- 게이지 밴드: `OVERHEAT_PCT = 0.03`, `DISCOUNT_PCT = -0.01`
- 코인 플래그: `COIN_FLAG_PCT = 0.03` (BTC 프리미엄 대비 ±3%p)

### 통합 (scripts/monitor.mjs)
- 스캔당 `ensureKimchi(targets, { allowFetch: true })` 1회.
- 마켓별 `item.kimchi = { premium }` 주입.
- 스캔 엔트리에 `entry.kimchi = { btcPremium, usdtKrw, coverage }` 저장(regime 옆).
- 실패해도 스캔 계속(cg 패턴).

## 데이터 흐름

바이낸스 1콜(전체 심볼) + 업비트 KRW-USDT 1콜 → 캐시 → 마켓별 프리미엄 계산.
KRW-USDT는 스캔 유니버스에서 빠질 수 있으므로 `getTicker(['KRW-USDT'])`로 별도 조회.

## 게이지·플래그 해석

- **게이지(BTC)**: `>+3% 과열 / −1~+3% 보통 / <−1% 디스카운트(공포·기회)`.
- **코인 플래그(BTC 대비 상대)**: `코인P − BTC_P ≥ +3%p → ⚠️국내과열`(추격 위험),
  `≤ −3%p → 💧디스카운트`. 베이스라인(전체 김치프) 보정으로 개별 코인의 국내 쏠림만 포착.
- 표시 전용. 점수·매수목록 개입 없음.

## 표면

- `/api/results` 스캔 엔트리에 `kimchi` 노출 + 매수 아이템에 `kimchi.premium`.
- 대시보드(public/app.js): regime 영역에 김치프 게이지(밴드 색), 매수표에 코인 프리미엄 배지.
- 봇 `lib/bot-commands.mjs::formatStatus`: 김치프 게이지 한 줄.
- 스캔 알림(monitor notifyTelegram) 시장 라인에 김치프 표기.

## 에러 처리

- 바이낸스/환율 조회 실패 → 해당 프리미엄 null, coverage 반영, 게이지 '-'. 스캔 무중단.
- 바이낸스 미존재 심볼 → 코인 프리미엄 null(coverage 집계).
- `computePremium` 입력 비유한/≤0 → null (NaN 전파 차단).

## 테스트

- `computePremium`: KRW 1억 / USDT 70000 / 환율 1400 → `1e8/(70000*1400)-1 ≈ +2.04%`
  수동검산. 비유한/0/음수 입력 → null.
- `mapToBinance`: `KRW-BTC→BTCUSDT`, `KRW-XRP→XRPUSDT`.
- `premiumBand`/`coinFlag`: 경계값(0.03, −0.01, ±0.03%p).
- `ensureKimchi` (fetch·getTicker 목킹): coverage 계산, 캐시 신선도(TTL), KRW-USDT 실패 시
  전부 null, 바이낸스 실패 시 coverage 0.

## 정직성

- 김치프는 **심리/포지셔닝 게이지지 타이밍 신호가 아님** — 과열이 오래 지속될 수 있음.
  표시·경고용, 자동매매 금지(점수 미개입 결정과 일치).

## 범위 밖 (YAGNI)

- 은행 USD/KRW 환율·스테이블코인 프리미엄 분해.
- 모멘텀 스캔 통합(monitor만).
- 김치프 히스토리 차트/추이.
- #2 펀딩비·#3 언락(별도 스펙).
