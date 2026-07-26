// 조용한 바닥 전략 그리드 백테스트.
// 종목당 일봉 1회 fetch → 지표 시리즈 기반 신호일 추출(검출 8조합) → 청산 27조합 시뮬.
// 선정: trades >= MIN_TRADES 중 avgRet 최대(동률 시 winRate) → strategy-config.json 기록.
import { getMarkets, getDayCandles, candlesToOhlcv } from '../lib/upbit.mjs'
import { confirmedOhlcv } from '../lib/ohlcv.mjs'
import { quietBottomSeries, simulateTrade } from '../lib/strategy.mjs'
import { writeJson } from '../lib/store.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN_TRADES = 80
const DETECT = []
for (const rsiMax of [26, 30]) for (const stochMax of [15, 20]) for (const volMax of [1.5, 2.0])
  DETECT.push({ rsiMax, stochMax, volMax })
const EXIT = []
for (const slPct of [5, 7, 10]) for (const tpPct of [8, 12, 18]) for (const holdMax of [3, 5, 7])
  EXIT.push({ slPct, tpPct, holdMax })

async function main() {
  const markets = await getMarkets()
  console.log(`전략 백테스트 — ${markets.length}종목 × ${DETECT.length * EXIT.length}조합`)
  const histories = []
  let failed = 0
  for (const m of markets) {
    const candles = await getDayCandles(m.market, 200)
    await sleep(200)
    if (!candles || candles.length < 80) { failed++; continue }
    histories.push(confirmedOhlcv(candlesToOhlcv(candles)))
  }
  console.log(`캔들 확보 ${histories.length} / 스킵 ${failed}`)

  const results = []
  for (const det of DETECT) {
    // 검출 조합당 신호일 시리즈를 히스토리별로 1회만 계산
    const signalSets = histories.map((h) => quietBottomSeries(h, det))
    for (const exit of EXIT) {
      let trades = 0, wins = 0, total = 0, tp = 0, sl = 0, time = 0
      for (let hIdx = 0; hIdx < histories.length; hIdx++) {
        const h = histories[hIdx]
        const sig = signalSets[hIdx]
        let i = 0
        while (i < h.length - 1) {
          if (sig[i]) {
            const t = simulateTrade(h, i, exit)
            if (t) {
              trades++; total += t.ret
              if (t.ret > 0) wins++
              if (t.reason === 'tp') tp++
              else if (t.reason === 'sl') sl++
              else time++
              i = t.exitIdx + 1 // 청산 전 재진입 금지
              continue
            }
          }
          i++
        }
      }
      results.push({
        ...det, ...exit, trades,
        winRate: trades ? +(wins / trades).toFixed(4) : null,
        avgRet: trades ? +(total / trades).toFixed(5) : null,
        tpRate: trades ? +(tp / trades).toFixed(3) : null,
        slRate: trades ? +(sl / trades).toFixed(3) : null,
        timeRate: trades ? +(time / trades).toFixed(3) : null,
      })
    }
  }

  results.sort((a, b) => (b.avgRet ?? -1) - (a.avgRet ?? -1) || (b.winRate ?? 0) - (a.winRate ?? 0))
  await writeJson('strategy-backtest-results.json', { ranAt: new Date().toISOString(), markets: histories.length, combos: results })

  console.log('--- 상위 10 조합 ---')
  for (const r of results.slice(0, 10)) {
    console.log(`RSI<=${r.rsiMax} K<=${r.stochMax} vol<=${r.volMax} SL${r.slPct} TP${r.tpPct} hold${r.holdMax}` +
      ` | n=${r.trades} 승률 ${(r.winRate * 100).toFixed(1)}% 평균 ${(r.avgRet * 100).toFixed(2)}% (tp ${(r.tpRate * 100).toFixed(0)}/sl ${(r.slRate * 100).toFixed(0)}/time ${(r.timeRate * 100).toFixed(0)}%)`)
  }

  const eligible = results.filter((r) => r.trades >= MIN_TRADES)
  if (!eligible.length) {
    console.error(`선정 실패: trades >= ${MIN_TRADES} 조합 없음 — strategy-config.json 미기록`)
    process.exitCode = 1
    return
  }
  const best = eligible[0] // results가 이미 avgRet→winRate 정렬이므로 첫 eligible이 최적
  const config = {
    version: 'quiet-bottom-v1', confirmedAt: new Date().toISOString(),
    rsiMax: best.rsiMax, stochMax: best.stochMax, volMax: best.volMax,
    slPct: best.slPct, tpPct: best.tpPct, holdMax: best.holdMax,
  }
  await writeJson('strategy-config.json', config)
  console.log('선정:', JSON.stringify(config))
}

main()
