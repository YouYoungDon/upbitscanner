# 모의매매 1,000만 원 장부(XL) — 설계

작성 2026-10-22. 사용자 요청 "모의투자 돈을 천만 원으로", 목적 = **표본 늘리기**, 기존 장부는 그대로 두고 새 장부 추가.

## 1. 왜

기존 장부(50만 원·건당 5만 원·최대 10건)는 자리가 차서 못 산다(10-22: 메인·모멘텀·무작위 모두 9건 보유, 현금 부족 하루 8회).
자본만 1,000만 원으로 올리면 최대 10건 제한 때문에 달라지는 게 없다 — 보유 상한을 같이 올려 스캐너 픽을 사실상 전부 산다.
건당 금액(5만 원)은 그대로 두어 체결 비용 조건(호가 깊이·슬리피지)이 기존 장부와 같다.

## 2. 불변 조건

- `lib/paper.mjs`의 `PAPER` 상수·체결/청산 함수는 바꾸지 않는다(11-05까지 규칙 고정, 바뀌면 `modelChanges`).
- **기존 3장부(main·momentum·random)의 청산·진입 시각과 결과가 이 변경 전과 같아야 한다.** 한 실행에서 기존 장부를 먼저 끝내고 XL을 처리한다.
- 11-05 판정 규칙(스코어카드 기반, `lib/verdict.mjs`)은 바꾸지 않는다. XL 결과는 실체결 보조 근거다.

## 3. 구성

### 3.1 장부 정의 — `lib/paper-books.mjs` (새 파일)

```
BOOKS = [
  { key: 'main',        file: 'monitor-log.json',  picks: (s) => s.buy,      rule: 'main',     phase: 1 },
  { key: 'momentum',    file: 'momentum-log.json', picks: (s) => s.picks,    rule: 'momentum', phase: 1 },
  { key: 'random',      file: 'monitor-log.json',  picks: randomPicks,       rule: 'random',   phase: 1 },
  { key: 'main_xl',     file: 'monitor-log.json',  picks: (s) => s.buy,      rule: 'main',     phase: 2, ...XL },
  { key: 'momentum_xl', file: 'momentum-log.json', picks: (s) => s.picks,    rule: 'momentum', phase: 2, ...XL },
  { key: 'random_xl',   file: 'monitor-log.json',  picks: randomPicks,       rule: 'random',   phase: 2, ...XL, matchCount: 'main_xl' },
]
XL = { startCash: 10_000_000, maxOpen: 199, maxPerScan: 199 }
```
- 기존 3장부는 `startCash/maxOpen/maxPerScan`이 없어 `PAPER` 값을 쓴다(동작 동일).
- `rule`은 `exitRule(pick, rule, fill)`에 넘기는 값 — `main_xl`은 메인과 같이 픽의 `exit`(12/12/7)를 쓴다.
- `matchCount: 'main_xl'` — 그 스캔(`scanAt`)에서 `main_xl`이 산 포지션 수(보유+청산, 상태에서 센다)만큼만 산다.
  `main_xl`이 그 스캔을 아직 처리하지 않았거나 0건이면 0건.
- 새 장부는 생성 시 `startCash`·`startedAt`을 장부에 남긴다(`ensureBooks` 확장). 기존 장부엔 `startCash`가 없어 `PAPER.START_CASH`로 읽는다.

### 3.2 실행 순서 — `scripts/paper-trade.mjs`

`run()`: 상태 읽기 → **1단계(phase 1 장부): 청산 → 진입** → **2단계(phase 2): 청산 → 진입** → 평가금 → 저장(한 번).
- 시간봉·1분봉 조회를 실행 안에서 캐시한다: 시간봉은 시장별로 한 번(그 시장 보유 포지션 중 가장 오래된 진입에 맞춘 길이),
  1분봉은 `시장@시간` 키로 한 번. `scanExit`는 진입 이전 봉을 건너뛰므로 더 긴 시간봉을 받아도 결과가 같다.
