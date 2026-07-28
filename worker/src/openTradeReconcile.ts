/**
 * Reconcile DB `trades.status = 'open'` against live broker positions.
 * Closes rows whose ticket no longer appears in /OpenedOrders (TP/SL/manual close).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxsocketBrokerClient } from './fxsocketClient'
import { closeStaleOpenTrades, fetchOpenBrokerTicketsStrict } from './basketSlTpReconcile'

export type OpenTradeReconcileRow = {
  id: string
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
  return closeStaleOpenTrades(supabase, ghostIds)
}
