# 텔레그램 명령형 봇 설계 (2026-08-19)

## 목적

폰에서 텔레그램 봇에게 명령하면 즉시 응답하는 조회 전용 봇. 기존
upbit-dashboard 스캐너의 데이터·함수를 재사용해, 사용자가 자리에 없어도
폰에서 시장·코인·전략·포지션을 온디맨드로 확인한다.

사용자 결정(2026-08-19): 명령어 6종 전부 채택, chat_id 화이트리스트,
독립 폴링 프로세스(A안).

## 아키텍처

```
텔레그램 ──getUpdates(롱폴링 25s)──▶ scripts/telegram-bot.mjs
                                        │ chat_id 검증(내 것만)
                                        │ 명령 파싱
                                        ▼
                                   lib/bot-commands.mjs (테스트 대상)
                                    ├ 로컬 8787 API 조회(캐시 재사용)
                                    ├ 업비트 API 직접(실시간 시세·캔들)
                                    └ lib 재사용(analyzeMarket/indicators/ohlcv)
                                        │ 응답 텍스트(HTML) 생성
                                        ▼
                                   sendMessage
```

- `scripts/telegram-bot.mjs`: 상주 롱폴링 루프 + 디스패치(부수효과 담당).
- `lib/bot-commands.mjs`: 명령 파싱·심볼 해석·응답 포맷터(순수 로직, 테스트).
- `lib/notify.mjs`의 `readableSignals`를 monitor.mjs에서 lib로 승격해 봇과 공유
  (현재 monitor.mjs 내부 함수 → lib/notify.mjs로 이동, monitor는 import).

## 명령어 6종 + help

| 명령(별칭) | 동작 | 데이터원 |
|---|---|---|
| `/scan` | 수동 스캔 실행 → 매수 상위 5종 리치 포맷 | monitor 스캔 로직 + readableSignals |
| `/코인 <심볼>` (`/c`) | 심볼 해석 → 지표(RSI/Stoch/MACD/vol)·90일 위치·유의지정·조용한바닥 시그니처 | 업비트 직접 + analyzeMarket + market/all |
| `/status` (`/s`) | 시장심리·레짐·매수/매도 수·상위 매수 3종 | 8787 /api/results → 폴백 아카이브 |
| `/전략` | 🎯전략 승률·SL/TP/보유 + 보유목록 | 8787 /api/scorecard.strategy → 폴백 파일 |
| `/포지션` | positions.json 종목별 현재가·손절 근접도 | 8787 /api/positions → 폴백 파일 |
| `/스코어카드` | +1/3/7일 승률·에피소드 수 | 8787 /api/scorecard.horizons → 폴백 파일 |
| `/help` | 명령어 목록 | 정적 |

**심볼 해석**: `SOPH`·`소폰`·`KRW-SOPH` 모두 허용. 업비트 market/all의
한글명·영문심볼로 대소문자 무시 매칭. 미존재 시 "코인 없음 + 부분일치
후보 최대 3개" 응답.

## 데이터 흐름·에러 처리

- **로컬 API 우선**: `fetch('http://127.0.0.1:8787/api/...', timeout 3s)`. 실패
  (서버 down)하면 조회 명령은 데이터 파일 직접 읽기로 폴백. `/scan`·`/코인`은
  항상 업비트 직접(실시간성).
- **업비트 호출**: 타임아웃 10초. 실패 시 "업비트 응답 없음, 잠시 후 재시도".
- **긴 명령(`/scan`)**: 먼저 "⏳ 스캔 중…" 발송 후 완료 시 결과.
- **알 수 없는 명령**: `/help` 안내.
- **폴링 루프**: `getUpdates?offset=&timeout=25`. 처리한 update_id+1을 offset으로
  전진(중복 방지). 네트워크·파싱 오류는 catch 후 5초 백오프, 루프 유지(크래시
  금지). 봇 시작 시 밀린 메시지는 최신 offset으로 건너뜀(스팸 방지).
- **chat_id 화이트리스트**: `TELEGRAM_CHAT_ID`와 불일치 메시지는 무시(콘솔 로그만).

## 배포·안전

- 작업 스케줄러 "로그인 시 시작(AtLogOn)" 태스크 등록
  (`install-scheduler.ps1`에 `UpbitTelegramBot` 추가, StartWhenAvailable).
- 토큰은 기존 env 재사용(`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`). 미설정 시 봇은
  즉시 "설정 없음" 로그 후 종료(no-op).
- 수신 폴링 루프는 기존 매 스캔 발신 알림과 독립 — 상호 영향 없음.
- 조회 전용: 주문/매매/설정변경 명령 일절 없음.

## 테스트 (vitest, fetch mock)

`__tests__/bot-commands.test.mjs`:
- 명령 파싱: `/scan`, `/c SOPH`, `/코인 소폰`, 별칭, 인자 없는 `/코인`, 미지 명령.
- 심볼 해석: 영문·한글·KRW- 프리픽스 정상 매칭, 오타→부분일치 후보, 미존재.
- chat_id 검증: 일치=처리, 불일치=무시.
- 포맷터: mock 데이터(스캔 결과·코인 지표·전략 요약·포지션·스코어카드) 입력 →
  기대 문자열 스냅샷(핵심 필드 포함 여부 assert).
- 폴백 경로: 로컬 API mock 실패 시 파일 데이터로 포맷 생성.

폴링 루프(telegram-bot.mjs)·네트워크는 기존 스크립트 관례대로 테스트 제외.

## 비범위 (YAGNI)

- 주문/매매 명령 없음(조회 전용).
- 대화형 세션·인라인 버튼 UI 없음(단발 명령→단발 응답).
- 다중 사용자·권한 없음(내 chat_id 전용).
- 웹훅 없음(폴링만 — 공인 IP/HTTPS 불필요).
