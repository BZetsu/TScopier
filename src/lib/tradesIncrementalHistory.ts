import type { MtTrade } from './fxsocketBroker'
import { BROKER_FULL_HISTORY_FROM } from './tradesConstants'
import { formatBrokerHistoryDate, parseMtHistoryTimestamp } from './mtApiDateTime'

/** Re-read a day around the newest cached close so late broker writes are not missed. */
export const TRADES_INCREMENTAL_BUFFER_MS = 24 * 60 * 60 * 1000

/** Never request more than this on a normal refresh, even for a dormant account. */
export const TRADES_MAX_INCREMENTAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Re-read the full broker history once a day to drop deleted or corrected old rows. */
export const TRADES_FULL_HISTORY_REFRESH_MS = 24 * 60 * 60 * 1000

/**
 * After a degraded period, at least this much time must pass since the last
 * full read before recovery triggers another one. Bounds a flapping feed to at
 * most one full read per hour instead of one per recovery.
 */
export const TRADES_RECOVERY_FULL_MIN_INTERVAL_MS = 60 * 60 * 1000

export type HistoryReadMode = 'full' | 'incremental'

/**
 * Whether this refresh requests the full broker history or the recent window.
 *
 * - Degraded feed: **always incremental**, checked before the cache check. A
 *   tab with no session cache (opened during an outage, or whose cache aged
 *   past the 24 h peek window) must not fall through to a full read — failures
 *   never write the cache, so `hasCache` stays false for the whole outage and
 *   the full-read-every-refresh loop would continue exactly as it did in the
 *   2026-11-25 incident (`docs/mtapi-vps-details.md` §6). Cached rows are
 *   retained by `mergeIncrementalTrades`, so a partial response cannot make
 *   trades disappear; a cacheless tab shows the recent window plus its
 *   open orders (open orders are returned regardless of the date range).
 * - No cache on a healthy feed: nothing to build an incremental window from
 *   and no outage to protect the bridge from — full (cold start).
 * - Recovery from degraded: one full read to self-heal, bounded to at most
 *   one per `TRADES_RECOVERY_FULL_MIN_INTERVAL_MS` so a flapping feed cannot
 *   turn it back into a stampede.
 * - Otherwise the daily full refresh, then incremental.
 */
export function resolveHistoryReadMode(args: {
  hasCache: boolean
  degraded: boolean
  recoveredFromDegraded: boolean
  now: number
  fullHistoryAt: number
}): HistoryReadMode {
  const { hasCache, degraded, recoveredFromDegraded, now, fullHistoryAt } = args
  if (degraded) return 'incremental'
  if (!hasCache) return 'full'
  if (now - fullHistoryAt >= TRADES_FULL_HISTORY_REFRESH_MS) return 'full'
  if (
    recoveredFromDegraded &&
    now - fullHistoryAt >= TRADES_RECOVERY_FULL_MIN_INTERVAL_MS
  ) {
    return 'full'
  }
  return 'incremental'
}

/**
 * The `historyFrom` bound and merge base for a chosen read mode.
 *
 * - full → the full-history start date, no merge base (the read is complete).
 * - incremental with a cache → recent window anchored on the cached rows,
 *   merged with them so a partial response cannot drop trades.
 * - incremental without a cache (degraded, cacheless tab) → recent window
 *   anchored at yesterday and no merge base: open orders come back regardless
 *   of the date range, and a full read here would restart the every-refresh
 *   full-read loop (failures never write the cache, so the cacheless state
 *   persists for the whole outage).
 */
export function resolveHistoryWindow(args: {
  readMode: HistoryReadMode
  cacheTrades: readonly MtTrade[] | null
  now: number
}): { historyFrom: string; incrementalCache: readonly MtTrade[] | null } {
  const { readMode, cacheTrades, now } = args
  if (readMode === 'full') return { historyFrom: BROKER_FULL_HISTORY_FROM, incrementalCache: null }
  if (cacheTrades) {
    return { historyFrom: incrementalHistoryFrom(cacheTrades, now), incrementalCache: cacheTrades }
  }
  return { historyFrom: incrementalHistoryFrom([], now), incrementalCache: null }
}

/**
 * The `fullHistoryAt` marker to persist after a read.
 *
 * Only an actual full read advances it to `fetchedAt`. An incremental read
 * with a cache preserves the previous marker; an incremental read without a
 * cache records 0 ("no full read yet") so the next healthy load takes the
 * full branch — stamping `fetchedAt` there would claim a full read that never
 * happened and suppress both the daily refresh and the post-recovery self-heal.
 */
export function nextFullHistoryAt(args: {
  readMode: HistoryReadMode
  hasIncrementalCache: boolean
  previousMarker: number
  fetchedAt: number
}): number {
  const { readMode, hasIncrementalCache, previousMarker, fetchedAt } = args
  if (readMode === 'full') return fetchedAt
  return hasIncrementalCache ? previousMarker : 0
}

function tradeDisplayMs(trade: MtTrade): number {
  const raw = trade.status === 'closed'
    ? (trade.closed_at ?? trade.opened_at)
    : trade.opened_at
  return parseMtHistoryTimestamp(raw) ?? 0
}

function compareNewestFirst(a: MtTrade, b: MtTrade): number {
  return tradeDisplayMs(b) - tradeDisplayMs(a)
}

/**
 * First day to request for an incremental refresh.
 *
 * The cutoff is the newest cached close minus a one-day buffer, clamped to the
 * last seven days. The clamp matters for dormant accounts: without it, a
 * months-old close would make every refresh re-read months of history. When
 * the cache has no closed trades, start from yesterday: open orders are
 * returned by the broker regardless of the closed-history range.
 */
export function incrementalHistoryFrom(
  trades: readonly MtTrade[],
  now = Date.now(),
  bufferMs = TRADES_INCREMENTAL_BUFFER_MS,
  maxWindowMs = TRADES_MAX_INCREMENTAL_WINDOW_MS,
): string {
  let newestClose = 0
  for (const trade of trades) {
    if (trade.status !== 'closed') continue
    const ms = parseMtHistoryTimestamp(trade.closed_at ?? trade.opened_at)
    if (ms != null && ms > newestClose) newestClose = ms
  }
  const anchor = newestClose > 0 ? newestClose : now
  const from = Math.min(Math.max(anchor - bufferMs, now - maxWindowMs), now)
  return formatBrokerHistoryDate(new Date(from))
}

/**
 * Merge a recent-window live read with cached closed trades.
 *
 * Live rows win by `id`. Cached closed rows missing from the live read are
 * kept so a partial bridge response cannot make trades disappear; the daily
 * full refresh is what removes genuinely deleted rows. Cached open rows are
 * not merged: the live read is the authority for the current open set, and a
 * partial provider response is already surfaced by the degraded-feed banner.
 * When `accountIds` is supplied, rows for accounts that are no longer linked
 * are dropped.
 */
export function mergeIncrementalTrades(
  live: readonly MtTrade[],
  cached: readonly MtTrade[],
  accountIds?: ReadonlySet<string>,
): MtTrade[] {
  const byId = new Map<string, MtTrade>()

  for (const trade of live) {
    if (accountIds && !accountIds.has(trade.broker_id)) continue
    byId.set(trade.id, trade)
  }

  for (const trade of cached) {
    if (trade.status !== 'closed') continue
    if (accountIds && !accountIds.has(trade.broker_id)) continue
    if (!byId.has(trade.id)) byId.set(trade.id, trade)
  }

  return [...byId.values()].sort(compareNewestFirst)
}
