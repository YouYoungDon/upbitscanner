import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { readBody } from '../lib/http-body.mjs'

// req 목: data 청크를 순차 emit 후 end.
function fakeReq(chunks) {
  const req = new EventEmitter()
  req.destroy = () => {}
  queueMicrotask(async () => {
    for (const c of chunks) { req.emit('data', c); await Promise.resolve() }
    req.emit('end')
  })
  return req
}

describe('readBody', () => {
  it('멀티바이트 한글이 청크 경계로 쪼개져도 온전히 파싱', async () => {
    const json = JSON.stringify({ korean_name: '스페이스아이디', entry: 60 })
    const buf = Buffer.from(json, 'utf-8')
    // 한글 문자 중간에서 강제 분할
    const mid = 20
    const body = await readBody(fakeReq([buf.subarray(0, mid), buf.subarray(mid)]))
    expect(body).toEqual({ korean_name: '스페이스아이디', entry: 60 })
  })
  it('빈 본문 → {}', async () => {
    expect(await readBody(fakeReq([]))).toEqual({})
  })
  it('16KB 초과 → reject', async () => {
    const big = Buffer.alloc(17 * 1024, 0x61)
    await expect(readBody(fakeReq([big]))).rejects.toThrow()
  })
})
