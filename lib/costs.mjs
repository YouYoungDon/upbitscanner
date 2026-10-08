// 거래 비용 — 백테스트·스코어카드 공용. 업비트 KRW 수수료 0.05%×2(매수·매도) + 슬리피지 0.2% 가정.
// 슬리피지는 거래대금 1~5억 코인에서 더 클 수 있어 보수적으로 잡은 값이다(2026-10-08 퀀트 QA).
export const ROUND_TRIP_COST = 0.003

// 수익(분수) → 왕복 비용 차감 순수익. 비유한값은 null.
export const netRet = (r) => (Number.isFinite(r) ? r - ROUND_TRIP_COST : null)
