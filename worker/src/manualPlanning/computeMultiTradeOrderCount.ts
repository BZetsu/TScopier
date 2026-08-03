/** Hard cap aligned with planner + AccountConfig preview. */
export const MULTI_TRADE_ABS_MAX_LEGS = 500

import { resolveMultiTradeTargetUnits } from './multiTradeLegUnits'
import { resolveRangeLayerStepPips } from './resolveRangeLayerStepPips'

export interface ComputeMultiTradeOrderCountArgs {
  manualLot: number
  legPercent: number
  minLot?: number
  lotStep?: number
  rangeTrading?: boolean
  rangePercent?: number
  rangeStepPips?: number
  rangeDistancePips?: number
  /** When true, distance is signal-driven — count uses full reserved pending. */
  useSignalEntryRange?: boolean
  /** When true (virtual layering), always use Auto step. */
  forceAutoStep?: boolean
}

/**
 * Mirrors `src/lib/estimateMultiTradeOrders.ts` — Total Open Trades =
 * immediate + activePending (distance/step capped, or full reserved with Auto / signal range).
 */
export function computeMultiTradeOrderCount(args: ComputeMultiTradeOrderCountArgs): number {
  const minLot = args.minLot ?? 0.01
  const lotStep = args.lotStep ?? 0.01
  const legPct = Math.max(0.1, Math.min(100, Number(args.legPercent ?? 5)))
  const manualLot = Number(args.manualLot)
  if (!Number.isFinite(manualLot) || manualLot <= 0) return 0

  const { manualUnits, targetUnits, minUnits } = resolveMultiTradeTargetUnits({
    manualLot,
    legPercent: legPct,
    minLot,
    lotStep,
  })

  if (targetUnits < minUnits || manualUnits < minUnits) return 1

  const baseLegs = Math.max(1, Math.min(MULTI_TRADE_ABS_MAX_LEGS, Math.floor(manualUnits / targetUnits)))
  const remainderUnits = manualUnits - baseLegs * targetUnits

  const signalRange = args.useSignalEntryRange === true
  if (
    args.rangeTrading
    && (
      signalRange
      || (Number.isFinite(args.rangeDistancePips) && (args.rangeDistancePips ?? 0) > 0)
    )
  ) {
    const pct = Math.max(0, Math.min(100, Number(args.rangePercent ?? 0)))
    const pending = Math.max(0, Math.round((baseLegs * pct) / 100))
    const immediate = Math.max(0, baseLegs - pending)
    if (signalRange) {
      return Math.min(MULTI_TRADE_ABS_MAX_LEGS, immediate + pending)
    }
    const resolved = resolveRangeLayerStepPips({
      stepPips: Number(args.rangeStepPips ?? 0),
      distPips: Number(args.rangeDistancePips ?? 0),
      reservedLegs: pending,
      forceAuto: args.forceAutoStep === true,
    })
    if (!resolved) return Math.min(MULTI_TRADE_ABS_MAX_LEGS, immediate)
    const activePending = resolved.auto
      ? pending
      : Math.min(pending, Math.max(0, Math.floor((args.rangeDistancePips ?? 0) / resolved.effectiveStepPips)))
    return Math.min(MULTI_TRADE_ABS_MAX_LEGS, immediate + activePending)
  }

  const extraRemainderLeg = remainderUnits >= minUnits && baseLegs < MULTI_TRADE_ABS_MAX_LEGS
  return Math.min(MULTI_TRADE_ABS_MAX_LEGS, baseLegs + (extraRemainderLeg ? 1 : 0))
}
