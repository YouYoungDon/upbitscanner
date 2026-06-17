// 모멘텀 점수 백테스트: 상위 유동성 N종목 과거 일봉에 scoreMomentum 소급 적용 → forward return 집계.
// 사용: node scripts/backtest-momentum.mjs [N=30]
import { getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { backtestSamples } from '../lib/momentum.mjs'
import { getScanUniverse, sleep } from '../lib/scan-universe.mjs'

const N = Number(process.argv[2]) || 30
const HORIZONS = [3, 7]

const { targets, tradePrice } = await getScanUniverse()
const sample = [...targets].sort((a, b) => (tradePrice[b] || 0) - (tradePrice[a] || 0)).slice(0, N)
console.log(`백테스트 대상 상위 유동성 ${sample.length}종목`)

let all = []
for (const m of sample) {
  const c = await getDayCandles(m, 200)
  if (!c || c.length < 80) continue
  all.push(...backtestSamples(candlesToOhlcv(c), { horizons: HORIZONS }))
  await sleep(150)
}

console.log(`\n총 신호 표본 ${all.length}건 (score≥10)`)
for (const h of HORIZONS) {
  const rs = all.map((x) => x.fwd[h]).filter((r) => r != null)
  if (!rs.length) { console.log(`+${h}일: 표본 없음`); continue }
  const avg = rs.reduce((a, b) => a + b, 0) / rs.length
  const win = rs.filter((r) => r > 0).length / rs.length
  console.log(`+${h}일: 표본 ${rs.length}, 평균수익 ${avg.toFixed(2)}%, 승률 ${(win * 100).toFixed(0)}%`)
}
