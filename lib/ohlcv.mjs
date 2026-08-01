// OHLCV 시계열 계약 유틸 (API 클라이언트 upbit.mjs와 분리).
//
// confirmedOhlcv 계약:
//   입력: candlesToOhlcv() 이후의 chronological(오래된 봉 → 최신 봉) 배열.
//   마지막 요소는 current forming candle(오늘/이번 봉)일 수 있으므로 신호 판정에서 제외.
//   반환: 마지막(형성 중) 봉을 뺀 확정 캔들 배열. 빈/1개/비배열 → [].
export function confirmedOhlcv(ohlcv) {
  return Array.isArray(ohlcv) && ohlcv.length > 1 ? ohlcv.slice(0, -1) : []
}

// 날짜 인지 확정봉: 현재 시각 기준 당일(UTC) 봉만 제거.
// confirmedOhlcv(무조건 마지막 봉 제거)와 달리, 당일 거래가 없어 마지막 봉이 어제인
// 저유동 마켓에서 어제의 확정봉을 보존한다 — 일봉 채점(스코어카드·주간분석)용.
export function confirmedOhlcvAsOf(ohlcv, nowMs) {
  if (!Array.isArray(ohlcv)) return []
  const today = Math.floor(nowMs / 86400000)
  return ohlcv.filter((c) => Math.floor(c.time / 86400) < today)
}

// 확정봉이 최소 min개 있는지 보장. 부족하면 null(호출부가 스킵).
export function ensureMinConfirmed(confirmed, min) {
  return Array.isArray(confirmed) && confirmed.length >= min ? confirmed : null
}
