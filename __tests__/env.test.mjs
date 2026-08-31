import { describe, it, expect } from 'vitest'
import { parseEnv } from '../lib/env.mjs'

describe('parseEnv', () => {
  it('KEY=value 파싱', () => {
    expect(parseEnv('TELEGRAM_TOKEN=abc123\nTELEGRAM_CHAT_ID=42')).toEqual({
      TELEGRAM_TOKEN: 'abc123', TELEGRAM_CHAT_ID: '42',
    })
  })
  it('앞뒤 공백·= 주변 공백 허용', () => {
    expect(parseEnv('  KEY  =  val  ')).toEqual({ KEY: 'val' })
  })
  it('양끝 짝맞춘 따옴표 제거(#4)', () => {
    expect(parseEnv('K="quoted"')).toEqual({ K: 'quoted' })
    expect(parseEnv("K='quoted'")).toEqual({ K: 'quoted' })
  })
  it('짝 안 맞는 따옴표는 그대로', () => {
    expect(parseEnv('K="half')).toEqual({ K: '"half' })
  })
  it('값에 = 포함 허용', () => {
    expect(parseEnv('K=a=b=c')).toEqual({ K: 'a=b=c' })
  })
  it('주석·빈 줄·소문자키·빈 값 무시', () => {
    expect(parseEnv('# comment\n\nlower=x\nEMPTY=\nGOOD=1')).toEqual({ GOOD: '1' })
  })
})
