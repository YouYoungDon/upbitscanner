# 변경 이력 — 2026년 9월

## 1. 김치 프리미엄 (2026-09-04)

설계: `docs/superpowers/specs/2026-09-04-kimchi-premium-design.md`.
코인 네이티브 신호 3종(#1 김치프 · #2 펀딩비/OI · #3 언락) 중 첫째.

업비트(KRW) vs 바이낸스(USDT) 가격 괴리를 **시장 과열/심리 게이지(BTC 기준) +
코인별 플래그**로 노출. **표시·경고 전용, 점수 미개입**(노이즈 회피).

- **환율 = 업비트 KRW-USDT 시세** — 외부 FX API·키 불필요, 자기완결(스테이블코인
  프리미엄 포함). 바이낸스는 **매 스캔 신선 조회**(150분 캐시 시 현재KRW vs 과거USDT
  드리프트가 프리미엄을 오염 → 캐시 안 함). 라이브 업비트 시세(getTicker)로 산출 —
  확정 종가(어제)가 아닌 현재가로 시점 정합.
- `lib/binance.mjs`: 공개 `/ticker/price` 1콜 → USDT 페어 Map. 실패 시 null(스캔 무중단).
- `lib/kimchi.mjs`: computePremium/mapToBinance/premiumBand/coinFlag/ensureKimchi.
  게이지 밴드 `>+3% 과열 / −1~+3% 보통 / <−1% 디스카운트`, 코인 플래그는 BTC 대비
  상대 ±3%p(베이스라인 보정 → 개별 코인 국내 쏠림만 포착).
- 통합: monitor 매 스캔 `ensureKimchi(매수픽+KRW-BTC)` → item.kimchi{premium,flag},
  entry.kimchi{btcPremium,band,usdtKrw,coverage}. API buildResults 노출. 봇 /status
  게이지 줄. 대시보드 김치프 KPI 게이지 + 코인별 배지. 스캔 알림 시장라인 김치프.
- 비유한 입력 null 가드, 실패 전부 neutral(스캔 불사침). 테스트 +13(kimchi 11, 봇 2).
- **라이브 검증**: 스캔 #585 btcPremium +0.11% normal, 환율 1366, coverage 97%,
  매수 30/31 산출(1개 바이낸스 미상장 제외), 플래그 0건(현재 코인별 쏠림 없음).

**정직성**: 김치프는 심리/포지셔닝 게이지지 타이밍 신호가 아님 — 과열이 오래 지속될
수 있음. 표시·경고용, 자동매매·점수 개입 금지.

## 2. 펀딩비 점수 신호 (2026-09-04)

설계: `docs/superpowers/specs/2026-09-04-funding-rate-design.md`. 코인 네이티브 신호 #2.

바이낸스 무기한선물 펀딩비를 **매수 점수에 개입**(#1 김치프는 표시 전용, #2는 점수 개입).
매수 스캐너 기준 **(+)펀딩=롱 과밀→감점, (−)펀딩=숏 과밀 스퀴즈연료→가산**.

- `lib/binance.mjs::fetchFundingRates` — `/fapi/v1/premiumIndex` 1콜 전체 심볼 lastFundingRate.
- `lib/funding.mjs`: fundingScoreMult(**비대칭 — 감점 세게 ×0.82, 가산 약하게 ≤×1.06**),
  fundingSignal, ensureFunding(mapToBinance 재사용, neutral 폴백).
- 배수: `≥+0.10%→×0.82 / +0.05~0.10%→×0.92 / ±0.05%→×1.0 / −0.05~−0.10%→×1.04 / ≤−0.10%→×1.06`.
  방어(크롱된 롱 반전 회피)>공격(스퀴즈 베팅) — 소폰 회복 도구 철학.
- 통합: monitor 루프 전 `ensureFunding(targets)` → 배수군에서 finalBuyScore 조정 + 시그널.
  item.funding/entry.funding. signal-format 분류(과열→경고, 스퀴즈연료→근거).
  API·봇 /status·대시보드 게이지·배지·알림 라인. OI는 #2b로 연기.
- 점수 신호라 **스코어카드가 효과 자동 추적** → 향후 배수 재보정 가능.
- **라이브 검증**: 스캔 #586 커버리지 84%, 음수 펀딩 5픽(바운드리스·사인 −0.12% 등)
  스퀴즈연료 가산(×1.04~1.06) — 과매도 반등 후보가 숏 과밀이라 가산되는 의도된 엣지 발동.
- 실패 전부 neutral(mult 1) — 스캔 불사침. 테스트 488→500(funding 10·signal-format 1·봇 1).
