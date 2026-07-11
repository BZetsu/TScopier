import type { SupabaseClient } from '@supabase/supabase-js'
import type { FxsocketBrokerClient } from './fxsocketClient'

export type RangeBrokerPendingRow = {
  id: string
  signal_id: string
  user_id: string
  broker_account_id: string
  metaapi_account_id: string
  symbol: string
  step_idx: number
  is_buy: boolean
  volume: number
  trigger_price: number
  stoploss: number | null
  takeprofit: number | null
  slippage: number | null
  comment: string | null
  expert_id: number | null
  ticket: string | null
  expires_at: string | null
  cwe_close_price?: number | null
}

export async function cancelBrokerRangeLegAtBroker(
  supabase: SupabaseClient,
  api: FxsocketBrokerClient,
  row: Pick<RangeBrokerPendingRow, 'id' | 'metaapi_account_id' | 'ticket' | 'signal_id' | 'user_id' | 'broker_account_id'>,
  reason: string,
): Promise<boolean> {
  const ticket = Number(row.ticket)
  if (!Number.isFinite(ticket) || ticket <= 0) {
    await supabase
      .from('range_pending_legs')
      .update({ status: 'cancelled', error_message: reason })
      .eq('id', row.id)
      .in('status', ['broker_pending', 'cancelled'])
    return true
  }
  try {
    await api.orderClose(row.metaapi_account_id, { ticket })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[rangeBrokerPending] OrderClose failed leg=${row.id} signal=${row.signal_id} ticket=${ticket}: ${msg}`,
    )
    return false
  }
  await supabase
    .from('range_pending_legs')
    .update({ status: 'cancelled', error_message: reason, ticket: null })
    .eq('id', row.id)
    .in('status', ['broker_pending', 'cancelled'])
  return true
}

/** Close broker limits for rows marked cancelled by DB trigger before row cleanup. */
export async function reconcileBasketEmptyCancelledLegs(
  supabase: SupabaseClient,
  apiLookup: (uuid: string) => FxsocketBrokerClient | null,
): Promise<number> {
  const { data, error } = await supabase
    .from('range_pending_legs')
    .select('id,metaapi_account_id,ticket,signal_id,user_id,broker_account_id')
    .eq('status', 'cancelled')
    .eq('error_message', 'basket_empty')
    .not('ticket', 'is', null)
    .limit(100)
  if (error || !data?.length) return 0
  let closed = 0
  for (const row of data as RangeBrokerPendingRow[]) {
    const api = apiLookup(row.metaapi_account_id)
    if (!api) continue
    const ok = await cancelBrokerRangeLegAtBroker(supabase, api, row, 'basket_empty')
    if (ok) closed += 1
  }
  return closed
}
