/** Position side from entry vs SL/TP geometry (buy: SL below, TP above entry). */
export function inferDirectionFromStopPrices(
  entry: number | null | undefined,
  sl: number | null | undefined,
  tp: number | null | undefined,
): 'buy' | 'sell' | '' {
  if (entry == null || !Number.isFinite(entry) || entry <= 0) return ''
  let buyVotes = 0
  let sellVotes = 0
  if (sl != null && Number.isFinite(sl) && sl > 0) {
    if (sl < entry) buyVotes++
    else if (sl > entry) sellVotes++
  }
  if (tp != null && Number.isFinite(tp) && tp > 0) {
    if (tp > entry) buyVotes++
    else if (tp < entry) sellVotes++
  }
  if (buyVotes > sellVotes) return 'buy'
  if (sellVotes > buyVotes) return 'sell'
  return ''
}

export function directionDisplayLabel(direction: 'buy' | 'sell' | ''): string {
  if (direction === 'buy') return 'Buy'
  if (direction === 'sell') return 'Sell'
  return '—'
}

/** Prefer SL/TP geometry when deal-level type disagrees (e.g. OUT sell deal on buy position). */
export function resolveTradeDisplayDirection(input: {
  direction?: string
  entry_price?: number | null
  sl?: number | null
  tp?: number | null
}): 'buy' | 'sell' | '' {
  const fromPrices = inferDirectionFromStopPrices(input.entry_price, input.sl, input.tp)
  const raw = String(input.direction ?? '').toLowerCase()
  const fromField = (() => {
    if (raw === 'buy' || raw === 'long' || raw.startsWith('buy_')) return 'buy'
    if (raw === 'sell' || raw === 'short' || raw.startsWith('sell_')) return 'sell'
    return ''
  })()
  if (fromPrices && fromField && fromPrices !== fromField) return fromPrices
  return fromField || fromPrices
}
