/** Broker row fields used to decide whether a signal's channel may be copied. */
export type BrokerChannelFilterFields = {
  enforce_signal_channel_filter?: boolean | null
  signal_channel_ids?: string[] | null
}

export function normalizeSignalChannelIds(raw: string[] | null | undefined): string[] {
  if (!raw?.length) return []
  return raw.map(String).filter(Boolean)
}

/**
 * True when this broker should copy signals from `channelId`.
 * Whitelist applies when enforcement is on or when channel ids were persisted
 * (Configure Trading modal checkboxes).
 */
export function channelMatchesBrokerSignal(
  broker: BrokerChannelFilterFields,
  channelId: string | null,
): boolean {
  const ids = normalizeSignalChannelIds(broker.signal_channel_ids)
  const enforce = broker.enforce_signal_channel_filter === true
  const useWhitelist = enforce || ids.length > 0
  if (!useWhitelist) return true
  if (!channelId) return false
  if (ids.length === 0) return false
  return ids.includes(channelId)
}
