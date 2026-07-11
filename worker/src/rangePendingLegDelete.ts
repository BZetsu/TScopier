/**
 * Delete active `range_pending_legs` when a signal basket is flat.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { clearTpTouchedLock } from './rangePendingFireGuard'
import { hasFxsocketConfigured } from './fxsocketClient'
import { apiForFxsocketAccount, loadPlatformByFxsocketId } from './mtApiByAccount'
import { cancelBrokerRangeLegAtBroker, type RangeBrokerPendingRow } from './rangeBrokerPendingHelpers'

export type BasketScope = {
  signalId: string
  brokerAccountId: string
}

async function cancelBrokerPendingLegsForScope(
  supabase: SupabaseClient,
  scope: BasketScope,
  reason: string,
): Promise<number> {
  if (!hasFxsocketConfigured()) return 0
  const { data, error } = await supabase
    .from('range_pending_legs')
    .select('id,signal_id,user_id,broker_account_id,metaapi_account_id,ticket')
    .eq('signal_id', scope.signalId)
    .eq('broker_account_id', scope.brokerAccountId)
    .eq('status', 'broker_pending')
  if (error || !data?.length) return 0

  const platform = await loadPlatformByFxsocketId(
    supabase,
    (data as RangeBrokerPendingRow[]).map(r => r.metaapi_account_id),
  )
  let cancelled = 0
  for (const row of data as RangeBrokerPendingRow[]) {
    const api = apiForFxsocketAccount(platform, row.metaapi_account_id)
    if (!api) continue
    const ok = await cancelBrokerRangeLegAtBroker(supabase, api, row, reason)
    if (ok) cancelled += 1
  }
  return cancelled
}

/** Delete all active virtual / broker ladder rows for a basket (any symbol spelling). */
export async function deleteRangePendingLegsForBasket(
  supabase: SupabaseClient,
  scope: BasketScope,
  reason: string,
): Promise<number> {
  await cancelBrokerPendingLegsForScope(supabase, scope, reason)

  const { data, error } = await supabase
    .from('range_pending_legs')
    .delete()
    .eq('signal_id', scope.signalId)
    .eq('broker_account_id', scope.brokerAccountId)
    .in('status', ['pending', 'claimed', 'broker_pending'])
    .select('id')
  if (error) {
    console.warn(
      `[rangePendingLegDelete] delete failed signal=${scope.signalId} broker=${scope.brokerAccountId}: ${error.message}`,
    )
    return 0
  }
  const n = (data ?? []).length
  if (n > 0) {
    console.log(
      `[rangePendingLegDelete] deleted ${n} range_pending_legs signal=${scope.signalId} broker=${scope.brokerAccountId} reason=${reason}`,
    )
  }
  return n
}

/** Delete pending/claimed legs when no open/pending trades remain in DB for the basket. */
export async function purgeRangePendingLegsIfBasketFlat(
  supabase: SupabaseClient,
  scope: BasketScope,
  reason: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('trades')
    .select('id', { count: 'exact', head: true })
    .eq('signal_id', scope.signalId)
    .eq('broker_account_id', scope.brokerAccountId)
    .in('status', ['open', 'pending'])
  if (error) {
    console.warn(`[rangePendingLegDelete] flat-check failed signal=${scope.signalId}: ${error.message}`)
    return 0
  }
  if ((count ?? 0) > 0) return 0
  const deleted = await deleteRangePendingLegsForBasket(supabase, scope, reason)
  if (deleted > 0) {
    await clearTpTouchedLock(supabase, scope)
  }
  return deleted
}

export async function purgeRangePendingLegsForBaskets(
  supabase: SupabaseClient,
  scopes: Iterable<BasketScope>,
  reason: string,
): Promise<number> {
  const uniq = new Map<string, BasketScope>()
  for (const s of scopes) {
    uniq.set(`${s.signalId}|${s.brokerAccountId}`, s)
  }
  let total = 0
  for (const scope of uniq.values()) {
    total += await purgeRangePendingLegsIfBasketFlat(supabase, scope, reason)
  }
  return total
}
