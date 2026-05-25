import type { TelegramChannel } from '../types/database'
import { hasValidTelegramChannelIdentity } from './telegramChannelIdentity'

export type ChannelListenerHealth = 'invalid' | 'listening' | 'poll_only' | 'stale'

const LISTENING_MS = 2 * 60_000
const POLL_ONLY_MS = 30 * 60_000

export function getChannelListenerHealth(channel: TelegramChannel): ChannelListenerHealth {
  if (!hasValidTelegramChannelIdentity(channel)) return 'invalid'
  if (!channel.is_active) return 'stale'
  if (!channel.last_seen_at) return 'stale'
  const ageMs = Date.now() - new Date(channel.last_seen_at).getTime()
  if (ageMs <= LISTENING_MS) return 'listening'
  if (ageMs <= POLL_ONLY_MS) return 'poll_only'
  return 'stale'
}

export function channelListenerHealthLabel(
  ce: {
    channelHealthListening: string
    channelHealthPollOnly: string
    channelHealthStale: string
    invalidChannelIdentity: string
  },
  health: ChannelListenerHealth,
): string {
  switch (health) {
    case 'listening':
      return ce.channelHealthListening
    case 'poll_only':
      return ce.channelHealthPollOnly
    case 'invalid':
      return ce.invalidChannelIdentity
    default:
      return ce.channelHealthStale
  }
}
