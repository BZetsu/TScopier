import type { TelegramChannel } from '../types/database'
import { hasValidTelegramChannelIdentity } from './telegramChannelIdentity'

export type ChannelListenerHealth = 'invalid' | 'listening' | 'poll_only' | 'stale'

const LISTENING_MS = 2 * 60_000
const POLL_ONLY_MS = 30 * 60_000

export function getChannelListenerHealth(channel: TelegramChannel): ChannelListenerHealth {
  if (!hasValidTelegramChannelIdentity(channel)) return 'invalid'
  if (!channel.is_active) return 'stale'

  const now = Date.now()
  const liveAt = channel.last_live_at ? new Date(channel.last_live_at).getTime() : null
  const seenAt = channel.last_seen_at ? new Date(channel.last_seen_at).getTime() : null

  if (liveAt != null && now - liveAt <= LISTENING_MS) return 'listening'

  const activityAt = Math.max(liveAt ?? 0, seenAt ?? 0)
  if (activityAt === 0) return 'stale'
  const ageMs = now - activityAt
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
