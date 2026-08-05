import type { PlanRangeSplitArgs, PlanRangeSplitResult } from './types'
import { resolveRangeLayerStepPips } from './resolveRangeLayerStepPips'

/**
 * Decide how many of the planned legs go out as immediates vs. range pendings.
 * Pure function so the split can be unit-tested and reused by the UI estimator.
 *
 * `range_percent` reserves pending count for Total Open Trades. Step + distance
 * then cap how many of those reserved legs are actually layered:
 * `activePendingLegs = min(reserved, floor(distPips / effectiveStepPips))`.
 *
 * When step is Auto (`stepPips ≤ 0` or `forceAutoStep`), reserved legs fill
 * the distance evenly: `effectiveStepPips = dist / fitted`, with a minimum
 * Auto step of 1 pip (fewer active legs when reserved would pack tighter).
 * Total Open Trades = immediateLegs + activePendingLegs.
 */
export function planRangeSplit(args: PlanRangeSplitArgs): PlanRangeSplitResult {
  const {
    totalLegs, baseIsPendingSignal, rangeOn, rangePct, stepPips, distPips, pip,
    minStepPriceUnits, hasSignalAnchor,
  } = args
  const safe = (n: number) => Number.isFinite(n) && n > 0
  const baseResult: PlanRangeSplitResult = {
    immediateLegs: totalLegs,
    pendingLegs: 0,
    activePendingLegs: 0,
    maxStepIdx: 0,
    effectiveStepPips: Number.isFinite(stepPips) ? stepPips : 0,
    stepPriceOffset: 0,
  }
  if (!rangeOn) return baseResult
  if (baseIsPendingSignal) return { ...baseResult, fallbackReason: 'range_trading_skip_pending_signal' }
  if (!safe(distPips)) {
    return { ...baseResult, fallbackReason: 'range_trading_invalid' }
  }

  const reservedLegs = Math.max(0, Math.round((totalLegs * Math.max(0, Math.min(100, rangePct))) / 100))
  const immediateLegs = Math.max(0, totalLegs - reservedLegs)

  if (reservedLegs <= 0) {
    const manualStep = safe(stepPips) ? stepPips : 0
    return {
      ...baseResult,
      immediateLegs: totalLegs,
      effectiveStepPips: manualStep,
      stepPriceOffset: manualStep * pip,
      maxStepIdx: manualStep > 0 ? Math.max(0, Math.floor(distPips / manualStep)) : 0,
    }
  }

  const resolved = resolveRangeLayerStepPips({
    stepPips,
    distPips,
    reservedLegs,
    forceAuto: args.forceAutoStep === true,
  })
  if (!resolved) {
    return { ...baseResult, fallbackReason: 'range_trading_invalid' }
  }

  let effectiveStepPips = resolved.effectiveStepPips
  let fallbackReason: string | undefined
  if (resolved.auto) {
    fallbackReason = resolved.fittedLegs < reservedLegs
      ? 'range_trading_step_auto_min_capped'
      : 'range_trading_step_auto'
  } else if (
    !args.skipMinStepExpansion
    && minStepPriceUnits > 0
    && pip > 0
    && effectiveStepPips * pip < minStepPriceUnits
  ) {
    effectiveStepPips = Math.max(effectiveStepPips, Math.ceil(minStepPriceUnits / pip))
    fallbackReason = 'range_trading_step_auto_expanded'
  }

  const stepPriceOffset = effectiveStepPips * pip
  const maxStepIdx = resolved.auto
    ? resolved.fittedLegs
    : Math.max(0, Math.floor(distPips / effectiveStepPips))

  const activePendingLegs = Math.min(reservedLegs, maxStepIdx)
  if (activePendingLegs <= 0 && reservedLegs > 0) {
    fallbackReason = fallbackReason ?? 'range_trading_distance_capped'
  } else if (activePendingLegs < reservedLegs && !resolved.auto) {
    fallbackReason = fallbackReason ?? 'range_trading_distance_capped'
  } else if (activePendingLegs < reservedLegs && resolved.auto && !fallbackReason) {
    fallbackReason = 'range_trading_step_auto_min_capped'
  }

  if (!hasSignalAnchor && immediateLegs === 0) {
    fallbackReason = 'range_trading_anchor_runtime_only'
  }
  return {
    immediateLegs,
    pendingLegs: reservedLegs,
    activePendingLegs,
    maxStepIdx,
    effectiveStepPips,
    stepPriceOffset,
    fallbackReason,
  }
}
