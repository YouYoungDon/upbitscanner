# 조용한 바닥(선행 진입) 전략 설계 (2026-07-25)

## 목적

스코어카드 6주 데이터로 검증된 엣지 — "거래량이 조용할 때 깊은 과매도에서
진입한 픽만 돈이 됐다(+1일 승률 51% vs 추격 36%, RSI+Stoch 과매도 &
조용 시그니처는 +3일 승률 57%·평균 +2.1%·MFE +11%)" — 를 규칙으로
정식화한다. 그리드 백테스트로 파라미터를 확정하고, 스캐너가 매 스캔에서
시그니처 매칭 종목을 전략픽으로 태깅한다(진입가·손절가·목표가 포함).

근거 데이터 요점:
- 추격(거래량 급증 후 진입): +3일 승률 30%, 평균 -3.4% → 추격 경고 태그 신설.
- 레짐: 시그니처는 깊은 약세(ratio 0~0.2)에서 n=141 승률 57%로 오히려
  최고 성적 → 레짐 게이트를 두지 않는다. 레짐은 아카이브에 기록되므로
  표본이 쌓이면 재검토.
- 전략 규칙은 주간 가중치 학습과 완전 분리 — 파라미터는 백테스트로만 갱신.

## 전략 코어 (`lib/strategy.mjs`, 신규 · 순수 함수)

```
export function detectQuietBottom(confirmed, params)
// confirmed: confirmedOhlcv() 이후의 chronological 확정봉 배열
// params: { rsiMax, stochMax, volMax, minCandles: 60 }
// 판정: 확정봉 61개 이상 && RSI(14) <= rsiMax && Stoch K <= stochMax
//       && volRatio(21봉) <= volMax (거래량이 아직 조용함)
// 반환: { rsi, stochK, volRatio } 또는 null
// 지표는 lib/indicators.mjs의 calcRSI / calcStochastic / calcVolRatio 재사용.
// calcStochastic·calcVolRatio가 null을 반환하면(데이터 부족) null.

export function strategyLevels(entryPrice, params)
// params: { slPct, tpPct } (양수 %)
// 반환: { stopLoss: entry*(1-slPct/100), takeProfit: entry*(1+tpPct/100) }
// entryPrice <= 0 → null

export function simulateTrade(candles, entryIdx, params)
// 백테스트 시뮬 순수 함수 (라이브와 동일 규칙 보장을 위해 lib에 둠)
// candles: 확정봉 배열, entryIdx: 신호봉 인덱스
// 진입: candles[entryIdx+1].open (다음날 시가 — 룩어헤드 방지)
// 이후 최대 holdMax일 동안 각 봉에서:
//   low <= stopLoss → 손절 청산 (같은 봉에서 TP 동시 도달 시에도 손절 우선 — 보수적)
//   high >= takeProfit → 목표 청산
//   holdMax일째 봉 종가 청산
// 반환: { ret, exitIdx, reason: 'sl'|'tp'|'time' } 또는 null(진입 다음봉 없음)
```

파라미터 저장: `data/strategy-config.json` (git 추적, 기존
scoring-config.json과 동일 정책):

```
{ "version": "quiet-bottom-v1", "confirmedAt": "<백테스트 확정 ISO>",
  "rsiMax": <int>, "stochMax": <int>, "volMax": <float>,
  "slPct": <float>, "tpPct": <float>, "holdMax": <int> }
```

## 그리드 백테스트 (`scripts/strategy-backtest.mjs`, 신규)

1. 유니버스: `getMarkets()` 전체 KRW 마켓 (스캔과 동일 소스, 상장폐지 예정
   제외 로직은 불필요 — 과거 캔들만 사용).
2. 종목당 `getDayCandles(market, 200)` 1회 → `confirmedOhlcv`. 200ms 간격
   (기존 backtest.mjs와 동일한 rate limit 정책).
3. 워밍업 60봉 이후 각 봉 i에서 `detectQuietBottom(slice(0,i+1))` 판정.
   매칭 시 `simulateTrade`. 청산 전 재진입 금지(같은 종목은 exitIdx 이후부터
   다음 신호 탐색).
4. 그리드: rsiMax {26,30} × stochMax {15,20} × volMax {1.5,2.0} ×
   slPct {5,7,10} × tpPct {8,12,18} × holdMax {3,5,7} = 216조합.
   캔들은 조합과 무관하게 종목당 1회만 fetch하고, 조합 루프는 로컬 연산.
