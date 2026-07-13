/** Keep in sync with worker/src/signalIntent/parsedDataToTradeIntent.ts */
import type { TradeIntent, TradeIntentKind, TradeIntentSide } from './tradeIntent.ts'

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

function actionToKindSide(action: string): { kind: TradeIntentKind; side: TradeIntentSide | null } {
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

function exampleLabel(parsed: ParsedLike): 'entry' | 'update' | 'ignore' {
  const action = String(parsed?.action ?? '').toLowerCase()
  if (action === 'buy' || action === 'sell') return 'entry'
  if (['modify', 'close', 'breakeven', 'partial_profit', 'close_worse_entries', 'partial_breakeven'].includes(action)) {
    return 'update'
  }
  return 'ignore'
}

export function buildChannelExampleRows(
  rows: Array<{ raw_message: string; parsed_data: unknown }>,
  limit = 12,
): Array<{ raw_message: string; label: 'entry' | 'update' | 'ignore'; intent: TradeIntent }> {
  const out: Array<{ raw_message: string; label: 'entry' | 'update' | 'ignore'; intent: TradeIntent }> = []
  const seen = new Set<string>()
  for (const row of rows) {
    const raw = String(row.raw_message ?? '').trim()
    if (!raw || raw.length < 12) continue
    const hash = raw.slice(0, 64)
    if (seen.has(hash)) continue
    const parsed = row.parsed_data && typeof row.parsed_data === 'object'
      ? row.parsed_data as ParsedLike
      : null
    if (!parsed) continue
    const label = exampleLabel(parsed)
    if (label === 'ignore') continue
    seen.add(hash)
    out.push({
      raw_message: raw,
      label,
      intent: parsedDataToTradeIntent(parsed),
    })
    if (out.length >= limit) break
  }
  return out
}
