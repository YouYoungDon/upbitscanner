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
    s.setData(ohlcv.map((c, i) => ({
      time: Math.floor((base + i * 86400000) / 1000),
      open: c.open, high: c.high, low: c.low, close: c.close,
    })))
    if (volume) {
      const v = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } })
      v.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
      v.setData(ohlcv.map((c, i) => ({ time: Math.floor((base + i * 86400000) / 1000), value: c.volume, color: '#30363d' })))
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
}
