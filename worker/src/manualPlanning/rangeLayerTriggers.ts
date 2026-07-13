import type { PlannerRangeLayering, VirtualPendingLeg } from './types'

/** Quadratic curve: sparse early progress toward boundary, dense rungs near zone edge. */
export const RANGE_LAYER_CURVE_EXPONENT = 2

function roundPrice(px: number, digits: number): number {
  const d = Math.max(0, Math.min(8, Math.floor(digits)))
  return Number(px.toFixed(d))
}

/** Far edge of the layering span (zone boundary or anchor ± configured distance). */
export function resolveRangeLayerBoundary(args: {
  isBuy: boolean
  anchor: number
  boundary?: number | null
  rangeDistancePips: number
  pip: number
}): number | null {
  const b = args.boundary
  if (b != null && Number.isFinite(b) && b > 0) return b
  const distPx = args.rangeDistancePips * args.pip
  if (!Number.isFinite(distPx) || distPx <= 0) return null
  if (!Number.isFinite(args.pip) || args.pip <= 0) return null
  return args.isBuy ? args.anchor - distPx : args.anchor + distPx
}

function rangeRungCount(
  rangeLayering: PlannerRangeLayering | null | undefined,
  virtualPendingCount: number,
): number {
  if (rangeLayering?.rangeLayeringType === 'pending_order') {
    return Math.max(1, rangeLayering.maxStepIdx)
  }
  return Math.max(0, virtualPendingCount)
}

function resolveLayerPip(
  rangeLayering: PlannerRangeLayering | null | undefined,
  pip?: number,
): number {
  if (pip != null && Number.isFinite(pip) && pip > 0) return pip
  const stepOffset = rangeLayering?.stepPriceOffset ?? 0
  const stepPips = rangeLayering?.effectiveStepPips ?? rangeLayering?.rangeStepPips ?? 0
  if (stepOffset > 0 && stepPips > 0) return stepOffset / stepPips
  return 0
}

/**
 * Non-linear ladder rungs from anchor toward boundary.
 * Rung 1 is always one configured step from the fill anchor; rungs 2..N curve toward the boundary.
 * Index 0 = stepIdx 1 (shallowest), last index = deepest (zone edge when pinned).
 */
export function computeRangeLayerTriggers(args: {
  isBuy: boolean
  rungCount: number
  anchor: number
  boundary: number
  stepPriceOffset: number
  digits: number
  pinLastToBoundary?: boolean
  exponent?: number
}): number[] {
  const {
    isBuy,
    rungCount,
    anchor,
    boundary,
    stepPriceOffset,
    digits,
    pinLastToBoundary = false,
    exponent = RANGE_LAYER_CURVE_EXPONENT,
  } = args

  if (rungCount <= 0 || !Number.isFinite(anchor) || anchor <= 0) return []
  if (!Number.isFinite(boundary)) return []

  const span = isBuy ? anchor - boundary : boundary - anchor
  if (!Number.isFinite(span) || span <= 0) return []

  const minSep = Math.max(0, stepPriceOffset)
  const firstRung = isBuy
    ? anchor - minSep
    : anchor + minSep
  const lastRung = pinLastToBoundary
    ? boundary
    : (isBuy ? anchor - span : anchor + span)

  const out: number[] = []
  let prev = anchor

  for (let stepIdx = 1; stepIdx <= rungCount; stepIdx++) {
    let trigger: number
    if (rungCount === 1) {
      trigger = pinLastToBoundary && Math.abs(lastRung - firstRung) >= minSep
        ? lastRung
        : firstRung
    } else if (stepIdx === 1) {
      trigger = firstRung
    } else if (stepIdx === rungCount) {
      trigger = lastRung
    } else {
      const t = (stepIdx - 1) / (rungCount - 1)
      const frac = Math.pow(t, exponent)
      trigger = isBuy
        ? firstRung - (firstRung - lastRung) * frac
        : firstRung + (lastRung - firstRung) * frac
    }
    trigger = roundPrice(trigger, digits)

    if (out.length > 0 && minSep > 0) {
      if (isBuy) {
        if (prev - trigger < minSep) trigger = roundPrice(prev - minSep, digits)
      } else if (trigger - prev < minSep) {
        trigger = roundPrice(prev + minSep, digits)
      }
    }

    if (isBuy) {
      if (trigger >= prev) trigger = roundPrice(prev - (minSep || span / rungCount / 10), digits)
      if (trigger < boundary) trigger = boundary
    } else {
      if (trigger <= prev) trigger = roundPrice(prev + (minSep || span / rungCount / 10), digits)
      if (trigger > boundary) trigger = boundary
    }

    out.push(trigger)
    prev = trigger
  }

  if (pinLastToBoundary && out.length > 0) {
    out[out.length - 1] = roundPrice(boundary, digits)
  }

  return out
}

