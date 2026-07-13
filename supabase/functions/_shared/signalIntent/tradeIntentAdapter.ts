/** Keep in sync with worker/src/signalIntent/tradeIntentAdapter.ts */
import type { TradeIntent } from './tradeIntent.ts'

export type EdgeParsedSignal = {
  action: string
  symbol: string | null
  entry_price: number | null
  entry_zone_low: number | null
  entry_zone_high: number | null
  sl: number | null
  tp: number[]
  tp_unit?: 'price' | 'pips'
  sl_unit?: 'price' | 'pips'
  lot_size: number | null
  confidence: number
  raw_instruction: string
  open_tp?: boolean
  partial_close_fraction?: number | null
  re_enter?: boolean
}

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

export function tradeIntentToParsedSignal(intent: TradeIntent, rawInstruction: string): EdgeParsedSignal {
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
