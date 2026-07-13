/** Frontend TradeIntent helpers (mirrors worker/src/signalIntent/tradeIntent.ts). */

export type TradeIntentKind =
  | 'entry'
  | 'modify'
  | 'close'
  | 'breakeven'
  | 'partial_close'
  | 'ignore'
  | 'commentary'

export type TradeIntentSide = 'BUY' | 'SELL'

export type TradeIntentPriceUnit = 'price' | 'pips'

export type TradeIntentFlags = {
  market_now?: boolean
  re_enter?: boolean
  open_tp?: boolean
  partial_close_fraction?: number
}

export type TradeIntent = {
  kind: TradeIntentKind
  side: TradeIntentSide | null
  symbol: string | null
  entry: number[]
  sl: number | null
  tp: number[]
  sl_unit: TradeIntentPriceUnit
  tp_unit: TradeIntentPriceUnit
  flags: TradeIntentFlags
  confidence: number
  detected_language?: string
}

export type ChannelExampleLabel = 'entry' | 'update' | 'ignore'

export type SignalExampleFormDraft = {
  rawMessage: string
  signalType: 'auto' | 'entry' | 'update'
  side: 'BUY' | 'SELL' | 'NONE'
  symbol: string
  entryPrice: string
  entryZoneLow: string
  entryZoneHigh: string
  sl: string
  tpLevels: string[]
  updateKind: 'modify' | 'close' | 'breakeven' | 'partial_close'
}

export const EMPTY_TRADE_INTENT: TradeIntent = {
  kind: 'ignore',
  side: null,
  symbol: null,
  entry: [],
  sl: null,
  tp: [],
  sl_unit: 'price',
  tp_unit: 'price',
  flags: {},
  confidence: 0,
}

export function emptySignalExampleFormDraft(): SignalExampleFormDraft {
  return {
    rawMessage: '',
    signalType: 'auto',
    side: 'NONE',
    symbol: '',
    entryPrice: '',
    entryZoneLow: '',
    entryZoneHigh: '',
    sl: '',
    tpLevels: [''],
    updateKind: 'modify',
  }
}

function numOrNull(v: string): number | null {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

export function labelFromIntent(intent: TradeIntent): ChannelExampleLabel {
  if (intent.kind === 'entry') return 'entry'
  if (
    intent.kind === 'modify'
    || intent.kind === 'close'
    || intent.kind === 'breakeven'
    || intent.kind === 'partial_close'
  ) {
    return 'update'
  }
  return 'ignore'
}

export function formDraftFromIntent(
  rawMessage: string,
  label: ChannelExampleLabel,
  intent: TradeIntent,
): SignalExampleFormDraft {
  const entry = Array.isArray(intent.entry) ? intent.entry.filter(n => Number.isFinite(n) && n > 0) : []
  const tp = Array.isArray(intent.tp) ? intent.tp.filter(n => Number.isFinite(n) && n > 0) : []
  const signalType: SignalExampleFormDraft['signalType'] =
    label === 'entry' ? 'entry' : label === 'update' ? 'update' : 'auto'
  let updateKind: SignalExampleFormDraft['updateKind'] = 'modify'
  if (intent.kind === 'close') updateKind = 'close'
  else if (intent.kind === 'breakeven') updateKind = 'breakeven'
  else if (intent.kind === 'partial_close') updateKind = 'partial_close'

  return {
    rawMessage,
    signalType,
    side: intent.side === 'BUY' || intent.side === 'SELL' ? intent.side : 'NONE',
    symbol: typeof intent.symbol === 'string' ? intent.symbol : '',
    entryPrice: entry.length === 1 ? String(entry[0]) : '',
    entryZoneLow: entry.length >= 2 ? String(Math.min(entry[0]!, entry[1]!)) : '',
    entryZoneHigh: entry.length >= 2 ? String(Math.max(entry[0]!, entry[1]!)) : '',
    sl: intent.sl != null && intent.sl > 0 ? String(intent.sl) : '',
    tpLevels: tp.length > 0 ? tp.map(String) : [''],
    updateKind,
  }
}

export function intentFromFormDraft(draft: SignalExampleFormDraft): {
  label: ChannelExampleLabel
  intent: TradeIntent
  error: string | null
} {
  const raw = draft.rawMessage.trim()
  if (!raw) {
    return { label: 'ignore', intent: EMPTY_TRADE_INTENT, error: 'empty_message' }
  }

  const signalType = draft.signalType === 'auto'
    ? (draft.side === 'BUY' || draft.side === 'SELL' ? 'entry' : 'update')
    : draft.signalType

  const entrySingle = numOrNull(draft.entryPrice)
  const zoneLow = numOrNull(draft.entryZoneLow)
  const zoneHigh = numOrNull(draft.entryZoneHigh)
  const entry: number[] = []
  if (entrySingle != null) entry.push(entrySingle)
  else if (zoneLow != null && zoneHigh != null) {
    entry.push(Math.min(zoneLow, zoneHigh), Math.max(zoneLow, zoneHigh))
  }

  const sl = numOrNull(draft.sl)
  const tp = draft.tpLevels
    .map(s => numOrNull(s))
    .filter((n): n is number => n != null)

  const side = draft.side === 'BUY' || draft.side === 'SELL' ? draft.side : null
  const symbol = draft.symbol.trim() ? draft.symbol.trim().toUpperCase() : null

  if (signalType === 'entry') {
    if (!side) {
      return { label: 'entry', intent: EMPTY_TRADE_INTENT, error: 'entry_missing_side' }
    }
    if (entry.length === 0 && sl == null && tp.length === 0) {
      return { label: 'entry', intent: EMPTY_TRADE_INTENT, error: 'entry_missing_prices' }
    }
    return {
      label: 'entry',
      intent: {
        kind: 'entry',
        side,
        symbol,
        entry,
        sl,
        tp,
        sl_unit: 'price',
        tp_unit: 'price',
        flags: { re_enter: true },
        confidence: 0.95,
      },
      error: null,
    }
  }

  const kind = draft.updateKind
  return {
    label: 'update',
    intent: {
      kind,
      side,
      symbol,
      entry,
      sl,
      tp,
      sl_unit: 'price',
      tp_unit: 'price',
      flags: {},
      confidence: 0.95,
    },
    error: null,
  }
}

/** Lightweight client-side past-tense celebration / commentary guard. */
export function looksLikeNonTradableCommentary(message: string): boolean {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return true

  if (/\b(?:sl|tp|stop\s+loss|take\s+profit)\s*[:=\-]/i.test(text)) return false
  if (/\b(?:buy|sell)\s+now\b/i.test(text)) return false
  if (/\b(?:buy|sell)\s+(?:at\s+)?@\s*\d/i.test(text)) return false

  if (/\b(?:buy|sell|long|short)\s+we\s+took\b/i.test(text)) return true
  if (/\bwe\s+took\s+(?:the\s+)?(?:a\s+)?(?:buy|sell|long|short)\b/i.test(text)) return true
  if (/\b(?:gold|xau(?:usd)?)\s+(?:buy|sell)\s+we\s+took\b/i.test(text)) return true
  if (/\b(?:excited|pumped|thrilled|such a|banger|crushed it)\b/i.test(text)
    && /\b(?:buy|sell|gold|xau)\b/i.test(text)) {
    return true
  }
  if (/\b(?:tp\s*\d*|take\s*profit)\s*(?:hit|reached|done)\b/i.test(text)) return true

  return false
}
