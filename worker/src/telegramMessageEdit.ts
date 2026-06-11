/**
 * Telegram message edit → re-parse existing signal → SL/TP refresh dispatch.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { parsedHasSlOrTp } from './multiTradeMerge'
import type { ParseChannelMessageResult } from './parseSignal'
import type { PipelineTimestamps } from './pipelineTimestamps'
import type { SignalRow } from './tradeExecutor'
import { messageTextChanged } from './telegramMessageEditSweep'

export const MESSAGE_EDIT_DISPATCH_SOURCE = 'message_edit'

export type ExistingSignalRow = {
  id: string
  user_id: string
  channel_id: string | null
  raw_message: string
  parsed_data: SignalRow['parsed_data']
  status: string
  parent_signal_id: string | null
  is_modification: boolean
  telegram_message_id: string | null
  reply_to_message_id: string | null
  created_at: string
}

export async function loadSignalByTelegramMessage(
  supabase: SupabaseClient,
  args: { userId: string; channelRowId: string; telegramMessageId: string },
): Promise<ExistingSignalRow | null> {
  const { data, error } = await supabase
    .from('signals')
    .select(
      'id,user_id,channel_id,raw_message,parsed_data,status,parent_signal_id,is_modification,telegram_message_id,reply_to_message_id,created_at',
    )
    .eq('user_id', args.userId)
    .eq('channel_id', args.channelRowId)
    .eq('telegram_message_id', args.telegramMessageId)
    .maybeSingle()
  if (error || !data) return null
  return data as ExistingSignalRow
}

export function buildMessageEditDispatchRow(
  existing: ExistingSignalRow,
  parseResult: ParseChannelMessageResult,
  rawMessage: string,
  pipelineTs?: PipelineTimestamps,
): SignalRow {
  return {
    id: existing.id,
    user_id: existing.user_id,
    channel_id: existing.channel_id,
    parsed_data: parseResult.parsed as SignalRow['parsed_data'],
    status: 'parsed',
    parent_signal_id: existing.parent_signal_id,
    is_modification: existing.is_modification,
    telegram_message_id: existing.telegram_message_id,
    reply_to_message_id: existing.reply_to_message_id,
    created_at: existing.created_at,
    pipeline_ts: pipelineTs,
  }
}

export async function updateSignalAfterTelegramEdit(
  supabase: SupabaseClient,
  args: {
    signalId: string
    rawMessage: string
    parseResult: ParseChannelMessageResult
    telegramMessageEditDate?: number | null
  },
): Promise<boolean> {
  const editedAt = new Date().toISOString()
  const patch: Record<string, unknown> = {
    raw_message: args.rawMessage,
    parsed_data: args.parseResult.parsed,
    status: 'parsed',
    skip_reason: null,
    telegram_message_edited_at: editedAt,
  }
  if (args.telegramMessageEditDate != null && args.telegramMessageEditDate > 0) {
    patch.telegram_message_edit_date = Math.floor(args.telegramMessageEditDate)
  }
  const { error } = await supabase
    .from('signals')
    .update(patch)
    .eq('id', args.signalId)
  return !error
}

export function normalizedTradeAction(action: unknown): 'buy' | 'sell' | null {
  const a = String(action ?? '').toLowerCase()
  if (a === 'buy' || a === 'sell') return a
  return null
}

export function messageEditDirectionFlipped(
  existing: ExistingSignalRow,
  parseResult: ParseChannelMessageResult,
): boolean {
  return messageEditDirectionFlippedFromActions(
    existing.parsed_data?.action,
    parseResult.parsed?.action,
  )
}

export function messageEditDirectionFlippedFromActions(
  priorAction: unknown,
  nextAction: unknown,
): boolean {
  const oldA = normalizedTradeAction(priorAction)
  const newA = normalizedTradeAction(nextAction)
  if (!oldA || !newA) return false
  return oldA !== newA
}

export function storedMessageDiffersFromTelegram(stored: string, fetched: string): boolean {
  return messageTextChanged(stored, fetched)
}

export function messageEditParseEligible(parseResult: ParseChannelMessageResult): boolean {
  if (parseResult.status !== 'parsed') return false
  return parsedHasSlOrTp(parseResult.parsed)
}