5. 조합별 산출: `{ trades, winRate, avgRet, expectancy(=avgRet),
   tpRate, slRate, timeRate }`. `data/strategy-backtest-results.json`에
   전체 저장(gitignore 아님 — 근거 보존을 위해 git 추적) + 콘솔 상위 10개.
6. **파라미터 선정 기준(자동)**: trades >= 80 인 조합 중 avgRet 최대,
   동률이면 winRate 높은 쪽. 선정 결과를 strategy-config.json에 기록.
   (거래수 하한은 과최적화 방지 — 80 미만 조합은 통계 신뢰 부족으로 제외)

## 라이브 태깅 (scripts/monitor.mjs 수정)

- 매수 후보 item 생성 지점(`buy.push(item)` 직전)에서, 해당 종목의 확정봉
  (`confirmedOhlcv` 결과 — 신호 판정에 이미 사용 중인 배열)로
  `detectQuietBottom(confirmed, config)` 판정.
- 매칭 시:
  - `buySignals`에 `'🎯전략(조용한바닥)'` 태그 추가
  - `item.strategy = { stopLoss, takeProfit }` (기준가 = `sig.price`,
    `strategyLevels`로 계산, 소수 2자리 반올림)
- config는 `data/strategy-config.json`을 `readJson`으로 로드. 파일이 없으면
  전략 태깅 전체 스킵(스캔은 정상 진행).
- 점수는 변경하지 않는다 (표시 전용).

## 추격 경고 (scripts/monitor.mjs 수정)

- 매수 후보의 `volRatio >= 5` (signals.mjs가 반환하는 `sig.volRatio` 사용)
  이면 `buySignals`에 `'⚠️추격주의(급등후)'` 태그 추가. 점수 변경 없음.
- 근거: 급증 후 진입 +3일 승률 30%·평균 -3.4%.
- **[개정 2026-08-01]** 라이브 첫 주 실증(+1일 평균 -8.64%, n=12)으로
  표시 전용 → **점수 ×0.8 감점**으로 승격. 상세:
  2026-08-01-weekly-analysis-improvements-design.md §5.

## UI (public/app.js 최소 수정)

- 신호 태그는 기존 렌더링에 자동 표시 (`🎯전략(조용한바닥)`,
  `⚠️추격주의(급등후)` — signalTags가 그대로 그림).
- 홈 탭 매수 목록에서 `item.strategy`가 있으면 해당 행에 한 줄 추가:
  `손절 {fmt(stopLoss)} · 목표 {fmt(takeProfit)}` (기존 vbottomSL 표시와
  같은 위치/스타일이 있으면 그 패턴을 따른다).

## 스코어카드 연동 (작업 불필요 — 확인만)

에피소드는 진입 시점 signals를 스냅샷하므로 `🎯전략(조용한바닥)` 태그가
자동 포함된다. 이후 전략픽 성적은
`signals.some((s) => s.includes('🎯전략'))` 필터로 분리 조회 가능
(주의: `signals.includes('🎯전략')`는 완전일치 비교라 전체 태그 문자열
`'🎯전략(조용한바닥)'`에 매칭되지 않는다).

## 에러 처리

- strategy-config.json 없음/손상 → 전략 태깅 스킵, 스캔 정상.
- 백테스트 중 fetch 실패 종목 → 건너뜀 (콘솔 카운트).
- detectQuietBottom은 지표 null(캔들 부족) 시 null — 예외를 던지지 않는다.

## 테스트 (vitest, fetch 전부 mock)

- `detectQuietBottom`: 경계값(RSI==rsiMax 포함, 초과 제외 / Stoch / vol),
  캔들 부족 → null, 지표 null → null.
- `strategyLevels`: 계산 정확성, entry 0 → null.
- `simulateTrade`: 다음날 시가 진입 / SL 도달 청산 / TP 도달 청산 /
  SL·TP 동시 도달 시 SL 우선 / 시간 청산 / 마지막 봉 신호(다음봉 없음) → null.
- monitor 통합은 순수 함수 조합이므로 태그 문자열 생성만 단위 확인.

## 명시적 비범위 (YAGNI)

- 자동 매매 / 주문 연동 없음 (표시 전용).
- 텔레그램 알림 없음 (이번 라운드).
- 떨어지는칼 필터·콤보 배수 변경 없음 (백테스트 근거가 더 쌓이면 다음에).
- 레짐 게이트 없음 (데이터 근거: 깊은 약세에서 최고 성적).
