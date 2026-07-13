// 요청 본문을 상한(16KB)까지 바이트로 모아 1회 UTF-8 디코드 후 JSON 파싱.
export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('본문이 너무 큽니다')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) } catch { reject(new Error('잘못된 JSON')) }
    })
    req.on('error', reject)
  })
}
