// 시간 유틸 — UTC 일(day) 인덱스 변환. 스코어카드·성과지표가 공유.
export const DAY_SECONDS = 86400

// ISO 타임스탬프 → UTC day 인덱스(정수). 파싱 실패 시 NaN(산술 전파는 기존 동작과 동일).
export function utcDay(isoTs) {
  return Math.floor(Date.parse(isoTs) / 1000 / DAY_SECONDS)
}
