import { supabase } from './supabase'
import {
  EMPTY_TRADE_INTENT,
  formDraftFromIntent,
  intentFromFormDraft,
  looksLikeNonTradableCommentary,
  type ChannelExampleLabel,
  type SignalExampleFormDraft,
  type TradeIntent,
} from './tradeIntent'

export type { ChannelExampleLabel, SignalExampleFormDraft, TradeIntent }
export type ChannelSignalExampleLabel = ChannelExampleLabel
export {
  EMPTY_TRADE_INTENT,
  formDraftFromIntent,
  intentFromFormDraft,
  looksLikeNonTradableCommentary,
}

export type ChannelSignalExampleSource = 'auto' | 'manual'

export type ChannelSignalExampleRow = {
  id: string
  raw_message: string
  label: ChannelExampleLabel
  intent: TradeIntent
  sort_order: number
  source: ChannelSignalExampleSource
}

export type ParseCustomSignalExampleResult = {
  ok: boolean
  label: ChannelExampleLabel
  intent: TradeIntent
  rejected_reason: string | null
  error?: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  }
}

function coerceIntent(raw: unknown): TradeIntent {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_TRADE_INTENT }
  const j = raw as Record<string, unknown>
  const sideRaw = String(j.side ?? '').toUpperCase()
  const side = sideRaw === 'BUY' || sideRaw === 'SELL' ? sideRaw : null
  const kindRaw = String(j.kind ?? 'ignore').toLowerCase()
  const kind = (
    kindRaw === 'entry'
    || kindRaw === 'modify'
    || kindRaw === 'close'
    || kindRaw === 'breakeven'
    || kindRaw === 'partial_close'
    || kindRaw === 'ignore'
    || kindRaw === 'commentary'
  ) ? kindRaw : 'ignore'
  const entry = Array.isArray(j.entry)
    ? j.entry.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
    : []
  const tp = Array.isArray(j.tp)
    ? j.tp.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
    : []
  const slN = typeof j.sl === 'number' ? j.sl : Number(j.sl)
  return {
    kind,
    side,
    symbol: typeof j.symbol === 'string' && j.symbol.trim() ? j.symbol.trim() : null,
    entry,
    sl: Number.isFinite(slN) && slN > 0 ? slN : null,
    tp,
    sl_unit: String(j.sl_unit ?? '') === 'pips' ? 'pips' : 'price',
    tp_unit: String(j.tp_unit ?? '') === 'pips' ? 'pips' : 'price',
    flags: (j.flags && typeof j.flags === 'object' ? j.flags : {}) as TradeIntent['flags'],
    confidence: typeof j.confidence === 'number' && Number.isFinite(j.confidence) ? j.confidence : 0.85,
    detected_language: typeof j.detected_language === 'string' ? j.detected_language : undefined,
  }
}

function coerceLabel(raw: unknown): ChannelExampleLabel {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'update' || s === 'ignore') return s
  return 'entry'
}

export async function fetchChannelSignalExamples(
  channelId: string,
): Promise<ChannelSignalExampleRow[]> {
  const { data, error } = await supabase
    .from('channel_signal_examples')
    .select('id, raw_message, label, intent, sort_order, source')
    .eq('channel_id', channelId)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).flatMap(row => {
    if (typeof row.raw_message !== 'string') return []
    const label = coerceLabel(row.label)
    const source: ChannelSignalExampleSource =
      row.source === 'manual' ? 'manual' : 'auto'
    return [{
      id: String(row.id),
      raw_message: row.raw_message,
      label,
      intent: coerceIntent(row.intent),
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
      source,
    }]
  })
}

