/**
 * Close open trades / cancel pendings when the source channel message is deleted
 * and the channel config has `close_on_signal_deleted`.
 *
 * Listeners (Telegram / Discord / WhatsApp) call this; the trade worker performs
 * the broker closes via `/internal/force-close-trades`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { configuredInternalToken } from './internalToken'
import { pickTradeWorkerUrl } from './tradeSignalPush'

export type SignalDeletedSource =
  | 'telegram_live'
  | 'telegram_reconcile'
  | 'discord'
  | 'whatsapp'

export type SignalDeletedCloseResult = {
  signals: number
  requested: number
  skipped: number
  errors: number
}

async function findSignalsForDeletedMessage(
  supabase: SupabaseClient,
  args: {
    userId: string
    telegramMessageId: string
    channelRowId?: string | null
  },
): Promise<Array<{ id: string; channel_id: string | null }>> {
  const messageId = args.telegramMessageId.trim()
  if (!messageId || !args.userId.trim()) return []

  let query = supabase
    .from('signals')
    .select('id,channel_id')
    .eq('user_id', args.userId)
    .eq('telegram_message_id', messageId)
    .order('created_at', { ascending: false })
    .limit(20)

  const channelRowId = args.channelRowId?.trim()
  if (channelRowId) {
    query = query.eq('channel_id', channelRowId)
  }

  const { data, error } = await query
  if (error) {
    console.warn(
      `[signalDeletedClose] signal lookup failed user=${args.userId} message=${messageId}: ${error.message}`,
    )
    return []
  }
  return (data ?? []) as Array<{ id: string; channel_id: string | null }>
}

async function pushForceCloseForDeletedSignal(args: {
  userId: string
  signalId: string
  source: SignalDeletedSource
}): Promise<'ok' | 'skip' | 'error'> {
  const token = configuredInternalToken()
  const base = pickTradeWorkerUrl('close', args.userId)
  if (!token || !base) {
    console.warn(
      `[signalDeletedClose] TRADE_WORKER_URL / WORKER_INTERNAL_TOKEN missing`
      + ` — cannot close signal=${args.signalId} source=${args.source}`,
    )
    return 'error'
  }

  try {
    const res = await fetch(`${base}/internal/force-close-trades`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': token,
      },
      body: JSON.stringify({
        user_id: args.userId,
        signal_id: args.signalId,
        close_reason: 'signal_deleted',
      }),
      signal: AbortSignal.timeout(45_000),
    })
    const body = await res.json().catch(() => ({})) as {
      ok?: boolean
      reason?: string
      error?: string
      closed?: number
      pending_cancelled?: number
      virtual_legs_deleted?: number
    }
    if (!res.ok) {
      console.warn(
        `[signalDeletedClose] force-close HTTP ${res.status} signal=${args.signalId}`
        + ` detail=${String(body.error ?? body.reason ?? '').slice(0, 200)}`,
      )
      return 'error'
    }
    if (body.reason === 'setting_disabled' || body.reason === 'no_open_trades') {
      return 'skip'
    }
    console.log(
      `[signalDeletedClose] signal=${args.signalId} source=${args.source}`
      + ` closed=${body.closed ?? 0} pending_cancelled=${body.pending_cancelled ?? 0}`
      + ` virtual_deleted=${body.virtual_legs_deleted ?? 0} ok=${body.ok === true}`,
    )
    return body.ok === false ? 'error' : 'ok'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[signalDeletedClose] force-close failed signal=${args.signalId}: ${msg.slice(0, 200)}`,
    )
    return 'error'
  }
}

/**
 * Look up signals for a deleted channel message and ask the trade worker to
 * close/cancel on brokers that have `close_on_signal_deleted` enabled.
 */
export async function handleSignalMessageDeleted(
  supabase: SupabaseClient,
  args: {
    userId: string
    telegramMessageId: string
    channelRowId?: string | null
    source: SignalDeletedSource
  },
): Promise<SignalDeletedCloseResult> {
  const result: SignalDeletedCloseResult = {
    signals: 0,
    requested: 0,
    skipped: 0,
    errors: 0,
  }
  const signals = await findSignalsForDeletedMessage(supabase, args)
  result.signals = signals.length
  if (!signals.length) return result

  for (const signal of signals) {
    const outcome = await pushForceCloseForDeletedSignal({
      userId: args.userId,
      signalId: signal.id,
      source: args.source,
    })
    if (outcome === 'ok') result.requested += 1
    else if (outcome === 'skip') result.skipped += 1
    else result.errors += 1
  }
  return result
}

/** Fan-out for Discord: one deleted message may map to many UniCopier users. */
export async function handleDiscordMessageDeleted(
  supabase: SupabaseClient,
  args: {
    discordMessageId: string
    discordChannelId: string
  },
): Promise<SignalDeletedCloseResult> {
  const messageId = args.discordMessageId.trim()
  const discordChannelId = args.discordChannelId.trim()
  const empty: SignalDeletedCloseResult = { signals: 0, requested: 0, skipped: 0, errors: 0 }
  if (!messageId || !discordChannelId) return empty

  const { data: links, error } = await supabase
    .from('discord_channels')
    .select('user_id, channel_id')
    .eq('discord_channel_id', discordChannelId)
    .eq('is_active', true)
    .limit(200)
  if (error) {
    console.warn(`[signalDeletedClose] discord channel lookup failed: ${error.message}`)
    return empty
  }
  if (!links?.length) return empty

  const aggregate = { ...empty }
  for (const link of links as Array<{ user_id: string; channel_id: string }>) {
    const one = await handleSignalMessageDeleted(supabase, {
      userId: link.user_id,
      telegramMessageId: messageId,
      channelRowId: link.channel_id,
      source: 'discord',
    })
    aggregate.signals += one.signals
    aggregate.requested += one.requested
    aggregate.skipped += one.skipped
    aggregate.errors += one.errors
  }
  return aggregate
}
