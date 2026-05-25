/** Returns true when `channel_id` looks like a Telegram numeric chat id. */
export function isNumericTelegramChatId(raw: string | null | undefined): boolean {
  const value = (raw ?? '').trim()
  if (!value) return false
  return /^-?\d+$/.test(value)
}

/** Telegram public usernames: 5–32 chars, letters, digits, underscore only. */
export function isValidTelegramUsername(raw: string | null | undefined): boolean {
  const value = (raw ?? '').trim().replace(/^@/, '')
  if (!value) return false
  return /^[a-z0-9_]{5,32}$/i.test(value)
}

export function normalizeTelegramUsername(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^@/, '').toLowerCase()
}

/** True when the row has enough identity for the worker listener to map live messages. */
export function hasValidTelegramChannelIdentity(channel: {
  channel_id?: string | null
  channel_username?: string | null
}): boolean {
  if (isValidTelegramUsername(channel.channel_username)) return true
  return isNumericTelegramChatId(channel.channel_id)
}

export function validateManualChannelInput(input: {
  channel_id: string
  channel_username: string
  display_name: string
}): { ok: true } | { ok: false; errorKey: 'nameRequired' | 'identityRequired' | 'invalidChannelId' | 'invalidUsername' } {
  if (!input.display_name.trim()) return { ok: false, errorKey: 'nameRequired' }
  const username = normalizeTelegramUsername(input.channel_username)
  const chatId = input.channel_id.trim()
  if (!username && !chatId) return { ok: false, errorKey: 'identityRequired' }
  if (chatId && !isNumericTelegramChatId(chatId)) {
    return { ok: false, errorKey: 'invalidChannelId' }
  }
  if (username && !isValidTelegramUsername(username)) {
    return { ok: false, errorKey: 'invalidUsername' }
  }
  return { ok: true }
}
