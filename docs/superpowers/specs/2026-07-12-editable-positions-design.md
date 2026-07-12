# 포지션 직접 편집 — 설계

작성일: 2026-07-12

## 배경

보유 포지션은 `data/positions.json`(수동 편집 파일)에 저장되고, 종합 페이지에 게이지 카드로 **읽기 전용** 표시된다. 지금은 사용자가 어떤 코인을 얼마에 샀는지 말하면 사람이 파일을 직접 편집해야 한다. 사용자가 대시보드에서 **직접** 추가·수정·삭제할 수 있게 만든다.

## 목표

- 대시보드 UI에서 포지션 추가/수정/삭제
- 데이터 모델은 그대로 유지: `{ market, korean_name, entry, stopLoss, takeProfit }` (수량·투자금 없음, 손익은 % 표시)
- 읽기 화면(게이지 카드)의 깔끔함 유지 — 편집은 별도 모달로 분리

## 비목표 (YAGNI)

- 수량/투자금/실현손익(KRW) 추적
- 매매내역·청산 기록
- 인증/권한 (로컬 127.0.0.1 단독 사용)
- 다중 사용자 동시 편집 대응(락) — monitor는 읽기만 하므로 원자적 쓰기로 충분

## 데이터 모델

```json
[
  { "market": "KRW-SOPH", "korean_name": "소폰", "entry": 60, "stopLoss": 55.2, "takeProfit": 78 }
]
```

- `market`: `^KRW-[A-Z0-9]+$` (고유 키)
- `korean_name`: 표시용. 폼에서 생략 시 마켓 목록에서 채운다
- `entry`: 필수, 양수
- `stopLoss`, `takeProfit`: 선택. **둘 다 있으면 `takeProfit > stopLoss`** (게이지 전제와 일치)

## 아키텍처

### 백엔드

**`lib/positions.mjs`** — 순수/테스트 가능 함수 추가
- `writePositions(list)`: 기존 `store.writeJson('positions.json', list)` 재사용 — 이미 원자적(temp+rename, Windows 포함 덮어쓰기)이고 검증됨. `POSITIONS` 경로와 동일 파일로 해석됨. 별도 원자 로직 만들지 않음
- `validatePosition(input, { markets })`: 입력을 검증·정규화해 `{ ok, position }` 또는 `{ ok: false, error }` 반환. 규칙:
  - `market` 형식 불일치 → 실패
  - `entry` 숫자·양수 아니면 실패
  - `stopLoss`/`takeProfit`가 있으면 숫자·양수여야 함. 둘 다 있으면 `takeProfit > stopLoss` 아니면 실패
  - `korean_name` 없으면 `markets`(마켓목록)에서 조회, 없으면 market 그대로
  - 반환 position은 화이트리스트 필드만 (여분 필드 제거)
- `upsertPosition(list, position)`: `market` 기준으로 교체(있으면) 또는 추가. 새 배열 반환
- `deletePosition(list, market)`: 해당 market 제거한 새 배열 반환

`readPositions` / `evalPositions` / `POSITIONS` 는 그대로 둔다.

**`server/server.mjs`** — 라우트 추가
- `readBody(req)`: 요청 본문을 크기 상한(예: 16KB)으로 읽어 JSON 파싱. 초과·파싱 실패 시 예외
- `POST /api/positions`:
  1. 본문 파싱
  2. 마켓 목록(`cachedMarkets()`)으로 `validatePosition` 실행 — 실패 시 400 + `{ error }`
  3. `readPositions()` → `upsertPosition` → `writePositions`
  4. 200 + `{ ok: true }`
- `DELETE /api/positions?market=KRW-X`:
  1. market 형식 검증 — 실패 시 400
  2. `readPositions()` → `deletePosition` → `writePositions`
  3. 200 + `{ ok: true }`
- `GET /api/ticker?market=KRW-X`: `getTicker([market])`로 현재가 1개 반환 `{ market, price }`. 폼의 "현재가로 채우기"용. 조회 실패 시 `{ price: null }`
- 기존 `GET /api/positions` 는 그대로

### 프론트엔드

**`public/app.js`** — 종합(`home`) 라우트 내 포지션 섹션 개편
- 포지션 카드 헤더에 **＋추가** 버튼. **포지션이 없어도 카드는 항상 렌더**(현재는 `''`로 숨김) → 빈 상태 문구 + 추가 버튼 노출
- 각 포지션 카드 우상단에 **✏️편집 / 🗑삭제** 버튼. 카드 클릭(→개별분석 이동)과 겹치지 않게 `event.stopPropagation()`
- **모달 폼**(daisyUI `modal`):
  - 추가: 코인 검색 입력 + 필터 리스트(개별분석 `renderList` 패턴 재활용, `marketsList` 캐시 공유)
  - 편집: 코인은 고정 표시(변경 불가 — 다른 코인은 삭제 후 추가)
  - 입력: 진입가(필수) / 손절가(선택) / 목표가(선택)
  - 코인 선택 시 `GET /api/ticker`로 현재가 힌트 표시 + "현재가로 채우기" 버튼(진입가에 채움)
  - 저장 → `POST /api/positions`, 취소 → 닫기
  - 클라이언트측 1차 검증(빈 진입가·TP≤SL) 후 전송, 서버가 최종 검증
- 저장/삭제 성공 시 `routes.home()` 재호출로 갱신. 삭제는 `confirm()` 확인

**`public/styles.css`** — 모달·편집버튼 최소 스타일(네온 테마 일관). 기존 `.pos-*` 유지, 카드 액션 버튼용 `.pos-actions` 정도 추가

## 데이터 흐름

```
[추가/편집 모달] --POST /api/positions--> validatePosition -> upsert -> writePositions(atomic)
[🗑 삭제]        --DELETE /api/positions--> deletePosition -> writePositions(atomic)
성공 -> routes.home() -> GET /api/positions(evalPositions) -> 게이지 카드 재렌더
[코인 선택]       --GET /api/ticker--> 현재가 힌트
```

## 에러 처리

- 서버 검증 실패 → 400 + `{ error }`, 모달에 메시지 표시(모달 유지)
- 쓰기 실패(디스크 등) → 500, 모달에 "저장 실패" 표시
- `/api/ticker` 실패 → 힌트만 생략, 폼은 정상 동작
- 잘못된 JSON 본문/과대 본문 → 400

## 테스트 계획

`__tests__/positions.test.mjs` 확장 (순수 함수 위주, 서버 기동 없이):
- `validatePosition`: 정상 정규화 / market 형식 오류 / entry 누락·음수 / TP≤SL 거부 / TP·SL 한쪽만 있을 때 허용 / korean_name 마켓목록 보충 / 여분 필드 제거
- `upsertPosition`: 신규 추가 / 같은 market 교체(중복 안 생김)
- `deletePosition`: 제거 / 없는 market은 무변화

`writePositions`는 검증된 `store.writeJson`을 감싸는 얇은 래퍼이므로 별도 단위테스트 없이 순수 함수(validate/upsert/delete) 중심으로 검증. 기존 `evalPositions` 테스트는 유지.

## 롤아웃

- 새 API 라우트 추가 → **대시보드 서버 재시작 필요**(운영 메모 규칙)
- 완료 후 `docs/CHANGELOG-2026-07.md`에 항목 추가
