/**
 * Reconcile DB `trades.status = 'open'` against live broker positions.
 * Closes rows whose ticket no longer appears in /OpenedOrders (TP/SL/manual close).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxsocketBrokerClient } from './fxsocketClient'
import { closeStaleOpenTrades, fetchOpenBrokerTicketsStrict } from './basketSlTpReconcile'
import { purgeRangePendingLegsForBaskets, type BasketScope } from './rangePendingLegDelete'

export type OpenTradeReconcileRow = {
  id: string
  signal_id?: string | null
  broker_account_id: string | null
  metaapi_order_id: string | null
}

/** Open DB legs whose ticket is valid but absent from the broker snapshot. */
export function findGhostOpenTradeIds(
  openTrades: OpenTradeReconcileRow[],
  brokerTickets: Set<number>,
): string[] {
  const ghostIds: string[] = []
  for (const trade of openTrades) {
    const ticket = Number(trade.metaapi_order_id)
    if (!Number.isFinite(ticket) || ticket <= 0) continue
    if (!brokerTickets.has(ticket)) ghostIds.push(trade.id)
  }
  return ghostIds
}

function basketScopesForGhosts(openTrades: OpenTradeReconcileRow[], ghostIds: string[]): BasketScope[] {
  const ghostSet = new Set(ghostIds)
  const scopes = new Map<string, BasketScope>()
  for (const trade of openTrades) {
    if (!ghostSet.has(trade.id)) continue
    const signalId = trade.signal_id
    const brokerAccountId = trade.broker_account_id
    if (!signalId || !brokerAccountId) continue
    scopes.set(`${signalId}|${brokerAccountId}`, { signalId, brokerAccountId })
  }
  return [...scopes.values()]
}

export async function reconcileOpenTradesForBroker(
  supabase: SupabaseClient,
  api: FxsocketBrokerClient,
  metaapiAccountId: string,
  openTrades: OpenTradeReconcileRow[],
): Promise<number> {
  if (!openTrades.length) return 0
  const brokerTickets = await fetchOpenBrokerTicketsStrict(api, metaapiAccountId)
  // SAFETY: an empty (but successful) OpenedOrders snapshot usually means the
  // FxSocket session is disconnected — never mass-mark every open row closed.
  if (brokerTickets.size === 0 && openTrades.length > 0) {
    console.warn(
      `[openTradeReconcile] empty OpenedOrders with ${openTrades.length} tracked open trade(s)`
      + ` account=${metaapiAccountId} — deferring ghost close (suspected disconnect)`,
    )
    return 0
  }
  const ghostIds = findGhostOpenTradeIds(openTrades, brokerTickets)
  if (!ghostIds.length) return 0
  const closed = await closeStaleOpenTrades(supabase, ghostIds)
  if (closed > 0) {
    const scopes = basketScopesForGhosts(openTrades, ghostIds)
    if (scopes.length) {
      await purgeRangePendingLegsForBaskets(supabase, scopes, 'basket_flat_reconcile')
    }
  }
  return closed
}
