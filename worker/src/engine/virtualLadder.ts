/**
 * Virtual ladder (Phase 4) - clean rebuild of the range/layering "averaging down"
 * engine, designed so the over-firing/duplicate-leg class of bug is impossible.
 *
 * Two guarantees:
 *  1. Decision is pure + capped: decideLadderFires() respects distance budget when
 *     anchor/step are provided, never exceeds the hard leg cap, respects a TP-touch
 *     freeze, and bounds fires-per-tick on legacy path. Fully unit-tested.
 *  2. Firing is strictly idempotent: claim (DB pending->claimed) -> fire (protected
 *     at send, deterministic comment) -> record. A leg fires exactly once; an
 *     ambiguous send is resolved by FxClient adopting the actually-opened order
 *     (never re-fired); a definitely-not-placed failure releases the claim for a
 *     later tick.
 */
import type { FxClient, MtPlatform } from './fxClient'
import { computeLayerFireBudget } from '../layerConcurrentFire'

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
  /** Fill anchor for distance-scaled burst (with stepPriceOffset). */
  anchor?: number
  /** One configured step in price units (e.g. 0.02 for 2 pips on gold). */
  stepPriceOffset?: number
  /** Legacy fixed cap when anchor/step not provided. */
  maxFiresPerTick?: number
}): LadderLeg[] {
  if (args.frozen) return []
  const capacity = Math.max(0, args.maxLegs - args.openLegCount)
  if (capacity <= 0) return []

  const stepOffset = args.stepPriceOffset ?? 0
  const anchor = args.anchor ?? 0
  if (stepOffset > 0 && Number.isFinite(anchor) && anchor > 0) {
    const budget = computeLayerFireBudget({
      isBuy: args.isBuy,
      anchor,
      bid: args.bid,
      ask: args.ask,
      stepPriceOffset: stepOffset,
    })
    if (budget <= 0) return []
    const sorted = [...args.legs].sort((a, b) => a.stepIdx - b.stepIdx)
    return sorted.filter(l => l.stepIdx >= 1 && l.stepIdx <= budget).slice(0, capacity)
  }

  // Legacy: trigger-crossing path with fixed per-tick cap.
  const px = args.isBuy ? args.ask : args.bid
  if (!Number.isFinite(px) || px <= 0) return []
  const crossed = args.legs.filter(l =>
    Number.isFinite(l.triggerPrice) && l.triggerPrice > 0
    && (args.isBuy ? px <= l.triggerPrice : px >= l.triggerPrice))
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
      failed++
    } else {
      await deps.release(leg.id).catch(() => {})
      failed++
    }
  }

  return { fired, skipped, failed }
}

