/**
 * AI-lane entry guard: reject a parsed entry when the live market has moved
 * adversarially past the signal entry price/zone beyond the broker's pip
 * tolerance. Entering a worse price than the signal published is a loss risk.
 */

export const ENTRY_PRICE_MOVED_ADVERSE_REASON = 'entry_price_moved_adverse'

function positive(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function parsePipSize(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0.00001
}

/**
 * True when the reference quote is beyond the entry (or zone edge) on the
 * adverse side by more than tolerancePips × pipSize.
 *
 * Buy:  adverse = ask above entry/zone (paying more than the signal).
 * Sell: adverse = bid below entry/zone (receiving less than the signal).
 * A price that moved in favor of the trade is never blocked.
 */
export function entryPriceMovedAdverse(args: {
  action: 'buy' | 'sell'
  entryPrice: number | null
  zoneLow: number | null
  zoneHigh: number | null
  bid: number
  ask: number
  tolerancePips: number
  pipSize?: number | null
}): boolean {
  const { action, bid, ask } = args
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return false

  const entry = positive(args.entryPrice)
  const lo = positive(args.zoneLow)
  const hi = positive(args.zoneHigh)
  if (entry == null && (lo == null || hi == null)) return false

  const tolerance = Math.max(0, Number(args.tolerancePips)) * parsePipSize(args.pipSize)

  if (action === 'buy') {
    const cap = entry != null ? entry : hi!
    return ask > cap + tolerance
  }
  const floor = entry != null ? entry : lo!
  return bid < floor - tolerance
}
