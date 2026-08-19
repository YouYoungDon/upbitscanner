// 텔레그램 봇 명령 파싱·심볼 해석·응답 포맷 (순수 로직).
import { readableSignals } from './signal-format.mjs'

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

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtP = (n) => {
  if (n == null) return '-'
  const a = Math.abs(n)
  if (a >= 1000) return Math.round(n).toLocaleString('ko-KR')       // 큰 금액은 반올림
  if (a >= 1) return Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  return Number(n).toPrecision(3)                                   // 1원 미만 코인
}
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
