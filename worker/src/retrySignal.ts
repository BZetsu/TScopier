/**
 * Re-dispatch failed/skipped entry signals from Copier Logs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ENTRY_ZONE_FAR_FROM_MARKET_REASON } from './signalEntryZoneSanity'
import { loadSignalById } from './signalRevision'
import { isEntryAction } from './tradeSignalActions'
import type { TradeExecutor } from './tradeExecutor/TradeExecutor'
import type { SignalRow } from './tradeExecutor/types'
import { SKIP_REASON_ENTRY_NOT_OPENED } from './manualPlanner'

export const SIGNAL_RETRY_DISPATCH_SOURCE = 'signal_retry'

export const RETRYABLE_SIGNAL_SKIP_REASONS = new Set([
  SKIP_REASON_ENTRY_NOT_OPENED,
  ENTRY_ZONE_FAR_FROM_MARKET_REASON,
  'broker_session_not_connected',
  'entry_zone_far_from_market',
])

export type RetrySignalResult = {
  ok: boolean
  accepted?: boolean
  reason?: string
}

async function resetSignalForRetry(
  supabase: SupabaseClient,
  args: { userId: string; signalId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('signals')
    .update({ status: 'parsed', skip_reason: null })
    .eq('id', args.signalId)
    .eq('user_id', args.userId)
    .in('status', ['executed', 'skipped', 'failed', 'pending'])
    .select('id')
  if (error) {
    console.warn(`[retrySignal] signal reset failed id=${args.signalId}: ${error.message}`)
    return false
  }
  return (data?.length ?? 0) > 0
}

function toDispatchRow(signal: NonNullable<Awaited<ReturnType<typeof loadSignalById>>>): SignalRow {
  return {
    id: signal.id,
    user_id: signal.user_id,
    channel_id: signal.channel_id,
    parsed_data: signal.parsed_data,
    status: 'parsed',
    parent_signal_id: signal.parent_signal_id,
    is_modification: signal.is_modification,
    telegram_message_id: signal.telegram_message_id,
    reply_to_message_id: signal.reply_to_message_id,
    created_at: signal.created_at,
    user_override: signal.user_override,
  }
}

function isRetryableSignal(signal: {
  status: string
  skip_reason: string | null
  parsed_data: { action?: string } | null
}): boolean {
  const action = String(signal.parsed_data?.action ?? '').toLowerCase()
  if (!isEntryAction(action)) return false
  const status = String(signal.status).toLowerCase()
  if (status === 'failed') return true
  if (status !== 'skipped') return false
  const reason = String(signal.skip_reason ?? '').trim().toLowerCase()
  if (!reason) return false
  return RETRYABLE_SIGNAL_SKIP_REASONS.has(reason)
}

export async function retrySignal(
  executor: TradeExecutor,
  args: { userId: string; signalId: string },
): Promise<RetrySignalResult> {
  const supabase = executor.supabase
  const existing = await loadSignalById(supabase, args.signalId)
  if (!existing || existing.user_id !== args.userId) {
    return { ok: false, reason: 'signal_not_found' }
  }
  if (!isRetryableSignal(existing)) {
    return { ok: false, reason: 'signal_not_retryable' }
  }

  if (existing.status !== 'parsed') {
    const reset = await resetSignalForRetry(supabase, { userId: args.userId, signalId: args.signalId })
    if (!reset) {
      return { ok: false, reason: 'signal_not_retryable' }
    }
  }

  try {
    await supabase.from('trade_execution_logs').insert({
      user_id: args.userId,
      signal_id: args.signalId,
      action: 'signal_retry',
      status: 'success',
      request_payload: { source: SIGNAL_RETRY_DISPATCH_SOURCE },
    })
  } catch { /* best-effort */ }

  const fresh = await loadSignalById(supabase, args.signalId)
  if (!fresh?.parsed_data?.action) {
    return { ok: false, reason: 'signal_not_found' }
  }

  const accepted = await executor.acceptDispatchSignalAwait(toDispatchRow(fresh), {
    source: SIGNAL_RETRY_DISPATCH_SOURCE,
    priority: 'high',
  })
  if (!accepted) {
    return { ok: false, accepted: false, reason: 'dispatch_not_accepted' }
  }
  return { ok: true, accepted: true }
}
