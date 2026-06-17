// 추이 저널의 결정적(LLM 불필요) 수치 엔트리 생성. 최신 스캔 기준.
export function buildTrendEntry(scans) {
  if (!scans || !scans.length) return null
  const last = scans.at(-1)
  const prev = scans.at(-2)
  const ratio = +(last.buy.length / Math.max(last.sell.length, 1)).toFixed(2)
  const prevRatio = prev ? +(prev.buy.length / Math.max(prev.sell.length, 1)).toFixed(2) : null
  const top3 = [...(last.buy || [])].sort((a, b) => b.score - a.score).slice(0, 3)
    .map((b) => `${b.korean_name}(${b.score})`).join(', ') || '없음'
  const volSurge = (last.buy || []).filter((b) => (b.signals || []).some((s) => s.includes('거래량 급증')))
    .map((b) => b.korean_name).join(', ') || '없음'
  const kst = new Date(new Date(last.timestamp).getTime() + 9 * 3600 * 1000).toISOString()
  const hdr = `${kst.slice(0, 10)} ${kst.slice(11, 16)}`
  const marker = `<!-- scan:${last.timestamp} -->`
  const markdown = `## [auto] ${hdr} ${marker}\n\n`
    + `- 시장심리 ${ratio}${prevRatio != null ? ` (직전 ${prevRatio})` : ''}${ratio >= 0.5 ? ' · 0.5 돌파' : ''}\n`
    + `- 매수 ${(last.buy || []).length} / 매도 ${(last.sell || []).length}\n`
    + `- 매수 TOP3: ${top3}\n`
    + `- 거래량 급증: ${volSurge}\n`
  return { scanTs: last.timestamp, marker, markdown }
}
