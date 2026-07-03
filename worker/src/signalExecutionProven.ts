/**
 * Durable proof that a signal was materialized on at least one broker.
 * Excludes transient range_pending_legs (race-prone on live-fast path).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { EXECUTION_LOG_ACTIONS_HANDLED } from './tradeExecutor/types'

export async function signalExecutionProven(
  supabase: SupabaseClient,
  signalId: string,
): Promise<boolean> {
  const [trades, waits, logs] = await Promise.all([
    supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('signal_id', signalId),
    supabase
      .from('signal_range_entry_waits')
      .select('id', { count: 'exact', head: true })
      .eq('signal_id', signalId)
      .eq('status', 'waiting'),
    supabase
      .from('trade_execution_logs')
      .select('id', { count: 'exact', head: true })
      .eq('signal_id', signalId)
      .eq('status', 'success')
      .in('action', [...EXECUTION_LOG_ACTIONS_HANDLED]),
  ])
  return (
    (trades.count ?? 0) > 0
    || (waits.count ?? 0) > 0
    || (logs.count ?? 0) > 0
  )
}
