/** Never pack Auto layers tighter than this many pips (avoids micro-step floods). */
export const MIN_AUTO_RANGE_STEP_PIPS = 1

/**
 * Resolve layering step in pips.
 *
 * - Manual: stepPips > 0 → use as-is (caller may still distance-cap legs).
 * - Auto (stepPips ≤ 0 or forceAuto): space reserved legs evenly across distance,
 *   but never below {@link MIN_AUTO_RANGE_STEP_PIPS}. When reserved would force a
 *   tighter step, `fittedLegs` is reduced so spacing stays ≥ the minimum.
 */
export function resolveRangeLayerStepPips(args: {
  stepPips: number
  distPips: number
  reservedLegs: number
  forceAuto?: boolean
}): { effectiveStepPips: number; auto: boolean; fittedLegs: number } | null {
  const dist = Number(args.distPips)
  const reserved = Math.max(0, Math.floor(Number(args.reservedLegs) || 0))
  if (!Number.isFinite(dist) || dist <= 0 || reserved <= 0) return null

  const rawStep = Number(args.stepPips)
  const auto = args.forceAuto === true || !Number.isFinite(rawStep) || rawStep <= 0
  if (!auto) {
    return { effectiveStepPips: rawStep, auto: false, fittedLegs: reserved }
  }

  let fittedLegs = reserved
  let effectiveStepPips = dist / reserved
  if (effectiveStepPips < MIN_AUTO_RANGE_STEP_PIPS) {
    fittedLegs = Math.min(reserved, Math.max(0, Math.floor(dist / MIN_AUTO_RANGE_STEP_PIPS)))
    if (fittedLegs <= 0) return null
    effectiveStepPips = dist / fittedLegs
  }
  return { effectiveStepPips, auto: true, fittedLegs }
}
