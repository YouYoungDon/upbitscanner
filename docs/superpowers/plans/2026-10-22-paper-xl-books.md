# 모의매매 XL 장부 — 구현 계획

**Spec:** `docs/superpowers/specs/2026-10-22-paper-xl-books-design.md`
**전역 제약:** `PAPER`·체결/청산 함수 불변. 기존 3장부는 1단계에서 먼저 처리. XL = 1,000만 원·최대 199건·스캔당 200건·건당 5만 원.

### Task 1: `lib/paper-books.mjs` + `ensureBooks` 장부별 시작 자본
- 테스트(`__tests__/paper-books.test.mjs`): BOOKS 키 순서·phase, XL 한도, 기존 장부 한도 필드 없음, `limitsOf(book)` 기본값 = PAPER,
  `matchCount(state, 'main_xl', scanAt)` = 보유+청산 중 같은 scanAt 수(다른 스캔 제외, 장부 없으면 0).
- 테스트(`__tests__/paper.test.mjs`): `ensureBooks(books, keys, iso, startCashOf)` — 새 장부는 그 자본·`startCash` 기록, 기존 장부 불변.
- 구현 → 통과 → 커밋.

### Task 2: `scripts/paper-trade.mjs` 2단계 실행 + 조회 캐시
- `SOURCES` → `BOOKS`. `checkExits(st, now, keys)`·`enterNew(st, now, keys)`가 장부 목록을 받는다. `run()`은 phase 1 → phase 2.
- `selectEntries(book, picks, limits)`·현금 체크는 장부 한도. `random_xl`은 `maxPerScan = matchCount(...)`.
- 시간봉 캐시(시장별, 가장 오래된 진입 기준 길이)·1분봉 캐시(시장@시간).
- 출력 수익률은 장부별 시작 자본.
- 확인: `node --check`, 전체 테스트, 수동 1회 실행 → 기존 3장부 보유·현금·modelChanges 불변, XL 3장부 생성.

### Task 3: 보기 — `buildPaperView`·리포트·대시보드·봇·일일 점검
- 테스트(`__tests__/paper-summary.test.mjs`): `startCash` 1,000만 원 장부의 `ret`, `maxOpen` 전달.
- 테스트(`__tests__/bot-commands.test.mjs`): `main_xl` 이름표.
- 리포트: 장부별 시작 자본, 판정 섹션에 `vsRandom(main_xl, random_xl)`.
- 대시보드: 이름표·색, 카드 보유 상한, 표 위 장부 필터(정렬과 함께 동작). Edge로 실제 확인.
- 일일 점검: 장부별 시작 자본.

### Task 4: 문서·실가동·커밋
- README 모의매매 절, 10월 변경 이력. 다음 정시 스캔 뒤 XL 진입과 `random_xl` 건수 = `main_xl` 건수 확인. 푸시.
