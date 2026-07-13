/** Language-independent trading intent extracted from any Telegram signal text. */
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
  /** Single price [3365] or zone [3360, 3365] (low, high). */
  entry: number[]
  sl: number | null
  tp: number[]
  sl_unit: TradeIntentPriceUnit
  tp_unit: TradeIntentPriceUnit
  flags: TradeIntentFlags
  confidence: number
  detected_language?: string
}

export type ChannelSignalExample = {
  raw_message: string
  label: 'entry' | 'update' | 'ignore'
  intent: TradeIntent
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
