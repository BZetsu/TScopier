/** Shared with Account Configuration UI — keep in sync with worker/src/channelMessageFilters.ts */

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

export const CHANNEL_FILTER_CATEGORY_KEYS: ChannelFilterKey[] = [
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
  CHANNEL_FILTER_CATEGORY_KEYS.map(k => [k, 'allow']),
) as ChannelFilters

/** Basic plan default — all instruction categories ignored until Advanced upgrade. */
export const BASIC_PLAN_CHANNEL_FILTERS: ChannelFilters = Object.fromEntries(
  CHANNEL_FILTER_CATEGORY_KEYS.map(k => [k, 'ignore']),
) as ChannelFilters

export function defaultChannelFiltersForPlan(keywordFiltersEnabled: boolean): ChannelFilters {
  return keywordFiltersEnabled
    ? { ...DEFAULT_CHANNEL_FILTERS }
    : { ...BASIC_PLAN_CHANNEL_FILTERS }
}

export function normalizeChannelFilters(raw: unknown): ChannelFilters {
  const base = { ...DEFAULT_CHANNEL_FILTERS }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  for (const key of CHANNEL_FILTER_CATEGORY_KEYS) {
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
