# 업비트 스캐너

업비트 KRW 마켓을 **3시간마다**(KST 00·03·06·09·12·15·18·21시) 자동 스캔해 매수/매도 신호를 집계하고,
텔레그램 알림·대시보드·실호가 모의매매로 검증한다. 시세는 공개 API만 쓰므로 업비트 API 키가 필요 없다.

변경 이력: [`docs/CHANGELOG-2026-10.md`](docs/CHANGELOG-2026-10.md) (9월 이전은 같은 폴더).

**두 스캐너:**

| 스캐너 | 목적 | 출력 | 스케줄 |
|--------|------|------|--------|
| `monitor.mjs` | 반등 초입 포착(과매도→반전) + SMC 신호 | `monitor-log.json`(최근 30회) + `scan-archive.jsonl`(무제한) | 3시간마다 xx:00 |
| `momentum-scan.mjs` | 추세 지속 포착(이미 오르는 종목) | `momentum-log.json`(최근 15일) | 3시간마다 xx:02 |

반등 스캐너는 과매수 종목을 매도로만 보므로, 이미 상승 중인 추세 종목은 모멘텀 스캐너가 따로 잡는다.

**측정으로 정한 원칙 (2026-10):** 신호는 18개월 재생에서 같은 날 시장 대비 초과수익·진입일 군집 t(|t|≥2)·
왕복 비용 0.3%·전/후반 분할을 모두 봐서 넣고 뺀다(`scripts/research/signal-ablation/`). 정리 후에도 픽 초과수익은
0 근처다 — 해로운 신호를 걷어낸 것이지 양(+)의 우위가 증명된 것은 아니다. 실전 매매 전에 모의매매로 판정한다.

## 설치

```bash
npm install
```

## 사용

```bash
npm run scan                # 반등 스캔 1회 (monitor) — 텔레그램 알림이 나간다
npm run momentum            # 모멘텀 스캔 1회
npm run analyze -- KRW-BTC  # 개별 종목 분석
npm run weekly -- --force   # 주간 분석 강제 실행
npm run scorecard           # 픽 스코어카드 채점
npm run paper               # 모의매매 1회 (손절·익절 확인 → 새 스캔 진입 → 평가금 기록)
npm run paper:report        # 모의매매 판정 리포트 (체결 모델별로 나눠 출력)
npm run bot                 # 텔레그램 봇 (상주)
npm run dashboard           # 로컬 대시보드 http://127.0.0.1:8787
npm test                    # 전체 테스트 (Vitest)
```

> 수동 스캔은 정시(xx:00·02·10·17) 근처를 피한다 — 같은 로그를 동시에 쓰면 경합이 생길 수 있다.
> 검증용 수동 스캔에서 모의매매 진입을 끄려면 `PAPER_TRIGGER=0`.

## 자동화 (Windows 작업 스케줄러)

```powershell
# 관리자 PowerShell에서 실행 (S4U 작업 등록에 관리자 권한 필요)
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
# 제거
powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1 -Uninstall
# 확인
Get-ScheduledTask -TaskName 'Upbit*'
```

| 작업 | 실행 | 하는 일 |
|------|------|--------|
| `UpbitMonitor` | 3시간마다 xx:00 | 반등 스캔 + 알림 + 거래소 이벤트·김치 프리미엄 |
| `UpbitMomentum` | 3시간마다 xx:02 | 모멘텀 스캔 |
| `UpbitTrend` | 3시간마다 xx:17 | `data/analysis-journal.md`에 추이 기록 |
| `UpbitPaper` | 매시 :10 | 모의매매 (스캔 직후에도 자동 실행) |
| `UpbitScorecard` | 매일 09:10 | 픽 스코어카드 채점 |
| `UpbitWeekly_Sun` | 일요일 22:00 | 주간 적중률 + 가중치 갱신 |
| `UpbitTelegramBot` · `UpbitNewsWatch` · `UpbitDashboard` | 부팅 시 + 5분 감시 | 상주 데몬 — 죽으면 5분 안에 다시 켜진다 |

