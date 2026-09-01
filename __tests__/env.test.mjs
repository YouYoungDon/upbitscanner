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
  it('닫는 따옴표 없으면 여는 따옴표만 제거', () => {
    expect(parseEnv('K="half')).toEqual({ K: 'half' })
  })
  it('값에 = 포함 허용', () => {
    expect(parseEnv('K=a=b=c')).toEqual({ K: 'a=b=c' })
  })
  it('인라인 # 주석 제거 (공백 뒤 #)', () => {
    expect(parseEnv('TELEGRAM_CHAT_ID=12345 # doni')).toEqual({ TELEGRAM_CHAT_ID: '12345' })
    expect(parseEnv('K=abc\t# 탭 앞 주석')).toEqual({ K: 'abc' })
  })
  it('공백 없는 #은 값의 일부(주석 아님)', () => {
    expect(parseEnv('K=abc#notacomment')).toEqual({ K: 'abc#notacomment' })
  })
  it('값 전체가 주석이면 빈 값 → 무시', () => {
    expect(parseEnv('K= # 전부 주석')).toEqual({})
  })
  it('따옴표 값은 내부 # 보존, 뒤 인라인 주석은 버림', () => {
    expect(parseEnv('K="abc # keep" # drop')).toEqual({ K: 'abc # keep' })
  })
  it('주석·빈 줄·소문자키·빈 값 무시', () => {
    expect(parseEnv('# comment\n\nlower=x\nEMPTY=\nGOOD=1')).toEqual({ GOOD: '1' })
  })
})
