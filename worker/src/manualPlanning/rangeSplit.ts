import type { PlanRangeSplitArgs, PlanRangeSplitResult } from './types'

/**
 * Decide how many of the planned legs go out as immediates vs. range pendings.
 * Pure function so the split can be unit-tested and reused by the UI estimator.
 *
 * `range_percent` reserves pending count for Total Open Trades. Step + distance
 * then cap how many of those reserved legs are actually layered:
 * `activePendingLegs = min(reserved, floor(distPips / effectiveStepPips))`.
 * Total Open Trades = immediateLegs + activePendingLegs.
 */
export function planRangeSplit(args: PlanRangeSplitArgs): PlanRangeSplitResult {
  const { totalLegs, baseIsPendingSignal, rangeOn, rangePct, stepPips, distPips, pip, minStepPriceUnits, hasSignalAnchor } = args
  const safe = (n: number) => Number.isFinite(n) && n > 0
  const baseResult: PlanRangeSplitResult = {
    immediateLegs: totalLegs,
    pendingLegs: 0,
    activePendingLegs: 0,
    maxStepIdx: 0,
    effectiveStepPips: stepPips,
    stepPriceOffset: 0,
  }
  if (!rangeOn) return baseResult
  if (baseIsPendingSignal) return { ...baseResult, fallbackReason: 'range_trading_skip_pending_signal' }
  if (!safe(stepPips) || !safe(distPips)) {
    return { ...baseResult, fallbackReason: 'range_trading_invalid' }
  }

  let effectiveStepPips = stepPips
  let fallbackReason: string | undefined
  if (
    !args.skipMinStepExpansion
    && minStepPriceUnits > 0
    && pip > 0
    && stepPips * pip < minStepPriceUnits
  ) {
    effectiveStepPips = Math.max(stepPips, Math.ceil(minStepPriceUnits / pip))
    fallbackReason = 'range_trading_step_auto_expanded'
  }
  const stepPriceOffset = effectiveStepPips * pip
  const maxStepIdx = Math.max(0, Math.floor(distPips / effectiveStepPips))

  const reservedLegs = Math.max(0, Math.round((totalLegs * rangePct) / 100))
  if (reservedLegs <= 0) {
    return { ...baseResult, effectiveStepPips, stepPriceOffset, maxStepIdx, fallbackReason }
  }

  const activePendingLegs = Math.min(reservedLegs, maxStepIdx)
  if (activePendingLegs <= 0 && reservedLegs > 0) {
    fallbackReason = fallbackReason ?? 'range_trading_distance_capped'
  } else if (activePendingLegs < reservedLegs) {
    fallbackReason = fallbackReason ?? 'range_trading_distance_capped'
  }

  const immediateLegs = Math.max(0, totalLegs - reservedLegs)
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