export function buildRangeLayerTriggerMap(args: {
  virtualPendings: Array<Pick<VirtualPendingLeg, 'stepIdx' | 'stepPriceOffset' | 'isBuy'>>
  anchor: number
  digits: number
  rangeLayering?: PlannerRangeLayering | null
  pip?: number
}): Map<number, number> {
  const map = new Map<number, number>()
  if (args.virtualPendings.length === 0) return map

  const isBuy = args.virtualPendings[0]!.isBuy
  const stepPriceOffset = args.virtualPendings[0]!.stepPriceOffset
    || args.rangeLayering?.stepPriceOffset
    || 0
  const pip = resolveLayerPip(args.rangeLayering, args.pip)
  const rungCount = rangeRungCount(args.rangeLayering, args.virtualPendings.length)
  const distPips = args.rangeLayering?.effectiveDistancePips
    ?? args.rangeLayering?.rangeDistancePips
    ?? 0

  const boundary = resolveRangeLayerBoundary({
    isBuy,
    anchor: args.anchor,
    boundary: args.rangeLayering?.signalRangeBoundary ?? null,
    rangeDistancePips: distPips,
    pip,
  })

  if (boundary != null && rungCount > 0) {
    const triggers = computeRangeLayerTriggers({
      isBuy,
      rungCount,
      anchor: args.anchor,
      boundary,
      stepPriceOffset,
      digits: args.digits,
      pinLastToBoundary: args.rangeLayering?.useSignalEntryRange === true,
    })
    for (let stepIdx = 1; stepIdx <= triggers.length; stepIdx++) {
      const price = triggers[stepIdx - 1]
      if (price != null && Number.isFinite(price)) map.set(stepIdx, price)
    }
    return map
  }

  for (const v of args.virtualPendings) {
    const dir = v.isBuy ? -1 : 1
    map.set(v.stepIdx, roundPrice(args.anchor + dir * v.stepIdx * v.stepPriceOffset, args.digits))
  }
  return map
}

/** Resolve one rung price; falls back to linear `stepIdx × step` when boundary unknown. */
export function rangeLayerTriggerForStep(args: {
  stepIdx: number
  leg: Pick<VirtualPendingLeg, 'stepPriceOffset' | 'isBuy'>
  anchor: number
  digits: number
  legCount: number
  rangeLayering?: PlannerRangeLayering | null
  pip?: number
  triggerMap?: Map<number, number>
}): number {
  const fromMap = args.triggerMap?.get(args.stepIdx)
  if (fromMap != null && Number.isFinite(fromMap)) return fromMap

  const pip = resolveLayerPip(args.rangeLayering, args.pip)
  const boundary = resolveRangeLayerBoundary({
    isBuy: args.leg.isBuy,
    anchor: args.anchor,
    boundary: args.rangeLayering?.signalRangeBoundary ?? null,
    rangeDistancePips: args.rangeLayering?.effectiveDistancePips
      ?? args.rangeLayering?.rangeDistancePips
      ?? 0,
    pip,
  })

  const rungCount = args.rangeLayering?.rangeLayeringType === 'pending_order'
    ? Math.max(1, args.rangeLayering?.maxStepIdx ?? args.legCount)
    : args.legCount

  if (boundary != null && rungCount > 0 && args.stepIdx >= 1 && args.stepIdx <= rungCount) {
    const triggers = computeRangeLayerTriggers({
      isBuy: args.leg.isBuy,
      rungCount,
      anchor: args.anchor,
      boundary,
      stepPriceOffset: args.leg.stepPriceOffset,
      digits: args.digits,
      pinLastToBoundary: args.rangeLayering?.useSignalEntryRange === true,
    })
    const t = triggers[args.stepIdx - 1]
    if (t != null && Number.isFinite(t)) return t
  }

  const dir = args.leg.isBuy ? -1 : 1
  return roundPrice(args.anchor + dir * args.stepIdx * args.leg.stepPriceOffset, args.digits)
}
