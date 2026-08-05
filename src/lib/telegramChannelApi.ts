import type { TelegramChannel } from '../types/database'
import { ensureFreshAuthSession } from './fxsocketBroker'

export type TelegramChannelUpsertInput = {
  channel_id: string
  channel_username?: string
  display_name: string
  is_active?: boolean
  lot_size_override?: number | null
  pip_tolerance_override?: number | null
}

/** Strip `channel_limit: ` / `broker_account_limit: ` prefixes from DB trigger errors. */
export function planLimitErrorMessage(raw: string): string {
  const m = /^(channel_limit|broker_account_limit|subscription_required):\s*(.+)$/i.exec(raw.trim())
  return m?.[2]?.trim() || raw
}

export async function upsertTelegramChannels(
  channels: TelegramChannelUpsertInput[],
): Promise<{ channels: TelegramChannel[]; error: string | null; code?: string }> {
  if (channels.length === 0) {
    return { channels: [], error: 'channels required' }
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/upsert-telegram-channel`
  let token: string
  try {
    token = await ensureFreshAuthSession()
  } catch {
    return { channels: [], error: 'Not signed in' }
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({ channels }),
    })
  } catch {
    return { channels: [], error: 'Could not reach upsert-telegram-channel. Deploy the edge function first.' }
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }

  if (!res.ok) {
    const obj = body && typeof body === 'object' ? body as Record<string, unknown> : null
    const msg = obj && typeof obj.error === 'string'
      ? obj.error
      : text || `HTTP ${res.status}`
    const code = obj && typeof obj.code === 'string' ? obj.code : undefined
    return { channels: [], error: planLimitErrorMessage(msg), code }
  }

  const obj = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const list = obj && Array.isArray(obj.channels) ? obj.channels as TelegramChannel[] : []
  return { channels: list, error: null }
}

export async function upsertTelegramChannel(
  channel: TelegramChannelUpsertInput,
): Promise<{ channel: TelegramChannel | null; error: string | null; code?: string }> {
  const { channels, error, code } = await upsertTelegramChannels([channel])
  return { channel: channels[0] ?? null, error, code }
}
