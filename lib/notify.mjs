// Telegram 전송 공용 헬퍼 (TELEGRAM_TOKEN/CHAT_ID 미설정 시 no-op).
export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
    return true
  } catch {
    return false
  }
}
