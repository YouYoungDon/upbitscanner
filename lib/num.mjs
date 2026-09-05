// 수치 유틸 — 유한 실수 판정(NaN/Infinity/비수치 거름). 여러 모듈 공용.
export const finite = (n) => typeof n === 'number' && Number.isFinite(n)