- 잠금(5분 대기·20분 stale·하트비트)은 그대로. XL 보유가 수백 건이면 실행이 1~2분으로 늘어난다.

### 3.3 보기

- **리포트(`paper:report`)**: 장부별 출력은 장부마다 `startCash`로 수익률을 낸다. 판정 섹션에 "실체결 대조(XL): main_xl − random_xl"
  (`vsRandom`, 같은 스캔 짝)을 보조 지표로 추가한다.
- **대시보드**: 장부 이름표·색 3개 추가, 카드의 보유 상한은 장부별(`maxOpen`), 보유 중·종료 거래 표 위에 **장부 필터**(전체/장부별).
- **봇 `모의`**: 이름표 추가. 장부 6개를 그대로 나열.
- **`buildPaperView`**: 장부별 `startCash`로 `ret`·시장 대비 시작점을 계산하고 `maxOpen`을 넘긴다.
- **일일 점검**: 장부별 `startCash`로 수익률.

## 4. 오류 처리

- `random_xl`의 짝 장부(`main_xl`)가 없으면 0건(예외 없음).
- 캐시는 실패(null)도 캐시해서, 한 시장의 조회 실패가 같은 실행에서 같은 시장의 다른 포지션에 "조회 실패 — 다음 회차 재확인"으로 똑같이 적용된다(기존 동작과 같음).

## 5. 테스트

- `paper-books`: 장부 6개 키·phase 순서, XL 한도, 기존 장부엔 한도 필드 없음, `matchCount` 계산(보유+청산, 다른 스캔 제외, 짝 없음 → 0).
- `ensureBooks`: 장부별 시작 자본(새 XL 장부 1,000만 원, 기존 장부는 손대지 않음).
- `buildPaperView`: `startCash` 1,000만 원 장부의 `ret`, `maxOpen` 전달.
- `PAPER` 고정 테스트는 그대로 통과해야 한다.
- 실가동: 수동 1회 실행 → 기존 3장부 숫자 변화 없음(보유·현금·`modelChanges` 1건), XL 3장부 생성. 다음 정시 스캔 뒤 XL 진입·`random_xl` 건수 = `main_xl` 건수.

## 6. 범위 밖

- 기존 장부 설정 변경, 판정 규칙 변경, 건당 금액을 키운 "큰돈 체결 비용" 장부.

## 7. 리뷰 반영 (10-23)

- `/code-review`: 봇 손절 근접 장부당 5개, XL 청산 확인 시간 한도 2분, 평가금은 상장 목록으로 거르고 시세 없으면 `lastPrice`,
  호가 20종목씩, 종료 표 300줄, 대시보드 안내문을 데이터에서.
- 독립 리뷰(`upbit-reviewer`):
  - XL 대조(`vsRandom`)는 **두 장부 보유가 남은 스캔을 뺀다** — 일찍 끝나는 건 익절·손절 터치뿐이라 극단값만 섞였다. 기존 main−random 줄도 같다.
  - 시간 한도가 있으면 장부를 섞어 **진입이 오래된 포지션부터** 본다(장부 순서대로면 늘 `random_xl`만 미뤄짐). **기한이 된 포지션은 한도와 무관**하게 본다 — 기한 청산은 그때 호가로 체결해 늦으면 결과가 달라진다.
  - 1분봉은 **성공만 캐시**한다. 시간봉은 실패도 캐시하는데, 이건 같은 실행에서 같은 시장의 다른 장부 포지션까지 "다음 회차 재확인"으로 미룬다(예전엔 포지션마다 다시 조회) — 결과를 바꾸지 않고 미루기만 한다.
  - XL 최대 199건: 200건 × 5만 원 × (1+0.05%) = 10,005,000원 > 1,000만 원이라 200건째는 늘 현금 부족이었다.
- 첫 XL 진입분(10-22 12:38, 12:01·12:02 스캔)은 스캔 뒤 약 37분에 샀다(그 뒤로는 4~8초) — 모멘텀 XL 성과·지연 비용을 볼 때 이 묶음을 구분한다.
