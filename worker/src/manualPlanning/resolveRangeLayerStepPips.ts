/**
 * Resolve layering step in pips.
 *
 * - Manual: stepPips > 0 → use as-is (caller may still distance-cap legs).
 * - Auto (stepPips ≤ 0 or forceAuto): distance / reservedLegs so all reserved
 *   pending orders fill the range evenly.
 */
export function resolveRangeLayerStepPips(args: {
  stepPips: number
  distPips: number
  reservedLegs: number
  forceAuto?: boolean
}): { effectiveStepPips: number; auto: boolean } | null {
  const dist = Number(args.distPips)
  const reserved = Math.max(0, Math.floor(Number(args.reservedLegs) || 0))
  if (!Number.isFinite(dist) || dist <= 0 || reserved <= 0) return null

  const rawStep = Number(args.stepPips)
  const auto = args.forceAuto === true || !Number.isFinite(rawStep) || rawStep <= 0
  if (auto) {
    return { effectiveStepPips: dist / reserved, auto: true }
  }
  return { effectiveStepPips: rawStep, auto: false }
}
