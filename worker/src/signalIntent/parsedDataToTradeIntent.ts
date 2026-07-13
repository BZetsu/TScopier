/** Keep in sync with supabase/functions/_shared/signalIntent/parsedDataToTradeIntent.ts */
import type { TradeIntent } from './tradeIntent'

type ParsedLike = {
  action?: unknown
  symbol?: unknown
  entry_price?: unknown
  entry_zone_low?: unknown
  entry_zone_high?: unknown
  sl?: unknown
  tp?: unknown
  confidence?: unknown
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function actionToKindSide(action: string): { kind: TradeIntent['kind']; side: TradeIntent['side'] } {
  switch (action) {
    case 'buy': return { kind: 'entry', side: 'BUY' }
    case 'sell': return { kind: 'entry', side: 'SELL' }
    case 'modify': return { kind: 'modify', side: null }
    case 'close':
    case 'close_worse_entries':
      return { kind: 'close', side: null }
    case 'breakeven':
    case 'partial_breakeven':
      return { kind: 'breakeven', side: null }
    case 'partial_profit':
      return { kind: 'partial_close', side: null }
    default:
      return { kind: 'ignore', side: null }
  }
}

export function parsedDataToTradeIntent(parsed: ParsedLike | null | undefined): TradeIntent {
  const action = String(parsed?.action ?? '').toLowerCase()
  const { kind, side } = actionToKindSide(action)
  const entry: number[] = []
  const ep = numOrNull(parsed?.entry_price)
  const lo = numOrNull(parsed?.entry_zone_low)
  const hi = numOrNull(parsed?.entry_zone_high)
  if (ep != null) entry.push(ep)
  else if (lo != null && hi != null) entry.push(Math.min(lo, hi), Math.max(lo, hi))

  const tp = Array.isArray(parsed?.tp)
    ? parsed!.tp.map(numOrNull).filter((n): n is number => n != null)
    : []

  const confidence = typeof parsed?.confidence === 'number' && Number.isFinite(parsed.confidence)
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.85

  return {
    kind,
    side,
    symbol: typeof parsed?.symbol === 'string' ? parsed.symbol : null,
    entry,
    sl: numOrNull(parsed?.sl),
    tp,
    sl_unit: 'price',
    tp_unit: 'price',
    flags: kind === 'entry' ? { re_enter: true } : {},
    confidence,
  }
}
