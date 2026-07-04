# 스캐너 전체 감사 (2026-07-04)

전체 코드 리뷰(lib 20 / scripts 8 / server 3 / scoring 14 / tests 24+)에서 나온 발견과 처리 상태.
메카니컬 버그 8건은 당일 수정·머지됨(커밋 4a40c15~8266057). 설계 레벨 항목은 미착수 — 아래 "남은 항목" 참조.

## 수정 완료 (2026-07-04, 커밋 4a40c15~8266057)

| # | 항목 | 수정 |
|---|------|------|
| H2 | `return r.json()`이 파싱 reject를 재시도/catch 밖으로 전파 → 응답 1개 손상에 스캔 전체 사망 | upbit.mjs·coingecko.mjs `await r.json()` (4a40c15) |
| H3 | fetch 타임아웃 부재 (undici 기본 300s) → 소켓 행에 스캔 수 분 정지 | upbit/cg 10s, Telegram 전 지점 5s AbortSignal (53fe4b4, 8266057) |
| M1 | momentum/flow/flow-alert-state/weekly 읽기-수정-쓰기 락 부재 (monitor만 고쳐져 있었음) | monitor 패턴(withLock+fresh 재읽기) 적용 (8c30953) |
| M8 | appendScan이 monitor 락 밖 → 동시 실행 시 JSONL 줄 인터리빙 가능 | 락 블록 안으로 이동 (7e28dc7) |
| L1 | calcStochastic 최소 길이 가드 오프바이원 (18개 입력 시 prevD undefined 침묵) | 가드 +1, 경계 테스트 (0c6ace8) |
| L6 | Telegram 전송 실패에도 알림 억제창 시작 → 알림 조용히 유실 | sendTelegram r.ok 반환 + 성공 시에만 상태 갱신 (c603103) |
| L7 | trend-journal 비원자 쓰기 → 크래시 시 저널 손상 | temp+rename (56cfa44) |

## 남은 항목 — 설계 레벨 (별도 사이클 권장, 우선순위 순)

### H1. 일봉 스캐너가 형성 중인 미확정 캔들로 신호 판정 ★최우선
- monitor/momentum은 진행 중 일봉(UTC 리셋)을 포함한 채 MACD/Stoch GC·거래량비·EMA를 계산. flow-scan만 `.slice(0,-1)`로 제외.
- 결과: ① 장중 크로스가 종가에 소멸해도 신호 발화(시커 SKR 손절의 구조적 원인), ② volR이 시각 편향(09시 스캔은 거래량 신호 거의 불가, 밤 스캔은 과대) — 거래량 콤보·칼필터·persistence 모두 오염, ③ scoring 피처 전부 동일 문제.
- 제안: 크로스·확인성 신호는 완성봉(slice(0,-1)) 판정, 현재봉 신호는 `[미확정]` 태그 분리, volR은 경과시간 보정 또는 완성봉 통일. **신호 의미가 바뀌는 변경이라 shadow 검증 중인 스코어링과의 비교 오염 고려해 시점 결정 필요.**

### M3. GAME2형 무거래량 약신호 미차단
- 순수 오실레이터 스택(RSI+BB+Williams)만으로 threshold 5 통과 가능 — 게임빌드 -17% 패턴. 확인 신호(거래량/GC/패턴) 1개 요구 또는 무거래량 점수 상한+태그. H1 수정 후에 해야 공정.

### M2. API 부분 실패가 조용한 데이터 축소로 오독
- 티커 청크/캔들 실패가 그냥 skip → 시장심리 왜곡, tradePrice undefined → ×0.6 오감점. fetchFailures 기록 + 임계 초과 시 스캔 실패 처리 + tradePrice 없으면 감점 대신 스킵.

### M4. 상장 60~200일 코인 EMA200·신고가 점수 부풀림 (momentum)
### M5. scan-archive.jsonl 무제한 누적 (연 50MB+ 전망) — 월별 로테이션 + scoring 요약화
### M6. weekly calcTimedHitRates 중복 호출·조용한 표본 탈락 — 캐시 + null 카운트
### M7. 가중치 학습이 보유기간 혼재 적중률 사용 — +3일 고정 윈도우로 교체
### L2~L5, L8~L10 (상세는 아래)

- L2: hasStochGC가 모든 '골든크로스' 문자열에 매칭 (EMA GC도 ×1.4 보너스) — 의도 확인 필요
- L3: 쌍봉 패턴 두 고점 최소 간격 없음 → 둥근 고점 오탐
- L4: fallingKnife가 '거래량 선행 매집'을 거래량 증거로 안 침 — 설계 판단 필요
- L5: persistence streak이 시간 무시 — 수동 스캔 연타로 +2 가능, 최소 간격 요구
- L8: scoring vsOwnHistory 히스토리에 현재봉 자기 포함 → 백분위 상향 편향
- L9: config에 없는 레지스트리 피처 무경고 배제 — subsystem B~E 추가 시 함정
- L10: withLock 30s 타임아웃 시 살아있는 락 강제 삭제 — throw+재시도가 더 안전

## 테스트 공백 (위험 순)
1. 미확정 캔들 계약(H1) 무테스트 — flow의 slice(0,-1)조차
2. scripts/ 점수 조립 파이프라인 무테스트 — 순수 함수 추출(`assembleScore`) 권장
3. withLock 실제 경합(탈취/타임아웃 분기)
4. weekly calcTimedHitRates
