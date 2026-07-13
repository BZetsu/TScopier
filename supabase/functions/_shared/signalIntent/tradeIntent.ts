/** Keep in sync with worker/src/signalIntent/tradeIntent.ts */
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
