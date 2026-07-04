const BASE = 'https://api.coingecko.com/api/v3'

// Demo 키: 환경변수 → data/coingecko-key.json → null (null이면 상위에서 전 기능 무해 skip)
export async function loadApiKey(readJsonFn, env = process.env) {
  if (env.COINGECKO_API_KEY) return env.COINGECKO_API_KEY
  const f = await readJsonFn('coingecko-key.json', null)
  return f?.apiKey || null
}

// upbit.mjs get()과 동일 정책: 429/5xx/네트워크는 지수 백오프 재시도, 그 외 4xx는 즉시 포기
async function cgGet(path, apiKey, { retries = 2, fetchImpl = fetch, sleepMs = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetchImpl(`${BASE}${path}`, { headers: { Accept: 'application/json', 'x-cg-demo-api-key': apiKey } })
      if (r.ok) return r.json()
      if (attempt >= retries || (r.status < 500 && r.status !== 429)) return null
    } catch {
      if (attempt >= retries) return null
    }
    await new Promise((res) => setTimeout(res, sleepMs * (attempt + 1)))
  }
}

// ids를 250개씩 분할해 /coins/markets 조회 (KRW 기준 — 환율 변환 불필요, 7d/30d 수익률 포함).
// 전체 실패 → null, 부분 실패 → 확보분 반환.
export async function fetchCgMarkets(ids, apiKey, opts = {}) {
  if (!apiKey || !ids?.length) return null
  const out = []
  for (let i = 0; i < ids.length; i += 250) {
    const q = new URLSearchParams({
      vs_currency: 'krw', ids: ids.slice(i, i + 250).join(','), per_page: '250', price_change_percentage: '7d,30d',
    })
    const page = await cgGet(`/coins/markets?${q}`, apiKey, opts)
    if (!page) return out.length ? out : null
    out.push(...page)
  }
  return out
}

// 전체 코인 id/symbol 목록 (심볼 매핑 재구축용, 주 1회)
export async function fetchCgCoinsList(apiKey, opts = {}) {
  if (!apiKey) return null
  return cgGet('/coins/list', apiKey, opts)
}
