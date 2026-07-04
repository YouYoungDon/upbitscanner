import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendTelegram } from '../lib/notify.mjs'

const OLD_ENV = process.env

beforeEach(() => {
  process.env = { ...OLD_ENV, TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' }
})
afterEach(() => {
  process.env = OLD_ENV
  vi.unstubAllGlobals()
})

describe('sendTelegram', () => {
  it('토큰/챗아이디 없으면 no-op(false)', async () => {
    process.env = { ...OLD_ENV, TELEGRAM_TOKEN: '', TELEGRAM_CHAT_ID: '' }
    expect(await sendTelegram('hi')).toBe(false)
  })
  it('fetch에 5s 타임아웃 signal을 전달한다', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await sendTelegram('hi')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('non-2xx 응답이면 false를 반환한다(전송 실패를 성공으로 오인하지 않음)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
    expect(await sendTelegram('hi')).toBe(false)
  })
  it('2xx 응답이면 true를 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
    expect(await sendTelegram('hi')).toBe(true)
  })
})
