/**
 * Per-channel management filters stored on broker_accounts.channel_message_filters.
 */

export type ChannelFilterKey =
  | 'close_full'
  | 'close_half'
  | 'break_even'
  | 'modify_sl'
  | 'modify_tp'
  | 'close_tp_levels'
  | 'close_all'
  | 'close_worse_entries'
  | 'delete_pendings'
  | 'reverse'

export type ChannelFilterDecision = 'allow' | 'ignore'

export type ChannelFilters = Record<ChannelFilterKey, ChannelFilterDecision>

export type ChannelMessageFiltersMap = Record<string, Partial<ChannelFilters>>

const ALL_KEYS: ChannelFilterKey[] = [
  'close_full',
  'close_half',
  'break_even',
  'modify_sl',
  'modify_tp',
  'close_tp_levels',
  'close_all',
  'close_worse_entries',
  'delete_pendings',
  'reverse',
]

export const DEFAULT_CHANNEL_FILTERS: ChannelFilters = Object.fromEntries(
  ALL_KEYS.map(k => [k, 'allow']),
) as ChannelFilters

export function normalizeChannelFilters(raw: unknown): ChannelFilters {
  const base = { ...DEFAULT_CHANNEL_FILTERS }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  for (const key of ALL_KEYS) {
    const v = o[key]
    if (v === 'ignore' || v === 'allow') base[key] = v
  }
  return base
}

export function normalizeChannelMessageFiltersMap(raw: unknown): ChannelMessageFiltersMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ChannelMessageFiltersMap = {}
  for (const [channelId, filters] of Object.entries(raw as Record<string, unknown>)) {
    if (!channelId.trim()) continue
    out[channelId] = normalizeChannelFilters(filters)
  }
  return out
}

export interface ManagementFilterContext {
  hasNewSl?: boolean
  hasNewTp?: boolean
}

/** Parsed management `action` → filter categories that must all be allowed. */
export function filterKeysForManagementAction(
  action: string,
  ctx: ManagementFilterContext = {},
): ChannelFilterKey[] {
  const a = String(action ?? '').toLowerCase()
  switch (a) {
    case 'close':
      // Ignoring "Close full position" blocks every full-close variant from the channel.
      return ['close_full', 'close_all']
    case 'close_worse_entries':
      return ['close_worse_entries']
    case 'partial_profit':
      return ['close_half', 'close_tp_levels']
    case 'partial_breakeven':
      return ['close_half', 'break_even']
    case 'breakeven':
      return ['break_even']
    case 'modify': {
      const keys: ChannelFilterKey[] = []
      if (ctx.hasNewSl) keys.push('modify_sl')
      if (ctx.hasNewTp) keys.push('modify_tp')
      if (keys.length === 0) keys.push('modify_sl', 'modify_tp')
      return keys
    }
    default:
      return []
  }
}

/** Categories used when closing opposite-direction legs on a new entry signal. */
export function filterKeysForOppositeSignalClose(): ChannelFilterKey[] {
  return ['close_full', 'close_all']
}

/** Pending cancellation tied to a full close from the channel. */
export function filterKeysForPendingCancel(): ChannelFilterKey[] {
  return ['delete_pendings', 'close_full', 'close_all']
}

export function isCategoryIgnored(
  filters: ChannelMessageFiltersMap | null | undefined,
  channelId: string | null | undefined,
  key: ChannelFilterKey,
): boolean {
  if (!channelId) return false
  const ch = filters?.[channelId]
  if (!ch) return false
  return (ch[key] ?? 'allow') === 'ignore'
}

/**
 * True when ANY relevant category for this action is set to ignore for the channel.
 */
export function isChannelManagementBlocked(
  filters: ChannelMessageFiltersMap | null | undefined,
  channelId: string | null | undefined,
  action: string,
  ctx: ManagementFilterContext = {},
): boolean {
  const keys = filterKeysForManagementAction(action, ctx)
  if (!keys.length) return false
  return keys.some(k => isCategoryIgnored(filters, channelId, k))
}

export function isOppositeSignalCloseBlocked(
  filters: ChannelMessageFiltersMap | null | undefined,
  channelId: string | null | undefined,
): boolean {
  return filterKeysForOppositeSignalClose().some(k => isCategoryIgnored(filters, channelId, k))
}

export function isPendingCancelBlocked(
  filters: ChannelMessageFiltersMap | null | undefined,
  channelId: string | null | undefined,
): boolean {
  return filterKeysForPendingCancel().some(k => isCategoryIgnored(filters, channelId, k))
}
