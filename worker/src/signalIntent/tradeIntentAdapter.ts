import type { ChannelParsedSignal } from '../parseSignal'
import type { TradeIntent } from './tradeIntent'

function mapKindToAction(intent: TradeIntent): string {
  switch (intent.kind) {
    case 'entry':
      if (intent.side === 'BUY') return 'buy'
      if (intent.side === 'SELL') return 'sell'
      return 'ignore'
    case 'modify':
      return 'modify'
    case 'close':
      return 'close'
    case 'breakeven':
      return 'breakeven'
    case 'partial_close':
      return 'partial_profit'
    case 'commentary':
    case 'ignore':
    default:
      return 'ignore'
  }
}

function entryFields(entry: number[]): {
  entry_price: number | null
  entry_zone_low: number | null
  entry_zone_high: number | null
} {
  if (!entry.length) {
    return { entry_price: null, entry_zone_low: null, entry_zone_high: null }
  }
  if (entry.length === 1) {
    return { entry_price: entry[0]!, entry_zone_low: null, entry_zone_high: null }
  }
  const lo = Math.min(...entry)
  const hi = Math.max(...entry)
  if (lo === hi) {
    return { entry_price: lo, entry_zone_low: null, entry_zone_high: null }
  }
  return { entry_price: null, entry_zone_low: lo, entry_zone_high: hi }
}

/** Map TradeIntent → legacy ChannelParsedSignal for the existing executor. */
export function tradeIntentToChannelParsedSignal(
  intent: TradeIntent,
  rawInstruction: string,
): ChannelParsedSignal {
  const action = mapKindToAction(intent)
  const entry = entryFields(intent.entry)
  const reEnter = intent.flags.re_enter === true
    || (intent.kind === 'entry' && (intent.side === 'BUY' || intent.side === 'SELL'))

  return {
    action,
    symbol: intent.symbol,
    ...entry,
    sl: intent.sl,
    tp: intent.tp,
    tp_unit: intent.tp_unit,
    sl_unit: intent.sl_unit,
    lot_size: null,
    confidence: intent.confidence,
    raw_instruction: rawInstruction,
    open_tp: intent.flags.open_tp === true,
    partial_close_fraction: intent.flags.partial_close_fraction ?? null,
    re_enter: reEnter || undefined,
  }
}

/** Attach raw intent for debugging (stored under parsed_data._intent). */
export function withStoredIntent(
  parsed: ChannelParsedSignal,
  intent: TradeIntent,
): ChannelParsedSignal & { _intent: TradeIntent } {
  return { ...parsed, _intent: intent }
}
