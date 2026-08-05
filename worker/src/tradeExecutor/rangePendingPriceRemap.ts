import { validateBrokerPendingPrice } from './layeringModeBrokerPending'

export type RangePendingCandidate = {
  stepIdx: number
  price: number
}

/**
 * Order ladder rungs shallow → deep (adverse direction).
 * Buy: highest price first (closest below market). Sell: lowest first.
 */
export function orderRangePendingCandidates(
  entries: Array<{ stepIdx: number; price: number }>,
  isBuy: boolean,
): RangePendingCandidate[] {
  const sorted = entries
    .filter(e => Number.isFinite(e.stepIdx) && Number.isFinite(e.price) && e.price > 0)
    .map(e => ({ stepIdx: Math.floor(e.stepIdx), price: e.price }))
  sorted.sort((a, b) => (isBuy ? b.price - a.price : a.price - b.price))
  return sorted
}

/** Broker rejected the limit price itself (not SL/TP stops). */
export function isBrokerPendingLimitPriceRejectMessage(msg: string): boolean {
  const m = String(msg ?? '').toLowerCase()
  if (/invalid\s+stops/.test(m)) return false
  return (
    /invalid\s+price/.test(m)
    || /price.*invalid/.test(m)
    || /off\s*quotes/.test(m)
    || /too\s+close/.test(m)
    || /min(?:imum)?\s+distance/.test(m)
    || /not\s+enough\s+distance/.test(m)
    || /invalid\s+request/.test(m)
  )
}

/**
 * Next unused candidate that clears broker min-distance / side rules.
 * Callers should mark `reasonSkipped` steps as exhausted so they are not retried
 * and can be persisted as cancelled footprints.
 */
export function nextValidRangePendingPrice(args: {
  candidates: readonly RangePendingCandidate[]
  usedOrExhaustedStepIdxs: ReadonlySet<number>
  side: 'buy' | 'sell'
  bid: number
  ask: number
  point: number
  stopsLevel: number
  freezeLevel: number
}): {
  candidate: RangePendingCandidate | null
  reasonSkipped: Array<{ stepIdx: number; price: number; reason: string }>
} {
  const reasonSkipped: Array<{ stepIdx: number; price: number; reason: string }> = []
  for (const c of args.candidates) {
    if (args.usedOrExhaustedStepIdxs.has(c.stepIdx)) continue
    const reason = validateBrokerPendingPrice({
      side: args.side,
      price: c.price,
      bid: args.bid,
      ask: args.ask,
      point: args.point,
      stopsLevel: args.stopsLevel,
      freezeLevel: args.freezeLevel,
    })
    if (reason == null) {
      return { candidate: c, reasonSkipped }
    }
    reasonSkipped.push({ stepIdx: c.stepIdx, price: c.price, reason })
  }
  return { candidate: null, reasonSkipped }
}
