// lightweight-charts 래퍼. 전역 LightweightCharts 사용.
window.Charts = {
  candle(el, ohlcv, { volume = true } = {}) {
    el.innerHTML = ''
    if (!window.LightweightCharts) { el.textContent = '차트 로드 실패 (오프라인)'; return }
    const chart = LightweightCharts.createChart(el, {
      layout: { background: { color: '#161b22' }, textColor: '#adbac7' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      width: el.clientWidth, height: 300,
    })
    const s = chart.addCandlestickSeries()
    const base = Date.now() - ohlcv.length * 86400000
    // 서버가 준 실제 캔들 시각(c.time) 우선, 없으면 일봉 간격으로 합성 (4h/1h 정렬 정확)
    const tof = (c, i) => c.time ?? Math.floor((base + i * 86400000) / 1000)
    s.setData(ohlcv.map((c, i) => ({
      time: tof(c, i),
      open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    if (volume) {
      const v = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } })
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      v.setData(ohlcv.map((c, i) => ({ time: tof(c, i), value: c.volume, color: '#30363d' })))
    }
    chart.timeScale().fitContent()
  },
  line(el, closes) {
    el.innerHTML = ''
    if (!window.LightweightCharts) { el.textContent = '차트 로드 실패'; return }
    const chart = LightweightCharts.createChart(el, {
      layout: { background: { color: '#161b22' }, textColor: '#adbac7' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      width: el.clientWidth, height: 300,
    })
    const s = chart.addLineSeries({ color: '#58a6ff' })
    const base = Date.now() - closes.length * 86400000
    s.setData(closes.map((v, i) => ({ time: Math.floor((base + i * 86400000) / 1000), value: v })))
    chart.timeScale().fitContent()
  },
  // 작은 추이 스파크라인 (SVG 문자열 반환). values: number[]
  sparkline(values, color) {
    const w = 240, h = 40, pad = 2
    if (!values || values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`
    const max = Math.max(...values), min = Math.min(...values)
    const span = max - min || 1
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`
  },
}
