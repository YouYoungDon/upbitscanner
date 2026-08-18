# 텔레그램 명령형 봇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰에서 텔레그램 봇에게 명령하면 즉시 응답하는 조회 전용 봇 — /scan /코인 /status /전략 /포지션 /스코어카드 /help.

**Architecture:** 상주 롱폴링 프로세스(`scripts/telegram-bot.mjs`)가 getUpdates를 폴링하며 명령을 디스패치. 순수 파싱·포맷 로직은 `lib/bot-commands.mjs`로 분리해 테스트. 데이터는 로컬 8787 API 우선, 실패 시 데이터 파일 폴백, 실시간이 필요한 /scan·/코인은 업비트 직접.

**Tech Stack:** Node.js ESM(.mjs), vitest, 텔레그램 Bot API(getUpdates 롱폴링), 기존 upbit-dashboard lib 재사용.

## Global Constraints

- ESM(.mjs)만 사용. 파일 최상단 import만 — mid-file import 금지, 중복 import 금지.
- 한글 주석·문자열은 Write/Edit 도구로만 작성(PowerShell이 UTF-8-no-BOM 한글을 깨뜨림).
- 봇은 **조회 전용** — 주문/매매/설정변경 명령 없음.
- chat_id 화이트리스트: `process.env.TELEGRAM_CHAT_ID`와 불일치 메시지는 무시(콘솔 로그만).
- 토큰·chat_id는 기존 env 재사용(`TELEGRAM_TOKEN`/`TELEGRAM_CHAT_ID`). 미설정 시 봇은 로그 후 종료(no-op).
- 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 테스트 프레임워크 vitest, fetch는 전부 mock. 폴링 루프·네트워크 I/O는 기존 스크립트 관례대로 테스트 제외.
- 로컬 API 베이스: `http://127.0.0.1:8787`. 데이터 파일 경로는 `lib/store.mjs`의 `DATA_DIR` 기준.

---

## File Structure

- `lib/signal-format.mjs` (신규): `readableSignals(signals)` — monitor.mjs에서 이동. 봇과 스캔 알림이 공유하는 신호→근거/경고 변환 순수 함수.
- `lib/bot-commands.mjs` (신규): `parseCommand`, `resolveSymbol`, 그리고 각 명령 포맷터(`formatCoin`·`formatStatus`·`formatStrategy`·`formatPositions`·`formatScorecard`·`formatHelp`) — 전부 순수 함수(데이터 주입).
- `scripts/telegram-bot.mjs` (신규): 롱폴링 루프 + chat_id 검증 + 디스패치 + 데이터 수집(로컬 API/업비트/파일 폴백) + /scan 자식 프로세스 실행.
- `scripts/monitor.mjs` (수정): 내부 `readableSignals`를 `lib/signal-format.mjs` import로 교체.
- `scripts/install-scheduler.ps1` (수정): `UpbitTelegramBot` AtLogOn 태스크 추가.
- `.env.example` (수정): 봇 사용 안내 주석.
- `package.json` (수정): `"bot": "node scripts/telegram-bot.mjs"` 스크립트.
- 테스트: `__tests__/signal-format.test.mjs`, `__tests__/bot-commands.test.mjs`.

---

### Task 1: readableSignals를 lib/signal-format.mjs로 승격 (공유 준비)

**Files:**
- Create: `lib/signal-format.mjs`
- Modify: `scripts/monitor.mjs` (내부 함수 → import)
- Test: `__tests__/signal-format.test.mjs`

**Interfaces:**
- Produces: `readableSignals(signals: string[]) => { reasons: string[], warns: string[], strategy: boolean }`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/signal-format.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { readableSignals } from '../lib/signal-format.mjs'

