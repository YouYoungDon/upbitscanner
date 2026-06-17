import { describe, it, expect } from 'vitest'
import { btcRegime, regimeLabel } from '../lib/regime.mjs'

const series = (fn) => Array.from({ length: 210 }, (_, i) => ({ close: fn(i) }))

describe('btcRegime', () => {
  it('상승추세 → bull', () => {
    expect(btcRegime(series((i) => 100 + i)).trend).toBe('bull')
  })
  it('하락추세 → bear', () => {
    expect(btcRegime(series((i) => 300 - i)).trend).toBe('bear')
  })
  it('데이터 부족 → neutral', () => {
    expect(btcRegime([{ close: 1 }]).trend).toBe('neutral')
  })
})

describe('regimeLabel', () => {
  it('bull + 폭 양호 → 확장', () => {
    expect(regimeLabel(0.8, 'bull').label).toBe('확장')
  })
  it('bear → 수축', () => {
    expect(regimeLabel(0.8, 'bear').label).toBe('수축')
  })
  it('폭 매우 약하면 추세 무관 수축', () => {
    expect(regimeLabel(0.1, 'neutral').label).toBe('수축')
  })
  it('그 외 중립', () => {
    expect(regimeLabel(0.6, 'neutral').label).toBe('중립')
  })
})
