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
      .eq('status', 'broker_pending')
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
    .update({ status: 'cancelled', error_message: reason })
    .eq('id', row.id)
    .eq('status', 'broker_pending')
  return true
}
