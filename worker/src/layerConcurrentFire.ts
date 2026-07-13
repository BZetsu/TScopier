/** Distance-scaled concurrent virtual layer firing (pure helpers). */

export type LayerBurstLeg = {
  id: string
  step_idx: number
  anchor_price: number
  trigger_price: number
  is_buy: boolean
}

/** Adverse move from fill anchor in price units (0 when price has not moved adversely). */
export function adverseDistanceFromAnchor(
  isBuy: boolean,
  anchor: number,
  bid: number,
  ask: number,
): number {
  if (!Number.isFinite(anchor) || anchor <= 0) return 0
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return 0
  if (isBuy) return Math.max(0, anchor - bid)
  return Math.max(0, ask - anchor)
}

/** Derive one-step price offset from materialized pending rows in a basket. */
export function stepPriceOffsetForBasket(
  legs: Array<Pick<LayerBurstLeg, 'step_idx' | 'anchor_price' | 'trigger_price' | 'is_buy'>>,
): number | null {
  if (!legs.length) return null

  const isBuy = legs[0]!.is_buy
  let best: number | null = null

  for (const leg of legs) {
    const anchor = Number(leg.anchor_price)
    const trigger = Number(leg.trigger_price)
    const stepIdx = Number(leg.step_idx)
    if (!Number.isFinite(anchor) || anchor <= 0) continue
    if (!Number.isFinite(trigger) || trigger <= 0) continue
    if (!Number.isFinite(stepIdx) || stepIdx <= 0) continue

    const span = isBuy ? anchor - trigger : trigger - anchor
    if (!Number.isFinite(span) || span <= 0) continue
    const offset = span / stepIdx
    if (!Number.isFinite(offset) || offset <= 0) continue
    const rounded = Number(offset.toFixed(8))
    if (best == null || rounded < best) best = rounded
  }

  return best
}

/** Floor distance/step with tolerance for broker price rounding. */
export function rungsFromAdverseDistance(dist: number, stepPriceOffset: number): number {
  const offset = Math.max(0, stepPriceOffset)
  if (offset <= 0 || dist <= 0) return 0
  const raw = dist / offset
  const nearest = Math.round(raw)
  if (Math.abs(raw - nearest) < 1e-6) return Math.max(0, nearest)
  return Math.max(0, Math.floor(raw + 1e-9))
}

/**
 * How many ladder rungs may fire from cumulative adverse distance alone.
 * Returns 0 when step offset is unknown or distance is below one step.
 */
export function computeLayerFireBudget(args: {
  isBuy: boolean
  anchor: number
  bid: number
  ask: number
  stepPriceOffset: number
  /** @deprecated Legacy: forces budget 1 when distance < one step. Distance path omits this. */
  anyTriggered?: boolean
}): number {
  const offset = Math.max(0, args.stepPriceOffset)
  if (offset <= 0) return args.anyTriggered ? 1 : 0

  const dist = adverseDistanceFromAnchor(args.isBuy, args.anchor, args.bid, args.ask)
  const fromDist = rungsFromAdverseDistance(dist, offset)
  if (fromDist >= 1) return fromDist
  return args.anyTriggered ? 1 : 0
}

/** True when adverse distance from anchor reaches this rung (step N needs dist >= N × step). */
export function isLegEligibleByDistance(
  isBuy: boolean,
  anchor: number,
  bid: number,
  ask: number,
  stepIdx: number,
  stepPriceOffset: number,
): boolean {
  if (!Number.isFinite(stepIdx) || stepIdx < 1) return false
  const offset = Math.max(0, stepPriceOffset)
  if (offset <= 0) return false
  const budget = rungsFromAdverseDistance(
    adverseDistanceFromAnchor(isBuy, anchor, bid, ask),
    offset,
  )
  return budget >= stepIdx
}

/** Pending legs whose step_idx fits the distance budget (shallowest first). */
export function selectPendingLegsForDistanceBurst<T extends LayerBurstLeg>(args: {
  pendingLegs: T[]
  budget: number
  /** Exclude rungs at or below this step (already fired). */
  highestFiredStepIdx?: number
}): T[] {
  const budget = Math.max(0, Math.floor(args.budget))
  const minStep = Math.max(0, Math.floor(args.highestFiredStepIdx ?? 0))
  if (budget <= 0 || args.pendingLegs.length === 0) return []

  return args.pendingLegs
    .filter(leg => leg.step_idx >= 1 && leg.step_idx > minStep && leg.step_idx <= budget)
    .sort((a, b) => a.step_idx - b.step_idx || a.id.localeCompare(b.id))
}

/** Steps in (highestFiredStepIdx, budget] — convenience for per-tick new layers. */
export function newLayersForTick(budget: number, highestFiredStepIdx: number): number[] {
  const lo = Math.max(0, Math.floor(highestFiredStepIdx))
  const hi = Math.max(0, Math.floor(budget))
  if (hi <= lo) return []
  const out: number[] = []
  for (let s = lo + 1; s <= hi; s++) out.push(s)
  return out
}

/** @deprecated Use selectPendingLegsForDistanceBurst — kept for callers passing pre-filtered triggered legs. */
export function selectLegsForDistanceBurst<T extends LayerBurstLeg>(args: {
  triggeredLegs: T[]
  budget: number
}): T[] {
  return selectPendingLegsForDistanceBurst({ pendingLegs: args.triggeredLegs, budget: args.budget })
}

/** Market fill allowed for distance burst: distance-qualified and not worse than slippage above rung. */
export function isDistanceBurstFillAllowed(args: {
  isBuy: boolean
  anchor: number
  bid: number
  ask: number
  stepIdx: number
  stepPriceOffset: number
  triggerPrice: number
  slippagePoints: number
  point: number | null
}): { ok: boolean; reason?: string } {
  if (!isLegEligibleByDistance(
    args.isBuy,
    args.anchor,
    args.bid,
    args.ask,
    args.stepIdx,
    args.stepPriceOffset,
  )) {
    return { ok: false, reason: 'distance_not_eligible' }
  }

  const { isBuy, triggerPrice, bid, ask, slippagePoints, point } = args
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    return { ok: false, reason: 'invalid_trigger' }
  }
  if (point == null || !(point > 0)) return { ok: true }

  const tol = Math.max(2, Math.max(0, slippagePoints)) * point
  const fillSide = isBuy ? ask : bid
  if (isBuy) {
    if (fillSide > triggerPrice + tol) return { ok: false, reason: 'fill_outside_trigger_band' }
  } else if (fillSide < triggerPrice - tol) {
    return { ok: false, reason: 'fill_outside_trigger_band' }
  }
  return { ok: true }
}
