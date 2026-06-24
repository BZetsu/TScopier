/**
 * Virtual ladder (Phase 4) - clean rebuild of the range/layering "averaging down"
 * engine, designed so the over-firing/duplicate-leg class of bug is impossible.
 *
 * Two guarantees:
 *  1. Decision is pure + capped: decideLadderFires() only returns legs whose trigger
 *     the live price has crossed, never exceeds the hard leg cap, respects a TP-touch
 *     freeze, and bounds fires-per-tick. Fully unit-tested.
 *  2. Firing is strictly idempotent: claim (DB pending->claimed) -> fire (protected
 *     at send, deterministic comment) -> record. A leg fires exactly once; an
 *     ambiguous send is resolved by FxClient adopting the actually-opened order
 *     (never re-fired); a definitely-not-placed failure releases the claim for a
 *     later tick.
 */
import type { FxClient, MtPlatform } from './fxClient'

export type LadderLeg = {
  id: string
  stepIdx: number
  triggerPrice: number
  volume: number
}

export function decideLadderFires(args: {
  /** Pending legs only (not claimed/fired). */
  legs: LadderLeg[]
  bid: number
  ask: number
  isBuy: boolean
  /** Open legs already in this basket (for the hard cap). */
  openLegCount: number
  /** Hard maximum total legs for the basket. */
  maxLegs: number
  /** True once any TP has been touched - stop adding to the basket. */
  frozen: boolean
  /** Cap fires per tick to avoid bursting the terminal (default 3). */
  maxFiresPerTick?: number
}): LadderLeg[] {
  if (args.frozen) return []
  const capacity = Math.max(0, args.maxLegs - args.openLegCount)
  if (capacity <= 0) return []
  // Fill side: a buy averages down -> fills at ask; a sell averages up -> fills at bid.
  const px = args.isBuy ? args.ask : args.bid
  if (!Number.isFinite(px) || px <= 0) return []
  const crossed = args.legs.filter(l =>
    Number.isFinite(l.triggerPrice) && l.triggerPrice > 0
    && (args.isBuy ? px <= l.triggerPrice : px >= l.triggerPrice))
  // Shallowest rungs first (closest trigger), so we fill the ladder in order.
  crossed.sort((a, b) => a.stepIdx - b.stepIdx)
  const limit = Math.min(capacity, args.maxFiresPerTick ?? 3)
  return crossed.slice(0, limit)
}

export type FireLadderDeps = {
  fx: FxClient
  accountId: string
  platform: MtPlatform
  brokerSymbol: string
  isBuy: boolean
  anchorSignalId: string
  /** Desired SL/TP applied to each fired leg (protected at send). */
  desiredStopLoss: number | null
  desiredTakeProfit: number | null
  /** Atomically claim a pending leg (pending -> claimed). Returns false if already claimed. */
  claim: (legId: string) => Promise<boolean>
  /** Mark a claimed leg fired and record the resulting trade. */
  onFired: (legId: string, ticket: number, price: number | null, volume: number) => Promise<void>
  /** Release a claim back to pending (only for definitely-not-placed failures). */
  release: (legId: string) => Promise<void>
  /** Pre-fire OpenedOrders snapshot for ambiguous-send adoption. */
  preSnapshot: import('./fxContract').FxOpenOrder[]
}

export type FireResult = { fired: number; skipped: number; failed: number }

/** Fire the decided legs idempotently through the strict client. */
export async function fireLadderLegs(deps: FireLadderDeps, legs: LadderLeg[]): Promise<FireResult> {
  let fired = 0
  let skipped = 0
  let failed = 0

  for (const leg of legs) {
    const claimed = await deps.claim(leg.id).catch(() => false)
    if (!claimed) { skipped++; continue }

    const result = await deps.fx.orderSend(
      deps.accountId,
      deps.platform,
      {
        symbol: deps.brokerSymbol,
        operation: deps.isBuy ? 'Buy' : 'Sell',
        volume: leg.volume,
        stopLoss: deps.desiredStopLoss ?? undefined,
        takeProfit: deps.desiredTakeProfit ?? undefined,
      },
      { anchorSignalId: deps.anchorSignalId, legIndex: leg.stepIdx, preSnapshot: deps.preSnapshot },
    )

    if (result.ok && result.ticket) {
      await deps.onFired(leg.id, result.ticket, result.price, result.volume ?? leg.volume).catch(() => {})
      fired++
    } else if (result.retcodeName === 'AMBIGUOUS') {
      // Could not confirm; do NOT re-fire and do NOT release (avoid duplicate). Leave
      // claimed - the reconciler's orphan adoption will reconcile if it did open.
      failed++
    } else {
      // Definitely not placed -> safe to release for a later tick.
      await deps.release(leg.id).catch(() => {})
      failed++
    }
  }

  return { fired, skipped, failed }
}
