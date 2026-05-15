/**
 * Close-worse-entries helpers.
 *
 * Auto (cweCloseMonitor): when market reaches anchor ± X pips, tagged immediates
 * (+ optional shallow layers) are closed via a fixed threshold on each row.
 *
 * Telegram (`close_worse_entries` management): at instruction time, close every
 * open basket leg whose entry is within X pips of the live quote.
 */

export function isEntryWithinPipsOfReference(
  entryPrice: number,
  referencePrice: number,
  pips: number,
  pipSize: number,
): boolean {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return false
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return false
  if (!Number.isFinite(pips) || pips <= 0) return false
  if (!Number.isFinite(pipSize) || pipSize <= 0) return false
  const band = pips * pipSize
  return Math.abs(referencePrice - entryPrice) <= band + 1e-12
}

/** Quote side used to measure distance to entry (bid for longs, ask for shorts). */
export function referencePriceForDirection(
  direction: 'buy' | 'sell' | string,
  bid: number,
  ask: number,
): number {
  const isBuy = String(direction).toLowerCase() === 'buy'
  return isBuy ? bid : ask
}

export interface OpenTradeForCweClose {
  id: string
  broker_account_id: string
  metaapi_order_id: string | null
  symbol: string
  direction: string
  lot_size: number
  entry_price: number | null
  status: string
}

export function filterTradesWithinPipsOfReference(args: {
  trades: OpenTradeForCweClose[]
  referencePrice: number
  pips: number
  pipSize: number
}): OpenTradeForCweClose[] {
  const { trades, referencePrice, pips, pipSize } = args
  return trades.filter(t => {
    if (t.status !== 'open') return false
    const entry = t.entry_price
    if (entry == null || !Number.isFinite(entry) || entry <= 0) return false
    return isEntryWithinPipsOfReference(entry, referencePrice, pips, pipSize)
  })
}
