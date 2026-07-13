import { supabase } from './supabase'

export type ChannelSignalExampleLabel = 'entry' | 'update' | 'ignore'

export type ChannelSignalExampleRow = {
  id: string
  raw_message: string
  label: ChannelSignalExampleLabel
  intent: Record<string, unknown>
  sort_order: number
}

export async function fetchChannelSignalExamples(
  channelId: string,
): Promise<ChannelSignalExampleRow[]> {
  const { data, error } = await supabase
    .from('channel_signal_examples')
    .select('id, raw_message, label, intent, sort_order')
    .eq('channel_id', channelId)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).flatMap(row => {
    if (typeof row.raw_message !== 'string') return []
    const label = row.label
    if (label !== 'entry' && label !== 'update' && label !== 'ignore') return []
    return [{
      id: String(row.id),
      raw_message: row.raw_message,
      label,
      intent: row.intent && typeof row.intent === 'object'
        ? row.intent as Record<string, unknown>
        : {},
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    }]
  })
}

function numList(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return values
    .map(v => (typeof v === 'number' ? v : Number(v)))
    .filter(n => Number.isFinite(n))
}

/** Compact one-line summary of parsed TradeIntent for the examples list. */
export function formatTradeIntentSummary(intent: Record<string, unknown>): string | null {
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
  if (Number.isFinite(sl)) parts.push(`SL ${sl}`)

  const tp = numList(intent.tp)
  if (tp.length > 0) parts.push(`TP ${tp.join(', ')}`)

  if (kind !== 'entry' && parts.length === 0) {
    const kindLabel = kind.replace(/_/g, ' ')
    return kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