describe('readableSignals', () => {
  it('골든크로스(Stoch·MACD)·거래량·지속을 근거로 추출', () => {
    const r = readableSignals(['Stoch 과매도 골든크로스 (11)', 'MACD 골든크로스', '거래량 급증 (10.0x)', '🔥지속 매수권 (3회+)'])
    expect(r.reasons).toContain('골든크로스(Stoch·MACD)')
    expect(r.reasons).toContain('거래량 10.0배')
    expect(r.reasons.some((x) => x.includes('지속'))).toBe(true)
  })
  it('추격주의·업비트비중을 경고로 분리', () => {
    const r = readableSignals(['거래량 급증 (43.4x)', '⚠️추격주의(급등후)', '⚠️업비트비중 53%'])
    expect(r.warns).toContain('추격주의(급등후)')
    expect(r.warns.some((x) => x.includes('업비트비중'))).toBe(true)
  })
  it('과매도만 있고 골든크로스 없으면 "과매도 반등"', () => {
    expect(readableSignals(['RSI 과매도 (29)']).reasons).toContain('과매도 반등')
  })
  it('🎯전략 태그 → strategy true', () => {
    expect(readableSignals(['🎯전략(조용한바닥)']).strategy).toBe(true)
  })
  it('빈 입력 안전', () => {
    expect(readableSignals(null)).toEqual({ reasons: [], warns: [], strategy: false })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/signal-format.test.mjs`
Expected: FAIL — `Cannot find module '../lib/signal-format.mjs'`

- [ ] **Step 3: lib/signal-format.mjs 작성** (monitor.mjs의 현재 함수 본문 그대로 이동)

```javascript
// 신호 배열 → 사람이 읽기 쉬운 (근거줄, 경고줄) 추출. 스캔 알림·봇 공용.
export function readableSignals(signals) {
  const s = signals || []
  const has = (kw) => s.some((x) => x.includes(kw))
  const grab = (kw) => s.find((x) => x.includes(kw))
  const num = (kw) => { const m = grab(kw)?.match(/([\d.]+)/); return m ? m[1] : null }

  const reasons = []
  if (has('골든크로스')) {
    const parts = []
    if (has('Stoch 과매도 골든크로스') || has('Stoch 골든크로스')) parts.push('Stoch')
    if (has('MACD 골든크로스')) parts.push('MACD')
    reasons.push(`골든크로스${parts.length ? '(' + parts.join('·') + ')' : ''}`)
  }
  if (has('과매도') && !has('골든크로스')) reasons.push('과매도 반등')
  const vol = num('거래량 급증')
  if (vol) reasons.push(`거래량 ${vol}배`)
  if (has('V-Bottom')) reasons.push('V바텀')
  if (has('유동성 스윕')) reasons.push('바닥 스윕')
  const pers = grab('지속 매수권')
  if (pers) reasons.push(`🔥지속${(pers.match(/(\d+회)/) || [])[1] ? '(' + pers.match(/(\d+회)/)[1] + '+)' : ''}`)
  if (has('[MTF]')) reasons.push('📡4h확인')

  const warns = []
  if (has('추격주의')) warns.push('추격주의(급등후)')
  if (has('업비트단독')) warns.push('업비트단독펌프')
  else if (has('업비트비중')) warns.push(`업비트비중 ${num('업비트비중') || ''}%`)
  if (has('떨어지는') || has('낙하')) warns.push('낙하 중')
  return { reasons, warns, strategy: has('🎯전략') }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/signal-format.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: monitor.mjs를 import로 교체**

`scripts/monitor.mjs` 최상단 import 블록에 추가(기존 import들 아래):
```javascript
import { readableSignals } from '../lib/signal-format.mjs'
```
그리고 `scripts/monitor.mjs`에서 `function readableSignals(signals) { ... }` 정의 전체(주석 `// 신호 배열 → ...`부터 닫는 `}`까지)를 **삭제**. `notifyTelegram` 내부의 `readableSignals(...)` 호출은 그대로 둔다(이제 import된 것을 사용).

- [ ] **Step 6: 회귀 확인**

Run: `node --check scripts/monitor.mjs && npx vitest run`
Expected: 문법 OK, 전체 테스트 PASS (기존 411 + 신규 5 = 416)

- [ ] **Step 7: 커밋**

```bash
git add lib/signal-format.mjs __tests__/signal-format.test.mjs scripts/monitor.mjs
git commit -m "refactor(notify): readableSignals를 lib/signal-format.mjs로 승격 (봇 공유)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 명령 파서 + 심볼 해석 (lib/bot-commands.mjs)

**Files:**
- Create: `lib/bot-commands.mjs`
- Test: `__tests__/bot-commands.test.mjs`

**Interfaces:**
- Produces:
  - `parseCommand(text: string) => { cmd: string, arg: string } | null`
    - cmd은 정규화된 정식 명령명: `'scan'|'coin'|'status'|'strategy'|'positions'|'scorecard'|'help'`. 미지 명령·비명령 텍스트 → `{ cmd: 'help', arg: '' }` (help로 안내). 슬래시 없는 일반 텍스트 → `null`(무시).
  - `resolveSymbol(query: string, markets: Array<{market, korean_name}>) => { market: string, korean_name: string } | { notFound: true, suggestions: string[] }`

- [ ] **Step 1: 실패 테스트 작성**

`__tests__/bot-commands.test.mjs`:
```javascript
import { describe, it, expect } from 'vitest'
import { parseCommand, resolveSymbol } from '../lib/bot-commands.mjs'

describe('parseCommand', () => {
  it('정식 명령·별칭 정규화', () => {
    expect(parseCommand('/scan')).toEqual({ cmd: 'scan', arg: '' })
    expect(parseCommand('/c SOPH')).toEqual({ cmd: 'coin', arg: 'SOPH' })
    expect(parseCommand('/코인 소폰')).toEqual({ cmd: 'coin', arg: '소폰' })
    expect(parseCommand('/s')).toEqual({ cmd: 'status', arg: '' })
    expect(parseCommand('/status')).toEqual({ cmd: 'status', arg: '' })
    expect(parseCommand('/전략')).toEqual({ cmd: 'strategy', arg: '' })
    expect(parseCommand('/포지션')).toEqual({ cmd: 'positions', arg: '' })
    expect(parseCommand('/스코어카드')).toEqual({ cmd: 'scorecard', arg: '' })
    expect(parseCommand('/help')).toEqual({ cmd: 'help', arg: '' })
  })
  it('@봇이름 접미사·앞뒤 공백 허용', () => {
    expect(parseCommand('  /scan@my_bot  ')).toEqual({ cmd: 'scan', arg: '' })
    expect(parseCommand('/코인@my_bot BTC')).toEqual({ cmd: 'coin', arg: 'BTC' })
  })
  it('미지 명령 → help로 안내', () => {
    expect(parseCommand('/xyz')).toEqual({ cmd: 'help', arg: '' })
  })
  it('슬래시 없는 일반 텍스트 → null(무시)', () => {
    expect(parseCommand('안녕')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
})

describe('resolveSymbol', () => {
  const markets = [
    { market: 'KRW-SOPH', korean_name: '소폰' },
    { market: 'KRW-BTC', korean_name: '비트코인' },
    { market: 'KRW-SONIC', korean_name: '소닉' },
  ]
  it('영문 심볼(대소문자 무시)', () => {
    expect(resolveSymbol('soph', markets)).toEqual({ market: 'KRW-SOPH', korean_name: '소폰' })
  })
  it('한글명', () => {
    expect(resolveSymbol('비트코인', markets)).toEqual({ market: 'KRW-BTC', korean_name: '비트코인' })
  })
  it('KRW- 프리픽스 그대로', () => {
    expect(resolveSymbol('KRW-BTC', markets)).toEqual({ market: 'KRW-BTC', korean_name: '비트코인' })
  })
  it('미존재 → 부분일치 후보 최대 3개', () => {
    const r = resolveSymbol('소', markets)
    expect(r.notFound).toBe(true)
    expect(r.suggestions).toEqual(expect.arrayContaining(['소폰(SOPH)', '소닉(SONIC)']))
  })
  it('완전 미매칭 → 빈 후보', () => {
    expect(resolveSymbol('zzzz', markets)).toEqual({ notFound: true, suggestions: [] })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/bot-commands.test.mjs`
Expected: FAIL — `Cannot find module '../lib/bot-commands.mjs'`

- [ ] **Step 3: lib/bot-commands.mjs 작성 (파서·해석기)**

```javascript
// 텔레그램 봇 명령 파싱·심볼 해석·응답 포맷 (순수 로직).
const ALIASES = {
  scan: 'scan',
  coin: 'coin', c: 'coin', 코인: 'coin',
  status: 'status', s: 'status',
  strategy: 'strategy', 전략: 'strategy',
  positions: 'positions', 포지션: 'positions',
  scorecard: 'scorecard', 스코어카드: 'scorecard',
  help: 'help',
}

// '/명령@봇 인자' → { cmd, arg }. 미지 명령 → help. 비명령 → null.
export function parseCommand(text) {
  const t = String(text ?? '').trim()
  if (!t.startsWith('/')) return null
  const sp = t.indexOf(' ')
  let head = sp === -1 ? t.slice(1) : t.slice(1, sp)
  const arg = sp === -1 ? '' : t.slice(sp + 1).trim()
  head = head.split('@')[0].toLowerCase() // '/scan@bot' → 'scan'
  const cmd = ALIASES[head]
  if (!cmd) return { cmd: 'help', arg: '' }
  return { cmd, arg }
}

// 심볼/한글명/KRW- 쿼리를 마켓으로 해석. 미존재 시 부분일치 후보.
export function resolveSymbol(query, markets) {
  const q = String(query ?? '').trim()
  if (!q) return { notFound: true, suggestions: [] }
  const up = q.toUpperCase()
  const symOf = (m) => m.market.split('-')[1]
  const exact = markets.find((m) =>
    m.market.toUpperCase() === up ||
    symOf(m).toUpperCase() === up ||
    m.korean_name === q)
  if (exact) return { market: exact.market, korean_name: exact.korean_name }
  const suggestions = markets
    .filter((m) => m.korean_name.includes(q) || symOf(m).toUpperCase().includes(up))
    .slice(0, 3)
    .map((m) => `${m.korean_name}(${symOf(m)})`)
  return { notFound: true, suggestions }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/bot-commands.test.mjs`
Expected: PASS (parseCommand 4 + resolveSymbol 5 = 9 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/bot-commands.mjs __tests__/bot-commands.test.mjs
git commit -m "feat(bot): 명령 파서·심볼 해석기 (순수 로직)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 응답 포맷터 6종 (lib/bot-commands.mjs 확장)

**Files:**
- Modify: `lib/bot-commands.mjs`
- Test: `__tests__/bot-commands.test.mjs` (포맷터 describe 추가)

**Interfaces:**
- Consumes: `readableSignals` from `lib/signal-format.mjs`
- Produces (전부 HTML 문자열 반환):
  - `formatCoin({ korean_name, market, indicators, quietBottom, designation }) => string`
    - indicators: `{ price, rsi, stoch:{k}, macd:{hist}, volRatio, ema20, ema50 }`
    - quietBottom: `{ rsi, stochK, volRatio } | null`, designation: `{ warning:boolean, cautions:string[] }`, pos90: 0~100 숫자
  - `formatStatus({ ratio, trend, buyCount, sellCount, topBuy: [{korean_name, market, score}] }) => string`
  - `formatStrategy({ n, sl, tp, time, open, noData, winRate, avgRet, openList: [{korean_name, market, ret1}] }) => string`
  - `formatPositions([{ market, korean_name, price, stopLoss, toSLPct }]) => string`
  - `formatScorecard({ h1, h3, h7, total, pendingCount }) => string` (h*: `{winRate, avgRet, n}`)
  - `formatHelp() => string`
  - `formatNotFound(query, suggestions) => string`

- [ ] **Step 1: 실패 테스트 작성** (기존 파일에 describe 추가)

`__tests__/bot-commands.test.mjs` 하단에 추가:
```javascript
import { formatCoin, formatStatus, formatStrategy, formatPositions, formatScorecard, formatHelp, formatNotFound } from '../lib/bot-commands.mjs'

describe('formatCoin', () => {
  it('지표·90일위치·유의지정·시그니처 포함', () => {
    const out = formatCoin({
      korean_name: '소폰', market: 'KRW-SOPH',
      indicators: { price: 5.02, rsi: 22.6, stoch: { k: 5.6 }, macd: { hist: -0.06 }, volRatio: 0.34, ema20: 6.4, ema50: 7.4 },
      quietBottom: { rsi: 22.6, stochK: 5.6, volRatio: 0.34 },
      designation: { warning: false, cautions: [] },
      pos90: 2,
    })
    expect(out).toContain('소폰')
    expect(out).toContain('SOPH')
    expect(out).toContain('5.02')
    expect(out).toContain('22.6')       // RSI
    expect(out).toContain('90일')        // 위치 라벨
    expect(out).toContain('조용한바닥')  // 시그니처 충족
  })
  it('유의지정 있으면 경고 표기', () => {
    const out = formatCoin({
      korean_name: '테스트', market: 'KRW-TT',
      indicators: { price: 100, rsi: 50, stoch: { k: 50 }, macd: { hist: 0 }, volRatio: 1, ema20: 100, ema50: 100 },
      quietBottom: null, designation: { warning: true, cautions: ['거래량급등'] }, pos90: 50,
    })
    expect(out).toContain('유의')
  })
})

describe('formatStatus', () => {
  it('시장심리·매수매도·상위매수 포함', () => {
    const out = formatStatus({ ratio: 0.08, trend: 'bear', buyCount: 8, sellCount: 106, topBuy: [{ korean_name: '엘프', market: 'KRW-ELF', score: 16.9 }] })
    expect(out).toContain('0.08')
    expect(out).toContain('8')
    expect(out).toContain('엘프')
  })
})

describe('formatStrategy', () => {
  it('승률·SL/TP·보유목록', () => {
    const out = formatStrategy({ n: 13, sl: 2, tp: 0, time: 5, open: 6, noData: 0, winRate: 0.143, avgRet: -0.045, openList: [{ korean_name: '칠리즈', market: 'KRW-CTZ', ret1: -0.005 }] })
    expect(out).toContain('13')
    expect(out).toContain('14%')      // winRate 반올림
    expect(out).toContain('칠리즈')
  })
})

describe('formatPositions', () => {
  it('빈 목록 안내', () => {
    expect(formatPositions([])).toContain('보유 포지션 없음')
  })
  it('종목·손절근접도', () => {
    const out = formatPositions([{ market: 'KRW-SOPH', korean_name: '소폰', price: 5.02, stopLoss: 5.54, toSLPct: -9.4 }])
    expect(out).toContain('소폰')
    expect(out).toContain('5.54')
  })
})

describe('formatScorecard', () => {
  it('지평선별 승률', () => {
    const out = formatScorecard({ h1: { winRate: 0.42, avgRet: 0.01, n: 401 }, h3: { winRate: 0.26, avgRet: -0.01, n: 300 }, h7: { winRate: 0.16, avgRet: -0.02, n: 200 }, total: 936, pendingCount: 20 })
    expect(out).toContain('42%')
    expect(out).toContain('936')
  })
})

describe('formatHelp / formatNotFound', () => {
  it('help는 명령어 나열', () => {
    const h = formatHelp()
    expect(h).toContain('/scan')
    expect(h).toContain('/코인')
  })
  it('notFound는 후보 제시', () => {
    expect(formatNotFound('소', ['소폰(SOPH)', '소닉(SONIC)'])).toContain('소폰(SOPH)')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run __tests__/bot-commands.test.mjs`
Expected: FAIL — `formatCoin is not a function` 등

- [ ] **Step 3: 포맷터 구현** (`lib/bot-commands.mjs` 하단에 추가)

```javascript
import { readableSignals } from './signal-format.mjs'

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtP = (n) => (n == null ? '-' : Math.abs(n) >= 1 ? Number(n).toLocaleString('ko-KR') : Number(n).toPrecision(3))
const pct = (x) => (x == null ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`)
const sym = (m) => m.replace('KRW-', '')

export function formatCoin({ korean_name, market, indicators: i, quietBottom, designation, pos90 }) {
  const lines = [`<b>${esc(korean_name)}</b> (${sym(market)}) · ${fmtP(i.price)}원`]
  lines.push(`RSI ${i.rsi?.toFixed(1) ?? '-'} · Stoch K ${i.stoch?.k?.toFixed(1) ?? '-'} · MACD ${i.macd?.hist >= 0 ? '▲' : '▼'} · 거래량 ${i.volRatio?.toFixed(2) ?? '-'}배`)
  lines.push(`EMA20 ${fmtP(i.ema20)} / EMA50 ${fmtP(i.ema50)} · 90일 위치 ${Math.round(pos90)}%`)
  if (quietBottom) lines.push('🎯 <b>조용한바닥 시그니처 충족</b> (과매도+조용)')
  if (designation?.warning) lines.push('⚠️ <b>업비트 투자유의 지정</b>')
  else if (designation?.cautions?.length) lines.push(`⚠️ 주의: ${esc(designation.cautions.join(', '))}`)
  return lines.join('\n')
}

export function formatStatus({ ratio, trend, buyCount, sellCount, topBuy }) {
  const emoji = trend === 'bull' && ratio >= 0.5 ? '🟢' : (trend === 'bear' || ratio < 0.3) ? '🔴' : '🟡'
  const top = (topBuy || []).slice(0, 3).map((b, idx) => `${idx + 1}. ${esc(b.korean_name)}(${sym(b.market)}) ${b.score.toFixed(1)}점`).join('\n') || '없음'
  return `${emoji} <b>시장 요약</b>\n시장심리 ${ratio} · 매수 ${buyCount}/매도 ${sellCount}\n\n<b>상위 매수</b>\n${top}`
}

export function formatStrategy({ n, sl, tp, time, open, noData, winRate, avgRet, openList }) {
  const wr = winRate == null ? '-' : `${Math.round(winRate * 100)}%`
  const head = `🎯 <b>조용한바닥 전략</b>\n청산 승률 ${wr} (평균 ${pct(avgRet)})\nSL ${sl} · TP ${tp} · 시간 ${time} · 보유 ${open}${noData ? ` · 데이터없음 ${noData}` : ''} · 전체 ${n}`
  const list = (openList || []).map((e) => `• ${esc(e.korean_name)}(${sym(e.market)}) ${pct(e.ret1)}`).join('\n')
  return list ? `${head}\n\n<b>보유 중</b>\n${list}` : head
}

export function formatPositions(list) {
  if (!list || !list.length) return '📁 보유 포지션 없음'
  const rows = list.map((p) => {
    const near = p.toSLPct != null ? ` · 손절까지 ${p.toSLPct.toFixed(1)}%` : ''
    return `• <b>${esc(p.korean_name)}</b>(${sym(p.market)}) ${fmtP(p.price)}원 · 손절 ${fmtP(p.stopLoss)}${near}`
  })
  return `📁 <b>보유 포지션</b>\n${rows.join('\n')}`
}

export function formatScorecard({ h1, h3, h7, total, pendingCount }) {
  const row = (label, h) => `${label}: ${h?.n ? Math.round(h.winRate * 100) + '%' : '-'} (평균 ${pct(h?.avgRet)}, n=${h?.n ?? 0})`
  return `📊 <b>픽 스코어카드</b>\n${row('+1일', h1)}\n${row('+3일', h3)}\n${row('+7일', h7)}\n\n에피소드 ${total} · 채점대기 ${pendingCount}`
}

export function formatHelp() {
  return [
    '🤖 <b>업비트 스캐너 봇</b>',
    '/scan — 지금 스캔 실행',
    '/코인 &lt;심볼&gt; (/c) — 코인 분석 (예: /코인 SOPH)',
    '/status (/s) — 시장 요약',
    '/전략 — 조용한바닥 전략 성적',
    '/포지션 — 보유 포지션',
    '/스코어카드 — 픽 성과',
    '/help — 이 목록',
  ].join('\n')
}

export function formatNotFound(query, suggestions) {
  const s = suggestions?.length ? `\n혹시 이거? ${suggestions.join(', ')}` : ''
  return `❓ "${esc(query)}" 코인을 못 찾았어요.${s}`
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run __tests__/bot-commands.test.mjs`
Expected: PASS (파서·해석 9 + 포맷터 9 = 18 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/bot-commands.mjs __tests__/bot-commands.test.mjs
git commit -m "feat(bot): 응답 포맷터 6종 (coin/status/strategy/positions/scorecard/help)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 폴링 프로세스 + 데이터 수집 (scripts/telegram-bot.mjs)

**Files:**
- Create: `scripts/telegram-bot.mjs`
- Modify: `package.json` (scripts에 `"bot"` 추가)

**Interfaces:**
- Consumes: `parseCommand`, `resolveSymbol`, `formatCoin`, `formatStatus`, `formatStrategy`, `formatPositions`, `formatScorecard`, `formatHelp`, `formatNotFound` (lib/bot-commands.mjs); `getMarkets`, `getDayCandles`, `candlesToOhlcv` (lib/upbit.mjs); `confirmedOhlcvAsOf` (lib/ohlcv.mjs); `analyzeMarket` (lib/analyze.mjs); `detectQuietBottom` (lib/strategy.mjs); `readJson`, `readWeights` (lib/store.mjs); `readableSignals` (lib/signal-format.mjs)
- 이 태스크는 통합 스크립트(부수효과 위주) — 단위 테스트 없음. 수동 검증 스텝으로 확인.

- [ ] **Step 1: scripts/telegram-bot.mjs 작성**

```javascript
// 텔레그램 명령형 봇 — getUpdates 롱폴링. 조회 전용. chat_id 화이트리스트.
// 실행: npm run bot (또는 작업 스케줄러 로그인 시 시작)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getMarkets, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcvAsOf } from '../lib/ohlcv.mjs'
import { analyzeMarket } from '../lib/analyze.mjs'
import { detectQuietBottom } from '../lib/strategy.mjs'
import { readJson, readWeights } from '../lib/store.mjs'
import {
  parseCommand, resolveSymbol,
  formatCoin, formatStatus, formatStrategy, formatPositions, formatScorecard, formatHelp, formatNotFound,
} from '../lib/bot-commands.mjs'

const TOKEN = process.env.TELEGRAM_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID
const API = `https://api.telegram.org/bot${TOKEN}`
const LOCAL = 'http://127.0.0.1:8787'
const __dirname = dirname(fileURLToPath(import.meta.url))

if (!TOKEN || !CHAT_ID) { console.error('TELEGRAM_TOKEN/CHAT_ID 미설정 — 봇 종료'); process.exit(0) }

async function tg(method, body) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    })
    return await r.json()
  } catch { return null }
}

async function send(text) {
  await tg('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
}

// 로컬 8787 우선, 실패 시 null (호출부가 파일 폴백)
async function localApi(path) {
  try {
    const r = await fetch(`${LOCAL}${path}`, { signal: AbortSignal.timeout(3_000) })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

async function handleCoin(arg) {
  const markets = await getMarkets()
  if (!markets.length) return '업비트 응답 없음, 잠시 후 재시도'
  const res = resolveSymbol(arg, markets)
  if (res.notFound) return formatNotFound(arg, res.suggestions)
  const candles = await getDayCandles(res.market, 120)
  if (!candles) return '업비트 캔들 조회 실패, 잠시 후 재시도'
  const confirmed = confirmedOhlcvAsOf(candlesToOhlcv(candles), Date.now())
  const weights = await readWeights()
  const a = analyzeMarket(confirmed, { weights })
  const cfg = await readJson('strategy-config.json', null)
  const quietBottom = cfg ? detectQuietBottom(confirmed, cfg) : null
  const lows = confirmed.map((c) => c.low), highs = confirmed.map((c) => c.high)
  const min = Math.min(...lows.slice(-90)), max = Math.max(...highs.slice(-90))
  const pos90 = max > min ? ((a.indicators.price - min) / (max - min)) * 100 : 0
  const mk = markets.find((m) => m.market === res.market)
  const cautions = mk?.caution ? ['주의지정'] : []
  return formatCoin({
    korean_name: res.korean_name, market: res.market,
    indicators: a.indicators, quietBottom,
    designation: { warning: !!mk?.warning, cautions }, pos90,
  })
}

async function handleStatus() {
  const r = await localApi('/api/results')
  let scan = r
  if (!scan) { // 파일 폴백: 아카이브 최신 줄
    const log = await readJson('monitor-log.json', { scans: [] })
    scan = log.scans?.at(-1)
  }
  if (!scan) return '스캔 데이터 없음'
  const regime = scan.regime || {}
  const buy = scan.buy || []
  return formatStatus({
    ratio: regime.ratio ?? null, trend: regime.trend ?? 'neutral',
    buyCount: buy.length, sellCount: (scan.sell || []).length,
    topBuy: buy.slice(0, 3),
  })
}

async function handleStrategy() {
  const sc = await localApi('/api/scorecard') || { strategy: null, episodes: [] }
  const s = sc.strategy
  if (!s) return '🎯 전략 에피소드 없음'
  const openList = (sc.episodes || []).filter((e) => e.strategyOutcome?.reason === 'open').slice(0, 8)
  return formatStrategy({ ...s, openList })
}

async function handlePositions() {
  const p = await localApi('/api/positions') || []
  const list = Array.isArray(p) ? p : (p.positions || [])
  return formatPositions(list)
}

async function handleScorecard() {
  const sc = await localApi('/api/scorecard')
  if (!sc || sc.empty) return '📊 스코어카드 데이터 없음'
  return formatScorecard({ ...sc.horizons, total: sc.total, pendingCount: sc.pendingCount })
}

function handleScan() {
  // 기존 스캔 스크립트를 그대로 실행 — monitor.mjs가 자체 리치 알림을 발송한다.
  const child = spawn(process.execPath, [join(__dirname, 'monitor.mjs')], {
    cwd: join(__dirname, '..'), stdio: 'ignore', detached: true, env: process.env,
  })
  child.unref()
}

async function dispatch(cmd, arg) {
  switch (cmd) {
    case 'scan': await send('⏳ 스캔 중… (완료되면 결과 알림이 옵니다)'); handleScan(); return null
    case 'coin': return arg ? await handleCoin(arg) : '사용법: /코인 SOPH'
    case 'status': return await handleStatus()
    case 'strategy': return await handleStrategy()
    case 'positions': return await handlePositions()
    case 'scorecard': return await handleScorecard()
    default: return formatHelp()
  }
}

async function loop() {
  console.log('텔레그램 봇 시작 — 롱폴링')
  // 시작 시 밀린 메시지 건너뛰기(스팸 방지): 최신 offset 확보
  let offset = 0
  const init = await tg('getUpdates', { timeout: 0, offset: -1 })
  if (init?.result?.length) offset = init.result.at(-1).update_id + 1
  for (;;) {
    const upd = await tg('getUpdates', { timeout: 25, offset })
    if (!upd?.ok) { await new Promise((r) => setTimeout(r, 5_000)); continue }
    for (const u of upd.result) {
      offset = u.update_id + 1
      const msg = u.message
      if (!msg || !msg.text) continue
      if (String(msg.chat.id) !== String(CHAT_ID)) { console.log('무시(비인가 chat):', msg.chat.id); continue }
      const parsed = parseCommand(msg.text)
      if (!parsed) continue
      try {
        const reply = await dispatch(parsed.cmd, parsed.arg)
        if (reply) await send(reply)
      } catch (e) {
        console.error('명령 처리 오류:', e.message)
        await send('⚠️ 처리 중 오류가 났어요. 잠시 후 다시 시도해주세요.')
      }
    }
  }
}

loop()
```

- [ ] **Step 2: package.json에 스크립트 추가**

`package.json`의 `"scripts"` 객체에 한 줄 추가(기존 항목 뒤, 쉼표 유지):
```json
    "bot": "node scripts/telegram-bot.mjs",
```

- [ ] **Step 3: 문법·기동 확인**

Run: `node --check scripts/telegram-bot.mjs`
Expected: 오류 없음(exit 0)

- [ ] **Step 4: 수동 통합 검증 (env 설정된 상태에서)**

봇을 백그라운드로 띄우고 폰에서 `/help`, `/status`, `/코인 BTC`, `/스코어카드`를 차례로 전송해 응답이 오는지 확인. (검증 후 프로세스 종료)
```bash
TELEGRAM_TOKEN=$TELEGRAM_TOKEN TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID node scripts/telegram-bot.mjs &
BOT_PID=$!
# 폰에서 /help /status /코인 BTC 전송 → 응답 확인
# 확인 후:
kill $BOT_PID
```
Expected: 각 명령에 HTML 포맷 응답 도착. 비인가 chat은 무시 로그.

- [ ] **Step 5: 커밋**

```bash
git add scripts/telegram-bot.mjs package.json
git commit -m "feat(bot): 롱폴링 프로세스 + 명령 디스패치 + 데이터 수집

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 자동 시작 등록 + 문서

**Files:**
- Modify: `scripts/install-scheduler.ps1`
- Modify: `.env.example`
- Modify: `docs/CHANGELOG-2026-08.md`

**Interfaces:**
- Consumes: 없음 (배포·문서)

- [ ] **Step 1: install-scheduler.ps1에 봇 태스크 추가**

`scripts/install-scheduler.ps1`에서 3시간 슬롯 태스크 등록 루프가 끝난 지점 뒤에, 로그인 시 시작하는 상주 봇 태스크를 추가한다. 아래 블록을 파일의 태스크 등록부 마지막(기존 `$jobs` 루프 등록이 끝난 곳)에 삽입:
```powershell
# 상주 텔레그램 봇 — 로그인 시 시작(조회 명령 응답). 스캔 태스크와 독립.
$botScript = Join-Path $projectRoot 'scripts\telegram-bot.mjs'
$botAction = New-LoggingAction $botScript 'UpbitTelegramBot'
$botTrigger = New-ScheduledTaskTrigger -AtLogOn
$botSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999
Register-ScheduledTask -TaskName 'UpbitTelegramBot' -Action $botAction -Trigger $botTrigger -Settings $botSettings -Force | Out-Null
Write-Host "registered UpbitTelegramBot (AtLogOn, always-on)"
```
(주: `ExecutionTimeLimit Zero`=무제한, 상주용. `RestartCount`로 죽으면 재기동.)

- [ ] **Step 2: .env.example 주석 보강**

`.env.example`의 Telegram 섹션을 아래로 교체:
```
# Telegram 알림 + 명령형 봇 (선택)
# - 알림: 매 스캔 후 매수 상위 5개 자동 전송
# - 봇: 폰에서 /scan /코인 /status /전략 /포지션 /스코어카드 /help 명령
# - 봇 실행: npm run bot (또는 작업 스케줄러가 로그인 시 자동 시작)
# TELEGRAM_TOKEN=
# TELEGRAM_CHAT_ID=
```

- [ ] **Step 3: CHANGELOG 추가**

`docs/CHANGELOG-2026-08.md` 끝에 섹션 추가:
```markdown

## 3. 텔레그램 명령형 봇 (2026-08-19)

설계·플랜: `docs/superpowers/{specs,plans}/2026-08-19-telegram-command-bot*`.

- 조회 전용 상주 봇(`scripts/telegram-bot.mjs`, getUpdates 롱폴링). chat_id 화이트리스트.
- 명령 6종 + help: `/scan`(수동 스캔 트리거), `/코인 <심볼>`(지표·90일위치·유의지정·조용한바닥 시그니처), `/status`(시장심리·레짐·상위매수), `/전략`, `/포지션`, `/스코어카드`.
- 순수 로직 분리: `lib/bot-commands.mjs`(파서·심볼해석·포맷터), `lib/signal-format.mjs`(monitor와 공유하는 신호→근거 변환).
- 데이터: 로컬 8787 API 우선, 실패 시 파일 폴백. /scan·/코인은 업비트 직접.
- 작업 스케줄러 AtLogOn 상주 등록(RestartCount로 자동 재기동).
```

- [ ] **Step 4: 전체 회귀 + 문법 확인**

Run: `npx vitest run && node --check scripts/telegram-bot.mjs`
Expected: 전체 테스트 PASS (416 + 18 = 약 434), 문법 OK

- [ ] **Step 5: 커밋**

```bash
git add scripts/install-scheduler.ps1 .env.example docs/CHANGELOG-2026-08.md
git commit -m "feat(bot): 로그인 시 자동 시작 등록 + 문서

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 명령 6종+help → Task 2·3 파서/포맷터, Task 4 디스패치 ✅
- chat_id 화이트리스트 → Task 4 loop ✅
- 로컬 API 우선 + 파일 폴백 → Task 4 localApi/handle* ✅
- /scan·/코인 업비트 직접 → Task 4 handleCoin/handleScan ✅
- readableSignals 공유 승격 → Task 1 ✅
- 심볼 해석(영문·한글·KRW-, 미존재 후보) → Task 2 ✅
- 폴링 offset·백오프·시작 시 밀린 메시지 스킵 → Task 4 loop ✅
- AtLogOn 자동 시작 → Task 5 ✅
- 테스트: signal-format, bot-commands(파서·해석·포맷터) → Task 1·2·3 ✅
- 비범위(주문/버튼/다중사용자/웹훅) 준수 ✅

**Placeholder scan:** 전 스텝 실제 코드·명령 포함, 플레이스홀더 없음.

**Type consistency:** `readableSignals` 반환 `{reasons,warns,strategy}` 일관(Task1↔3). 포맷터 입력 필드명(indicators.stoch.k, macd.hist, strategy의 sl/tp/time/open/noData)이 기존 api.mjs buildScorecard·analyzeMarket 반환과 일치. resolveSymbol 반환 형태 `{market,korean_name}|{notFound,suggestions}` 일관(Task2↔4).

주의: Task 4는 통합 스크립트라 단위 테스트 없음 — Step 4 수동 검증으로 대체(스펙의 "폴링 루프 테스트 제외" 준수).