export async function parseCustomSignalExample(
  channelId: string,
  rawMessage: string,
  labelHint?: ChannelExampleLabel | null,
): Promise<ParseCustomSignalExampleResult> {
  const headers = await authHeaders()
  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/analyze-channel-profile`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'parse_signal_example',
        channel_id: channelId,
        raw_message: rawMessage,
        label_hint: labelHint ?? null,
      }),
    })
  } catch {
    throw new Error('Could not reach analyze-channel-profile. Deploy the edge function and try again.')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : text || `HTTP ${res.status}`
    throw new Error(msg)
  }

  const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return {
    ok: row.ok === true,
    label: coerceLabel(row.label),
    intent: coerceIntent(row.intent),
    rejected_reason: typeof row.rejected_reason === 'string' ? row.rejected_reason : null,
    error: typeof row.error === 'string' ? row.error : undefined,
  }
}

async function sha256Short(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

export async function saveChannelSignalExample(args: {
  channelId: string
  userId: string
  rawMessage: string
  label: ChannelExampleLabel
  intent: TradeIntent
  sortOrder?: number
  existingId?: string | null
}): Promise<ChannelSignalExampleRow> {
  const raw_message = args.rawMessage.trim()
  if (!raw_message) throw new Error('empty_message')
  if (args.label === 'ignore') throw new Error('cannot_save_ignore')
  if (looksLikeNonTradableCommentary(raw_message) && args.label === 'entry') {
    throw new Error('commentary_not_trade_signal')
  }

  const raw_message_hash = await sha256Short(raw_message)
  const payload = {
    user_id: args.userId,
    channel_id: args.channelId,
    raw_message,
    raw_message_hash,
    label: args.label,
    intent: args.intent,
    source: 'manual' as const,
    sort_order: args.sortOrder ?? 0,
    updated_at: new Date().toISOString(),
  }

  if (args.existingId) {
    const { data, error } = await supabase
      .from('channel_signal_examples')
      .update(payload)
      .eq('id', args.existingId)
      .eq('user_id', args.userId)
      .select('id, raw_message, label, intent, sort_order, source')
      .single()
    if (error) throw new Error(error.message)
    return {
      id: String(data.id),
      raw_message: data.raw_message,
      label: coerceLabel(data.label),
      intent: coerceIntent(data.intent),
      sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
      source: data.source === 'manual' ? 'manual' : 'auto',
    }
  }

  const { data, error } = await supabase
    .from('channel_signal_examples')
    .upsert(payload, { onConflict: 'channel_id,raw_message_hash' })
    .select('id, raw_message, label, intent, sort_order, source')
    .single()
  if (error) throw new Error(error.message)
  return {
    id: String(data.id),
    raw_message: data.raw_message,
    label: coerceLabel(data.label),
    intent: coerceIntent(data.intent),
    sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
    source: data.source === 'manual' ? 'manual' : 'auto',
  }
}

export async function updateChannelSignalExample(
  id: string,
  patch: {
    raw_message?: string
    label?: ChannelExampleLabel
    intent?: TradeIntent
    sort_order?: number
  },
): Promise<void> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    source: 'manual',
  }
  if (patch.raw_message != null) {
    updates.raw_message = patch.raw_message
    updates.raw_message_hash = await sha256Short(patch.raw_message)
  }
  if (patch.label != null) updates.label = patch.label
  if (patch.intent != null) updates.intent = patch.intent
  if (patch.sort_order != null) updates.sort_order = patch.sort_order

  const { error } = await supabase
    .from('channel_signal_examples')
    .update(updates)
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteChannelSignalExample(id: string): Promise<void> {
  const { error } = await supabase
    .from('channel_signal_examples')
    .delete()
    .eq('id', id)
  if (error) throw new Error(error.message)
}

function numList(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return values
    .map(v => (typeof v === 'number' ? v : Number(v)))
    .filter(n => Number.isFinite(n) && n > 0)
}

/** Compact one-line summary of parsed TradeIntent for the examples list. */
export function formatTradeIntentSummary(intent: Record<string, unknown> | TradeIntent): string | null {
  const kind = typeof intent.kind === 'string' ? intent.kind : null
  if (!kind || kind === 'ignore' || kind === 'commentary') return null

  const parts: string[] = []

  if (kind === 'modify') parts.push('Modify')
  else if (kind === 'close') parts.push('Close')
  else if (kind === 'breakeven') parts.push('Breakeven')
  else if (kind === 'partial_close') parts.push('Partial close')

  const side = typeof intent.side === 'string' ? intent.side : null
  if (side === 'BUY' || side === 'SELL') parts.push(side)

  const symbol = typeof intent.symbol === 'string' && intent.symbol.trim()
    ? intent.symbol.trim().toUpperCase()
    : null
  if (symbol) parts.push(symbol)

  const entry = numList(intent.entry)
  if (entry.length === 1) parts.push(`@${entry[0]}`)
  else if (entry.length >= 2) parts.push(`${entry[0]}-${entry[1]}`)

  const sl = typeof intent.sl === 'number' ? intent.sl : Number(intent.sl)
  if (Number.isFinite(sl) && sl > 0) parts.push(`SL ${sl}`)

  const tp = numList(intent.tp)
  if (tp.length > 0) parts.push(`TP ${tp.join(', ')}`)

  if (kind !== 'entry' && parts.length === 0) {
    const kindLabel = kind.replace(/_/g, ' ')
    return kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
