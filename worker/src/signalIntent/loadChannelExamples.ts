import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import type { ChannelSignalExample, TradeIntent } from './tradeIntent'
import { coerceTradeIntent } from './coerceTradeIntent'

function messageHash(rawMessage: string): string {
  return createHash('sha256').update(rawMessage.trim()).digest('hex').slice(0, 32)
}

export async function loadChannelSignalExamples(
  supabase: SupabaseClient,
  channelRowId: string,
  limit = 12,
): Promise<ChannelSignalExample[]> {
  const { data, error } = await supabase
    .from('channel_signal_examples')
    .select('raw_message,label,intent')
    .eq('channel_id', channelRowId)
    .order('sort_order', { ascending: true })
    .limit(limit)

  if (error || !data?.length) return []

  return data.map(row => {
    const r = row as { raw_message?: string; label?: string; intent?: unknown }
    const labelRaw = String(r.label ?? 'entry').toLowerCase()
    const label = labelRaw === 'update' || labelRaw === 'ignore' ? labelRaw : 'entry'
    return {
      raw_message: String(r.raw_message ?? ''),
      label,
      intent: coerceTradeIntent(r.intent),
    } satisfies ChannelSignalExample
  })
}

export function formatExamplesForPrompt(examples: ChannelSignalExample[]): unknown[] {
  return examples.map(ex => ({
    raw_message: ex.raw_message,
    label: ex.label,
    intent: ex.intent,
  }))
}

export type StoredChannelExampleInput = {
  channelId: string
  userId: string
  rawMessage: string
  label: 'entry' | 'update' | 'ignore'
  intent: TradeIntent
  sortOrder?: number
}

export async function upsertChannelSignalExample(
  supabase: SupabaseClient,
  input: StoredChannelExampleInput,
): Promise<void> {
  await supabase.from('channel_signal_examples').upsert({
    channel_id: input.channelId,
    user_id: input.userId,
    raw_message: input.rawMessage,
    raw_message_hash: messageHash(input.rawMessage),
    label: input.label,
    intent: input.intent as unknown as Record<string, unknown>,
    sort_order: input.sortOrder ?? 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'channel_id,raw_message_hash' })
}
