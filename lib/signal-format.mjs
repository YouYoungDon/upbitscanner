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
  if (has('⚡펀딩 스퀴즈연료(강)')) reasons.push('⚡펀딩 스퀴즈연료(강)')
  else if (has('⚡펀딩 스퀴즈연료')) reasons.push('⚡펀딩 스퀴즈연료')

  const warns = []
  if (has('추격주의')) warns.push('추격주의(급등후)')
  if (has('⚡펀딩 과열')) warns.push('⚡펀딩 과열(롱과밀)')
  else if (has('⚡펀딩 경계')) warns.push('⚡펀딩 경계')
  // '⚠️구조리스크(언락오버행(유통 20%)·거래소 주의·저순위 1278위)' →
  // '언락오버행(유통 20%) · 거래소 주의 · 저순위 1278위'
  // 경고 목록 안에서 '구조리스크' 래퍼는 중복 정보다(이미 ⚠️로 묶여 나간다). 게다가
  // 플래그 자체가 괄호를 쓰므로 래퍼까지 있으면 괄호가 이중으로 겹쳐 읽기 어렵다.
  // 신호 라벨(buy-modifiers가 만드는 원문)은 건드리지 않는다 — 아카이브와 키잉이 의존한다.
  const sr = grab('구조리스크')
  if (sr) {
    const inner = sr.match(/구조리스크\((.*)\)\s*$/)?.[1]
    warns.push(inner ? inner.replace(/·/g, ' · ') : sr.replace('⚠️', ''))
  }
  if (has('업비트단독')) warns.push('업비트단독펌프')
  else if (has('업비트비중')) warns.push(`업비트비중 ${num('업비트비중') || ''}%`)
  if (has('떨어지는') || has('낙하')) warns.push('낙하 중')
  return { reasons, warns, strategy: has('🎯전략') }
}