운영 방식(10월에 장애를 겪으며 정했다):
- **로그인과 무관하게 실행(S4U, 세션 0).** 업데이트 재부팅 뒤 로그인 화면에 머물러도 돈다.
- **창 없이 실행**: `conhost.exe --headless node scripts/run-logged.mjs <스크립트> <로그>`. 출력은 `data/task-logs/<작업명>.log`.
  예전 `cmd /c` 방식은 Windows 11에서 터미널 창이 떴고, 그 창을 닫으면 봇이 죽었다.
- **전원 연결 시 절전·최대 절전 끔**(모든 전원 구성표, 설치 스크립트가 설정). 절전 중엔 상주 데몬이 멈추고,
  타이머로 깬 직후엔 네트워크가 없어 스캔이 실패했다. 화면 끄기는 그대로다.
- Windows 업데이트 사용 시간 15:00~09:00 — 자동 재시작은 낮(09~15시)에만.
- 설치 스크립트를 다시 돌리면 기존 상주 데몬 프로세스는 작업 해제로 죽지 않는다 → 직접 종료 후 `Start-ScheduledTask`(중복 방지).
- 공백·지연이 보이면: ① 작업 로그 ② System 이벤트 로그(Kernel-Power 42 절전 / 1074 재시작) ③ `LastTaskResult` 순으로 본다.

## 모의매매 (페이퍼 트레이딩, 2026-10-08~)

돈을 쓰지 않고 스캐너 픽을 **실제 호가로 가상 체결**해 "기계적으로 따라 사면 얼마 남나"를 기록한다.
18개월 재생에서 메인 픽 추종은 절대 수익이 음수였다 — 실전 자동매매 전에 이 기록으로 먼저 판정한다.

- 장부 3개: `main`(반등 매수, 저유동성 제외) · `momentum`(추세지속) · `random`(무작위 대조, 10-19~). 각 50만 원, 건당 5만 원, 최대 10건, 스캔당 상위 3개
- `random`은 메인 스캔과 같은 시각에 메인 픽이 될 수 있었던 종목(거래대금 5억↑, 경고·국내 과열 제외 — monitor가 스캔 기록 `universe`에 남긴다) 중
  스캔 시각으로 시드한 무작위 3개를 메인과 같은 규칙으로 산다. "메인 − 무작위"가 같은 규칙·비용에서 고르는 실력이다
- **진입은 스캔이 로그를 저장한 직후**(`lib/paper-trigger.mjs`) 그 순간의 호가창 VWAP. 3시간 넘은 스캔은 사지 않는다
- **청산은 매시 :10**: 진입 이후 1시간봉 고저로 손절·익절 판정(거래소에 주문을 걸어 둔 것과 같은 효과)
- 체결 모델 v2(10-15~): 업비트 호가 단위 반영, 봉 안 손절은 1분봉 첫 터치 분의 종가·시가와 손절가 중 낮은 값,
  진입한 시간의 남은 분도 1분봉 확인, 같은 봉 손절·익절 동시 터치는 손절, 손절 슬리피지 0.2%, 수수료 0.05%×2.
  규칙은 포지션을 산 때의 모델(`fillModel`)을 따르고 변경 기록은 `modelChanges`. **11-05 점검까지 규칙 고정**
