// 업비트 KRW 마켓과 같은 심볼의 바이낸스 USDT 현물 일봉(최대 1000일)을 받아 data/research/binance-1d.json에 저장.
// 필드: [UTC 일 번호, 종가, 거래대금(quote), 테이커 매수 거래대금(taker buy quote)].
// 실행: node scripts/research/accumulation/fetch-binance.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const C = JSON.parse(readFileSync(new URL('../../../data/research/candles.json', import.meta.url), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = {}
let ok = 0, miss = 0
for (const m of Object.keys(C)) {
  const sym = m.replace('KRW-', '') + 'USDT'
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=1d&limit=1000`).catch(() => null)
  if (r?.ok) {
    const k = await r.json()
    out[m] = k.map((x) => [Math.floor(x[0] / 86400000), +x[4], +x[7], +x[10]])
    ok++
  } else miss++
  await sleep(120)
}
writeFileSync(new URL('../../../data/research/binance-1d.json', import.meta.url), JSON.stringify(out))
console.log(`바이낸스 일봉: 확보 ${ok} / 미상장 ${miss}`)
