// 픽 성과 스코어카드 — 순수 로직.
// 에피소드: 직전 스캔 매수 리스트에 없던 마켓이 새로 등장한 순간의 스냅샷.

export function extractEpisodes(scans) {
  const episodes = []
  let prev = new Set()
  for (const scan of scans) {
    const cur = new Set()
    for (const item of scan.buy ?? []) {
      cur.add(item.market)
      if (prev.has(item.market)) continue
      episodes.push({
        id: `${item.market}@${scan.timestamp}`,
        market: item.market,
        korean_name: item.korean_name,
        entryTs: scan.timestamp,
        entryPrice: item.price,
        score: item.score,
        signals: item.signals ?? [],
        lowLiquidity: !!item.lowLiquidity,
        ret1: null, ret3: null, ret7: null,
        mfe1: null, mfe3: null, mfe7: null,
        status: 'pending',
        scoredAt: null,
      })
    }
    prev = cur
  }
  return episodes
}