- 보기: 대시보드 🧪 모의매매 메뉴, 텔레그램 `모의`, `npm run paper:report`
- **판정은 장부가 아니라 스코어카드로 한다(10-19 결정).** 장부는 자금이 묶여 표본이 작다(10-19: 진입일 10일, 필요 약 257일).
  `npm run paper:report` 맨 위 "판정" 섹션: 10-08 이후 메인 픽 전부의 손절·익절 규칙 수익 − 같은 기간 시장 − 비용을 진입일 t로 본다(`lib/verdict.mjs`).
  - 사전 등록한 3단 판정 — **통과**: t≥2 · 전/후반 모두 양(+) · 점수 상위 1/3 > 하위 1/3 → 소액 실전 논의 /
    **실패**: t≤−2 → 반등 매수 신호를 참고용으로 내리고 재설계 / **판정 불가**: 그 밖 → 리포트의 판정 가능 예상일까지 연장
  - 검정력: |t|=2에 필요한 진입일 수와 판정 가능 예상일(효과 크기 최소 0.5%)
  - 비용: 장부 거래를 같은 스캔가 일봉 채점으로 다시 계산해 잰 실체결 차이(현재 체결 모델 v2 짝 10건↑일 때), 아니면 왕복 0.3%
  - 무작위 대조(보조): 같은 스캔에서 산 메인 − 무작위
  - 모멘텀은 스코어카드 대상이 아니라 장부로만 본다(스캔당 픽 약 1개라 장부가 사실상 픽 전부)
- 데이터: `data/paper-trades.json`(장부·평가금 시계열) + `data/paper-trades-log.jsonl`(진입·청산 원장, 추가 전용).
  둘 다 git 추적. 장부 파일이 깨지면 덮어쓰지 않고 멈춘다

## 텔레그램 봇

`.env`에 `TELEGRAM_TOKEN`·`TELEGRAM_CHAT_ID`를 넣으면 스캔 알림과 조회 봇이 동작한다(`lib/env.mjs`가 진입점에서 읽는다 —
작업 스케줄러 환경엔 사용자 환경변수가 없을 수 있다). 슬래시는 없어도 된다.

| 명령 | 내용 |
|------|------|
| `scan` | 지금 반등 스캔 실행 |
| `코인 <심볼>` · `c <심볼>` | 코인 분석 (예: `c SOL`, `코인 솔라나`) |
| `status` · `s` | 시장 요약 |
| `전략` · `포지션` · `스코어카드` | 조용한 바닥 전략 성적 · 보유 포지션 · 픽 성과 |
| `모의` | 모의매매 장부 현황(평가금·시장 대비·손절선 근접·최근 청산) |
| `help` | 명령 목록 |

## 뉴스·공지 데몬 (`scripts/news-watch.mjs`)

코인니스(1분)·업비트(1분)·빗썸(2분)·바이낸스(5분)를 수집 → 코인 매칭 → 분류 → `data/news-log.jsonl` → 텔레그램 알림
(6시간 중복 억제, 공식 공지 우선). 상폐·유의·입출금 중단 같은 **공식 악재만** 스캔 점수에 반영한다(거래소 이벤트 방어).
소스가 30분 넘게 실패하면 "뉴스 소스 중단", 다시 받아지면 "회복"을 보낸다. 바이낸스 실패 사유는 데몬 로그에 남는다.

## 구조

