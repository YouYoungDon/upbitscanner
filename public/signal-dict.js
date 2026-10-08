// 신호 사전 — 스캐너가 붙이는 모든 신호 라벨의 짧은 이름·색·설명(마우스 오버 툴팁·신호 사전 카드 공용).
// 라벨은 접두어로 찾는다(가장 긴 접두어 우선). 점수·배수는 lib/ 원본과 맞춰 둔다:
//   매수/매도 기본점 lib/signals.mjs · 모멘텀 lib/momentum.mjs · 배수 lib/buy-modifiers.mjs 체인
//   (유동성 lib/scan-universe · 펀딩 lib/funding · 구조 lib/structural-risk · 이벤트 lib/exchange-events)
// 새 신호를 추가하면 __tests__/signal-dict.test.mjs의 LIVE_LABELS에도 넣는다(설명 누락을 테스트가 잡는다).
// 짧은 이름의 {n}은 라벨 안 첫 숫자로 바뀐다.
(function (g) {
  const SIGNAL_GROUPS = [
    { id: 'buy', title: '🟢 반등 매수 신호 (메인 스캔)', note: '점수를 더해 합계가 기준을 넘으면 매수 목록. 숫자는 기본 점수(주간 가중치가 곱해짐).' },
    { id: 'bonus', title: '➕ 가산·확인', note: '조건이 겹칠 때 점수를 올린다.' },
    { id: 'penalty', title: '➖ 감점·경고', note: '점수를 깎거나 목록에서 뺀다. 매수 전에 꼭 확인.' },
    { id: 'sell', title: '🔴 매도 신호', note: '보유 중이면 청산을 고려하는 근거. 합계가 기준을 넘으면 매도 목록.' },
    { id: 'momentum', title: '🚀 추세지속 신호 (모멘텀 스캔)', note: '오르는 추세가 이어지는지 본다. 합계 10점↑이면 추세지속 목록.' },
    { id: 'retired', title: '🗄️ 제거된 신호 (옛 기록에만 보임)', note: '측정상 효과가 없거나 반대였던 신호. 지금 스캔은 붙이지 않는다.' },
  ]

  const E = (key, short, group, tip, cls) => ({ key, short, group, tip, cls })
  const B = 'badge-success', S = 'badge-error', W = 'badge-warning', M = 'badge-info', P = 'badge-primary', R = 'badge-ghost'

  const SIGNAL_DICT = [
    // 반등 매수
    E('RSI 과매도', 'RSI과매도 {n}', 'buy', 'RSI(14)가 30 아래 — 짧은 기간에 많이 빠져 반등 여지가 있다. 매수 +3', B),
    E('BB 하단 지지', 'BB하단', 'buy', '가격이 볼린저밴드 하단(20일·2σ) 0.5% 안 — 통계적으로 싼 자리. 매수 +2', B),
    E('Stoch 과매도 골든크로스', 'Stoch GC {n}', 'buy', 'Stoch K가 20 아래에서 D를 위로 뚫음 — 과매도 속 반등 시작. 매수 +3, 반등확인 보너스(×1.4) 발동', B),
    E('Stoch 과매도', 'Stoch과매도 {n}', 'buy', 'Stoch K가 20 아래 — 최근 범위의 바닥권. 매수 +2', B),
    E('Williams %R 과매도', '%R과매도 {n}', 'buy', 'Williams %R이 −85 이하 — 최근 14일 범위의 최하단. 매수 +1', B),
    E('MACD 골든크로스', 'MACD GC', 'buy', 'MACD선이 시그널선을 위로 뚫음 — 하락 힘이 꺾임. 매수 +3, 반등확인 보너스(×1.4) 발동', B),
    E('MACD 상승', 'MACD↑', 'buy', 'MACD가 시그널 위이고 시그널도 0 위 — 상승 흐름 유지. 매수 +1', B),
    E('EMA 상승배열', 'EMA↑배열', 'buy', '20일 평균이 50일 평균보다 0.5% 넘게 위 — 중기 상승 추세. 매수 +2', B),
    E('캔들 강세형', '🕯강세', 'buy', '반전형 캔들(상승장악형·샛별·망치형·관통형·역망치 등). 괄호 안이 잡힌 패턴. 매수 +2', B),
    E('역삼중바닥 패턴', '삼중바닥', 'buy', '최근 30봉 저점 3개가 1.5% 안에서 5봉 넘게 떨어져 찍히고 현재가가 그 평균 +2%↑ — 바닥 확인. 매수 +3', B),
    E('상승깃발 패턴', '상승깃발', 'buy', '16봉 동안 +8%↑ 오른 뒤 최근 3봉 −2~+0.3% 횡보 — 쉬었다 다시 갈 자리. 매수 +4', B),
    E('박스권 돌파 패턴', '박스돌파', 'buy', '20봉 동안 폭 5% 미만이던 박스를 종가가 1% 넘게 돌파. 매수 +4', B),
    E('유동성 스윕', '바닥스윕 {n}%', 'buy', '직전 20봉 저점을 장중에 잠깐 깼다가 종가로 복귀 — 손절 물량을 털고 올라온 모양(SMC). 깊이 1%↑ +4, 미만 +2', B),
    E('🎯V-Bottom', '🎯V바텀', 'buy', '투매 → 긴 밑꼬리 → 추세 전환 순서로 나온 V자 반등(2봉 이내). +5~7, 손절가 함께 제시', P),
    E('🎯전략', '🎯전략', 'buy', '조용한 바닥 전략 조건(RSI≤26·Stoch K≤15·거래량 평소 1.5배 이하). 손절 10%/목표 18%/최대 7일. 참고용 — 시장 대비 우위 미확인(2026-10-08 재측정)', P),

    // 가산·확인
    E('[콤보] 반등확인 보너스', '반등확인 ×1.4', 'bonus', '골든크로스(MACD·Stoch)가 있음 — 과매도에서 실제로 돌아서는 중. 매수 점수 ×1.4', B),
    E('[MTF]', '📡4h확인', 'bonus', '일봉 골든크로스에 4시간봉 Stoch 골든크로스까지 겹침 — 짧은 봉도 같은 방향. 점수 ×1.2', M),
    E('지속 매수권', '🔥지속', 'bonus', '여러 날 연속 매수 목록에 들어옴. 2일 +1, 3일↑ +2', W),
    E('⚡펀딩 스퀴즈연료(강)', '⚡스퀴즈(강)', 'bonus', '바이낸스 선물 펀딩비 −0.10% 이하 — 숏이 매우 몰림, 숏 청산 급등 연료. 점수 ×1.06', B),
    E('⚡펀딩 스퀴즈연료', '⚡스퀴즈', 'bonus', '바이낸스 선물 펀딩비 −0.05% 이하 — 숏이 몰림. 점수 ×1.04', B),

    // 감점·경고
    E('[콤보] 과매도 함정 페널티', '과매도함정 ×0.55', 'penalty', 'RSI·BB·Stoch·%R 과매도가 전부 떴는데 골든크로스가 없음 — 아직 떨어지는 중일 수 있다. 점수 ×0.55', S),
    E('[필터] 떨어지는칼', '🔪칼 ×0.5', 'penalty', '하락배열(20일 평균 < 50일 평균) 속 골든크로스 — 큰 추세는 아직 하락. 점수 ×0.5', S),
    E('[레짐] BTC 약세', 'BTC약세 ×0.85', 'penalty', 'BTC가 약세 추세 — 알트 반등 매수의 신뢰도가 낮다. 점수 ×0.85', W),
    E('⚠️유동성', '유동성 ×{n}', 'penalty', '24시간 거래대금이 작음(20~50억 ×0.9, 5~20억 ×0.8, 1~5억 ×0.6). 사고팔 때 가격이 밀리기 쉽다. 5억 미만은 저유동성 목록으로 분리', W),
    E('⚠️업비트단독', '업비트단독 {n}%', 'penalty', '전 세계 거래대금 중 업비트 비중 80%↑ — 국내에서만 띄우는 펌프 의심. 점수 ×0.8', S),
    E('⚠️업비트비중', '업비트비중 {n}%', 'penalty', '전 세계 거래대금 중 업비트 비중 50%↑ — 국내 쏠림. 점수 ×0.9', W),
    E('⚡펀딩 과열', '⚡펀딩과열', 'penalty', '바이낸스 선물 펀딩비 +0.10% 이상 — 롱이 과하게 몰림, 롱 청산 급락 위험. 점수 ×0.82', S),
    E('⚡펀딩 경계', '⚡펀딩경계', 'penalty', '바이낸스 선물 펀딩비 +0.05% 이상 — 롱 쏠림. 점수 ×0.92', W),
    E('⚠️구조리스크', '🏗️구조리스크', 'penalty', '토큰 구조 위험. 언락 오버행(유통 물량 30% 미만 ×0.85, 50% 미만 ×0.93)·거래소 주의(×0.9)는 감점, ATH −90%↓·시총 500위 밖은 표시만. 괄호 안이 걸린 항목', S),
    E('⚠️거래소이벤트', '거래소이벤트', 'penalty', '업비트·바이낸스 공지에서 잡힌 위험: 상장폐지(목록 제외)·유의종목(×0.5)·입출금 중단(×0.7)', S),
    E('추격주의', '⚠️추격주의', 'penalty', '당일 +2.4%↑ 또는 윗꼬리 5.8%↑(당일 과열), 또는 BTC 대비 김프 +3%p↑(국내 과열) — 18개월 측정상 이런 진입은 손해였다. 매수 목록에서 뺀다', S),

    // 매도
    E('RSI 과매수', 'RSI과매수 {n}', 'sell', 'RSI(14)가 70 위 — 단기 과열. 매도 +3', S),
    E('BB 상단 돌파', 'BB상단', 'sell', '가격이 볼린저밴드 상단 0.5% 안 — 통계적으로 비싼 자리. 매도 +2', S),
    E('MACD 데드크로스', 'MACD DC', 'sell', 'MACD선이 시그널선을 아래로 뚫음 — 상승 힘이 꺾임. 매도 +3', S),
    E('MACD 하락전환', 'MACD꺾임', 'sell', 'MACD 히스토그램이 양(+)에서 음(−)으로 바뀜. 매도 +2', S),
    E('MACD 하락', 'MACD↓', 'sell', 'MACD가 시그널 아래이고 시그널도 0 아래 — 하락 흐름 유지. 매도 +1', S),
    E('EMA 20/50 데드크로스', 'EMA DC', 'sell', '20일 평균이 50일 평균을 아래로 뚫음 — 중기 추세 하락 전환. 매도 +2', S),
    E('EMA 하락배열', 'EMA↓배열', 'sell', '20일 평균이 50일 평균보다 0.5% 넘게 아래 — 중기 하락 추세. 매도 +2', S),
    E('거래량 급증', 'VOL {n}x', 'sell', '가격이 내린 날 거래량이 평소 2배↑ — 던지는 물량. 배율 2/5/10/20x에 따라 매도 +1~4. (2026-10-07 이전 기록의 매수 쪽 급증은 제거된 신호)', S),
    E('캔들 약세형', '🕯약세', 'sell', '하락 반전형 캔들(하락장악형·석별·교수형·유성형·흑운형 등). 괄호 안이 잡힌 패턴. 매도 +2', S),
    E('유동성 스윕 고점', '고점스윕 {n}%', 'sell', '직전 20봉 고점을 장중에 잠깐 넘겼다가 종가로 밀림 — 위에서 물량을 넘긴 모양(SMC). 깊이 1%↑ +4, 미만 +2', S),

    // 추세지속(모멘텀)
    E('EMA 완전정배열', 'EMA완전정배열', 'momentum', '20일 > 50일 > 200일 평균 — 단·중·장기 모두 상승 추세. +4', P),
    E('EMA 정배열', 'EMA정배열', 'momentum', '20일 평균 > 50일 평균 — 중기 상승 추세. +2', P),
    E('연속양봉', '연속양봉 {n}', 'momentum', '양봉이 연달아 나옴. 3봉 +2, 5봉↑ +4', P),
    E('EMA20 상승기울기', 'EMA20↗', 'momentum', '20일 평균이 5봉 전보다 1%↑ 올라감 — 단기 추세가 위로 기울어짐. +2', P),
    E('200봉 신고가 갱신', '200봉 신고가', 'momentum', '현재가가 최근 200봉 최고가의 99%↑ — 위에 매물이 거의 없다. +4', P),
    E('200봉 신고가 근접', '신고가 근접', 'momentum', '현재가가 최근 200봉 최고가의 92%↑. +2', P),
    E('MACD 3연속↑ + RSI 골디락스', 'MACD3↑+RSI', 'momentum', 'MACD 히스토그램 3봉 연속 증가 + RSI 50~75 — 힘이 붙는데 과열은 아님. +4', P),
    E('MACD 히스토 3연속↑', 'MACD3↑', 'momentum', 'MACD 히스토그램이 3봉 연속 증가 — 상승 힘이 커지는 중. +2', P),
    E('RSI 골디락스', 'RSI 50~75', 'momentum', 'RSI가 50~75 — 상승 쪽이지만 과열 전. +2', P),
    E('OBV 매집', 'OBV매집', 'momentum', 'OBV(누적 거래량)는 오르는데 가격은 횡보 — 조용히 사 모으는 중일 수 있다(선행). +2', M),
    E('OBV 추세확인', 'OBV확인', 'momentum', 'OBV와 가격이 함께 오름 — 거래량이 상승을 받쳐 줌. +2', M),
    E('BB 스퀴즈 발산', 'BB스퀴즈', 'momentum', '볼린저밴드가 좁게 조였다가 벌어지기 시작 — 큰 움직임의 시작. +2', M),
    E('RSI 하락 다이버전스', 'RSI다이버전스 −4', 'momentum', '가격은 고점을 높였는데 RSI는 고점을 낮춤 — 상승 힘이 빠지는 중. −4', S),
    E('OBV 약화', 'OBV약화 −2', 'momentum', '가격은 오르는데 OBV는 안 오름 — 거래량이 상승을 안 받쳐 줌. −2', S),

    // 제거된 신호(옛 로그 표시용)
    E('쌍봉 패턴', '쌍봉', 'retired', '매도 패턴. 2026-10-08 제거 — 18개월 재생에서 뜬 뒤 오히려 올랐다', R),
    E('하락깃발 패턴', '하락깃발', 'retired', '매도 패턴. 2026-10-08 제거 — 재생상 역방향', R),
    E('Stoch 과매수', 'Stoch과매수', 'retired', '매도 신호(과매수·과매수 데드크로스). 2026-10-08 제거 — 재생상 역방향', R),
    E('Williams %R 과매수', '%R과매수', 'retired', '매도 신호. 2026-10-08 제거 — 재생상 역방향', R),
    E('[익절] Stoch DC', '익절 Stoch DC', 'retired', '익절 타이밍 표시. 2026-10-08 제거 — 근거 신호(Stoch 과매수 DC)가 역방향', R),
    E('[콤보] 거래량확인', '거래량확인', 'retired', '거래량 동반 보너스(×1.3~1.6). 2026-10-07 제거 — 상승 동반 거래량 급증 매수가 측정상 역방향', R),
    E('MACD 반등', 'MACD반등', 'retired', 'MACD 골든크로스와 같은 사건을 두 번 세던 신호. 2026-10-07 제거', R),
    E('EMA 20/50 골든크로스', 'EMA GC', 'retired', '매수 신호. 2026-10-07 제거 — 단독 효과 3일 −0.46%p', R),
    E('거래량 지속', '거래량지속', 'retired', '거래량 급증 지속 가산. 2026-10-07 제거(근거 신호 제거)', R),
    E('⚠️거래량 소멸', '거래량소멸', 'retired', '거래량 급증이 하루로 끝났다는 경고. 2026-10-07 제거(근거 신호 제거)', R),
  ]

  const BY_LEN = [...SIGNAL_DICT].sort((a, b) => b.key.length - a.key.length)

  function signalInfo(label) {
    if (typeof label !== 'string') return null
    return BY_LEN.find((e) => label.includes(e.key)) || null
  }

  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function shortOf(info, label) {
    if (!info.short.includes('{n}')) return info.short
    const m = label.match(/-?\d+(?:\.\d+)?/)
    return info.short.replace('{n}', m ? m[0] : '').trim()
  }

  // 신호 라벨 → 배지 HTML. title = 원문 + 설명(마우스 오버).
  function signalBadge(label) {
    const info = signalInfo(label)
    if (!info) return `<span class="badge badge-ghost badge-sm sig-tip" title="${escHtml(label)}">${escHtml(String(label).replace('⚠️', ''))}</span>`
    const tip = `${label}\n${info.tip}`
    return `<span class="badge ${info.cls} badge-sm sig-tip" title="${escHtml(tip)}">${escHtml(shortOf(info, label))}</span>`
  }

  // 신호 사전 카드 HTML (그룹별 배지 + 설명).
  function signalDictHtml() {
    return SIGNAL_GROUPS.map((gr) => {
      const rows = SIGNAL_DICT.filter((e) => e.group === gr.id).map((e) => `
        <tr><td class="whitespace-nowrap"><span class="badge ${e.cls} badge-sm">${escHtml(e.short.replace(/\s*\{n\}%?x?/, ''))}</span></td>
          <td class="text-xs">${escHtml(e.tip)}</td></tr>`).join('')
      return `<div class="mb-3"><div class="font-semibold text-sm">${gr.title}</div>
        <div class="text-xs opacity-60 mb-1">${gr.note}</div>
        <table class="table table-xs"><tbody>${rows}</tbody></table></div>`
    }).join('')
  }

  Object.assign(g, { SIGNAL_GROUPS, SIGNAL_DICT, signalInfo, signalBadge, signalDictHtml })
})(typeof window !== 'undefined' ? window : globalThis)