| 경로 | 역할 |
|------|------|
| `lib/indicators.mjs` | EMA/SMA/RSI/BB/MACD/Stoch/WR/VolRatio/OBV 순수 함수 |
| `lib/signals.mjs` | 신호 감지 + 점수화 + 콤보 보정 + 패턴 감지 |
| `lib/buy-modifiers.mjs` | 매수 점수 배수군(레짐·유동성·업비트 단독 펌프·떨어지는칼·펀딩·구조 리스크·거래소 이벤트) |
| `lib/momentum.mjs` | 추세지속 점수 + 다이버전스 + BB 스퀴즈 |
| `lib/smc-signals.mjs` | 유동성 스윕 / V-Bottom |
| `lib/kimchi.mjs` · `lib/funding.mjs` · `lib/structural-risk.mjs` · `lib/exchange-events.mjs` | 코인 네이티브 신호·방어 |
| `lib/scan-universe.mjs` | 스캔 대상(거래대금 1억↑, 마켓 목록 재시도 약 42초·60초 한도) |
| `lib/paper.mjs` · `lib/paper-summary.mjs` · `lib/paper-trigger.mjs` | 모의매매 체결 모델 · 집계/화면 묶음 · 스캔 직후 실행 |
| `lib/paper-random.mjs` · `lib/verdict.mjs` | 무작위 대조 장부(후보·시드 셔플) · 11-05 판정(스코어카드 지표·검정력·실체결 차이) |
| `lib/news/` | 뉴스 소스·매칭·분류·라우팅 |
| `lib/store.mjs` | JSON 읽기/쓰기(원자적) + 파일 잠금 + 롤링/기간 보관 |
| `scripts/monitor.mjs` · `scripts/momentum-scan.mjs` | 스캐너 |
| `scripts/paper-trade.mjs` · `scripts/scorecard.mjs` · `scripts/weekly-analysis.mjs` · `scripts/trend-journal.mjs` | 배치 작업 |
| `scripts/telegram-bot.mjs` · `scripts/news-watch.mjs` · `server/server.mjs` | 상주 데몬 |
| `scripts/run-logged.mjs` | 작업 실행기(창 없이, 로그 이어 붙이기, 종료 코드 전달) |
| `scripts/install-scheduler.ps1` | 작업 등록/제거 + 전원 설정 (PS 5.1 호환을 위해 ASCII만) |
| `scripts/research/` | 재생 측정 도구(signal-ablation · accumulation · news · risk · paper-report) |

## 스캔 흐름 (monitor)

1. KRW 마켓 조회(스테이블코인 제외, 실패 시 재시도) → 24h 거래대금 1억 원 미만 제외
2. 종목별 일봉 200개 → **확정봉만**으로 판정(09:00 정각 스캔의 날짜 인지 처리 포함). 진입가는 현재가
3. 지표 → 신호 점수 → 패턴 → 콤보 보정 → 4시간봉 MTF → SMC 가산 → 배수군(`buy-modifiers`) → 지속성 보너스
4. 매수 score ≥ 5, 매도 score ≥ 3 → 저장·알림. 국내 과열(BTC 대비 김치프 +3%p↑) 코인은 매수 목록에서 분리
5. 레이트 리밋: BATCH=5, DELAY=200ms

## 콤보·보정

| 항목 | 동작 |
|------|------|
| 과매도 함정 페널티 ×0.55 | Stoch 골든크로스 **없이** RSI·BB·Stoch·WR 과매도 4종 동시(낙하 중) |
| 반등확인 보너스 ×1.4 | Stoch 과매도 골든크로스 포함(진짜 반등) |
| 떨어지는칼 ×0.5 | EMA 하락배열 속 골든크로스 |
| `[MTF] 4시간봉 Stoch GC` ×1.2 | 일봉 골든크로스 매수에 한해 4시간봉도 Stoch GC |
| 지속성 +1 / +2 | 전날까지 2일 / 3일 이상 연속 매수권(일 단위) |
| 패턴 | 박스권 돌파·상승깃발·역삼중바닥 |

`Stoch 과매도 골든크로스` = K선이 D선을 아래에서 위로 돌파 + 두 선 모두 20 미만.

**측정으로 뺀 신호(10-07~08):** 매수 '거래량 급증'(상승 동반, 역방향)과 거래량확인 콤보, MACD 반등, EMA 20/50 GC,
거래량 선행 매집, Pump Start, 상승삼각형, 추격 감점(volRatio). 매도 쪽 Stoch 과매수·과매수 DC·W%R 과매수·쌍봉·하락깃발.
근거는 `scripts/research/signal-ablation/README.md`.

## 모멘텀 스캐너 점수 (momentum-scan, MIN_SCORE=10)

추세 지속 종목을 5개 그룹으로 점수화. A~D는 그룹당 1개(최댓값), E는 누적. 당일 과열 픽(+2.4%↑ 또는 윗꼬리 5.8%↑)과
국내 과열 픽은 '추격주의'로 분리한다.

| 그룹 | 내용 | 최대 |
|------|------|------|
| A 추세 | EMA 정배열(20>50[>200]) | +4 |
| B 모멘텀 | 연속양봉≥5/≥3, 없으면 EMA20 기울기≥1% | +4 |
| C 위치 | 200봉 신고가 갱신(≥99%)/근접(≥92%) | +4 |
| D 오실레이터 | MACD 히스토 3연속↑ + RSI 50~75 | +4 |
| E 품질 | OBV 매집/추세확인, BB 스퀴즈 발산 (각 +2) | 누적 |
| 차감 | RSI 하락 다이버전스 −4, OBV 약화 −2 | − |

## SMC 신호 (monitor)

| 신호 | 점수 | 조건 |
|------|------|------|
| 유동성 스윕 | +2~4 | 직전 20봉 스윙 고/저점을 잠깐 뚫고 종가 회귀 |
| V-Bottom | +5~7 | 투매(RSI9≤25, 거래량 3x) → 긴 밑꼬리 핀바 → CHoCH. SL=핀바 저가 (18개월 재생에서 12회로 드묾) |

## 가중치 자동 갱신 (EWM)

`scripts/weekly-analysis.mjs`가 **매주 일요일 22:00**에 아카이브의 픽을 **+1일 확정 종가**로 판정해 신호 가중치를 갱신하고
주간 리포트를 만든다(기록·검증 화면 "이번 주 요약"). 모멘텀은 최근 15일 기록으로 +1/+3/+7일 적중률을 낸다.

```
target    = hitRate >= 0.7 ? 1.5 : hitRate >= 0.5 ? 1.0 : 0.7
newWeight = clamp(oldWeight * 0.8 + target * 0.2, 0.5, 2.0)
MIN_SAMPLES = 8   # 등장 8회 미만이면 조정하지 않는다
```

## 대시보드

`npm run dashboard` 또는 상주 작업 `UpbitDashboard` → `http://127.0.0.1:8787` (localhost 전용, 인증 없음).
Tailwind + DaisyUI(CDN), 빌드 없음. 모든 배지에 마우스를 올리면 신호 설명이 뜬다.

| 메뉴 | 내용 |
|------|------|
| 🏠 종합 | KPI(매수/매도·커버리지·레짐·김치프·펀딩), 포지션, 자주 잡힌 코인, 반등/모멘텀 TOP, 🇰🇷 국내 과열 코인, 수동 스캔 |
| 🔍 개별분석 | 코인 검색 → 캔들/라인 차트(일/4h/1h) + 지표 + 캔들 모양 + 종합 점수 |
| 📊 기록·검증 | 적중률(전체·+1/+3/+7일), 신호별 적중률·가중치, 주간 요약, 스캔 기록 드릴다운 |
| 🎯 스코어카드 | 픽 에피소드 +1/+3/+7일 확정 종가·MFE·시장 대비·비용 차감·MDD, 코인별 표 |
| 🧪 모의매매 | 장부 카드, 평가금 곡선, 보유 중(실시간·손절선 가까운 순), 종료 거래(계속 들고 있었다면·청산 판단) |

## 환경변수 (`.env`, gitignore)

```
TELEGRAM_TOKEN=123456:ABC...      # @BotFather → /newbot
TELEGRAM_CHAT_ID=987654321        # getUpdates 의 chat.id
```

`lib/env.mjs`가 스캐너·봇 진입점에서 `.env`를 읽는다(이미 설정된 환경변수가 우선). 시세·스캔은 키 없이 동작한다.
잔고·주문 확장 시에만 `UPBIT_ACCESS_KEY` / `UPBIT_SECRET_KEY`가 필요하다(지금은 쓰지 않는다 — 실전 주문 연동은 모의매매 판정 전엔 만들지 않는다).
