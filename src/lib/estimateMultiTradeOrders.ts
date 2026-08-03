import { resolveMultiTradeTargetUnits } from './multiTradeLegUnits'
import { resolveRangeLayerStepPips } from './resolveRangeLayerStepPips'

/** Hard cap aligned with worker/src/manualPlanner.ts */
export const MULTI_TRADE_ABS_MAX_LEGS = 500

export interface EstimateMultiTradeOrderRange {
  enabled: boolean
  percent: number
  /** 0 or blank = Auto (fill distance with reserved legs). */
  stepPips: number
  distancePips: number
  /**
   * When true, live signal zone sets distance — preview Total Open Trades uses the
   * full reserved pending count as the ceiling (distance unknown at config time).
   */
  useSignalEntryRange?: boolean
  /** When true (virtual layering), always use Auto step. */
  forceAutoStep?: boolean
}

export interface EstimateMultiTradeOrderResult {
  baseLegs: number
  extraRemainderLeg: boolean
  totalOrders: number
  fallsBackSingle: boolean
  /** Populated only when range.enabled. */
  immediate?: number
  /** Reserved pending count from range_percent. */
  pending?: number
  /** Pending legs after range_distance / step depth cap (or full reserved when signal range / Auto). */
  activePending?: number
  /**
   * Ladder span in pips: activePending × stepPips, capped by range.distancePips.
   * Populated only when range.enabled and not signal-entry-range mode.
   */
  effectiveDistancePips?: number
  /** Resolved step used for the preview (manual or Auto). */
  effectiveStepPips?: number
}

/**
 * Preview how many orders Multi Trades will open for a given total lot and per-leg %.
 * Uses conservative broker defaults (minLot / lotStep 0.01) when the real symbol is unknown.
 * At execution time the worker uses live SymbolParams — the live count can differ slightly.
 *
 * When `range.enabled`, returns the immediate/pending split mirroring the planner's
 * `reservedLegs = round(baseLegs * percent / 100)` logic. In range mode no remainder
 * leg is emitted. **Total Open Trades** = `immediate + activePending`, where
 * `activePending = min(reserved, floor(distance / step))` for manual step, or full
 * reserved when Auto step / `useSignalEntryRange` is set.
 */
export function estimateMultiTradeOrderCount(args: {
  manualLot: number
  legPercent: number
  minLot?: number
  lotStep?: number
  range?: EstimateMultiTradeOrderRange
}): EstimateMultiTradeOrderResult {
  const minLot = args.minLot ?? 0.01
  const lotStep = args.lotStep ?? 0.01
  const legPct = Math.max(0.1, Math.min(100, Number(args.legPercent ?? 5)))
  const manualLot = Number(args.manualLot)
  if (!Number.isFinite(manualLot) || manualLot <= 0) {
    return { baseLegs: 0, extraRemainderLeg: false, totalOrders: 0, fallsBackSingle: true }
  }

  const { manualUnits, targetUnits, minUnits } = resolveMultiTradeTargetUnits({
    manualLot,
    legPercent: legPct,
    minLot,
    lotStep,
  })

  if (manualUnits < minUnits) {
    return { baseLegs: 0, extraRemainderLeg: false, totalOrders: 0, fallsBackSingle: true }
  }
  if (targetUnits < minUnits) {
    return { baseLegs: 1, extraRemainderLeg: false, totalOrders: 1, fallsBackSingle: true }
  }

  const baseLegs = Math.max(1, Math.min(MULTI_TRADE_ABS_MAX_LEGS, Math.floor(manualUnits / targetUnits)))
  const remainderUnits = manualUnits - baseLegs * targetUnits

  const range = args.range
  const signalRange = range?.useSignalEntryRange === true
  const rangeValid = !!(range
    && range.enabled
    && Number.isFinite(range.percent)
    && (
      signalRange
      || (Number.isFinite(range.distancePips) && range.distancePips > 0)
    ))

  if (rangeValid && range) {
    const pct = Math.max(0, Math.min(100, Number(range.percent)))
    const pending = Math.max(0, Math.round((baseLegs * pct) / 100))
    const immediate = Math.max(0, baseLegs - pending)

    let activePending = 0
    let effectiveStepPips: number | undefined
    if (signalRange) {
      activePending = pending
    } else {
      const resolved = resolveRangeLayerStepPips({
        stepPips: Number(range.stepPips),
        distPips: range.distancePips,
        reservedLegs: pending,
        forceAuto: range.forceAutoStep === true,
      })
      if (resolved) {
        effectiveStepPips = resolved.effectiveStepPips
        if (resolved.auto) {
          activePending = resolved.fittedLegs
        } else {
          const maxStepIdx = Math.max(0, Math.floor(range.distancePips / resolved.effectiveStepPips))
          activePending = Math.min(pending, maxStepIdx)
        }
      }
    }

    const total = Math.min(MULTI_TRADE_ABS_MAX_LEGS, immediate + activePending)
    const rawSpan = activePending > 0 && effectiveStepPips != null && effectiveStepPips > 0
      ? activePending * effectiveStepPips
      : 0
    return {
      baseLegs,
      extraRemainderLeg: false,
      totalOrders: total,
      fallsBackSingle: false,
      immediate,
      pending,
      activePending,
      ...(effectiveStepPips != null ? { effectiveStepPips } : {}),
      ...(signalRange
        ? {}
        : { effectiveDistancePips: Math.min(rawSpan || range.distancePips, range.distancePips) }),
    }
  }

  const extraRemainderLeg = remainderUnits >= minUnits && baseLegs < MULTI_TRADE_ABS_MAX_LEGS
  const totalOrders = Math.min(MULTI_TRADE_ABS_MAX_LEGS, baseLegs + (extraRemainderLeg ? 1 : 0))
  return { baseLegs, extraRemainderLeg, totalOrders, fallsBackSingle: false }
}

export type MultiTradeTotalOpenTradesLabels = {
  fallbackSingle: string
  lotsXTrades: string
  lotsXTradesLayered: string
}

/** User-facing Total Open Trades line, e.g. `0.05 lots x 20 trades (10 instant + 10 for layering)`. */
export function formatMultiTradeTotalOpenTradesPreview(
  perLegLot: number | null,
  preview: EstimateMultiTradeOrderResult,
  labels: MultiTradeTotalOpenTradesLabels,
  formatLot: (lot: number) => string = n => (Number.isFinite(n) && n > 0 ? n.toFixed(2) : '—'),
): string {
  const lot = perLegLot != null && perLegLot > 0 ? formatLot(perLegLot) : '—'
  if (preview.fallsBackSingle || preview.totalOrders <= 0) {
    return labels.fallbackSingle.replace(/\{lot\}/g, lot)
  }
  const total = String(preview.totalOrders)
  if (preview.immediate != null && (preview.activePending != null || preview.pending != null)) {
    const layering = preview.activePending ?? preview.pending ?? 0
    return labels.lotsXTradesLayered
      .replace(/\{lot\}/g, lot)
      .replace(/\{total\}/g, total)
      .replace(/\{immediate\}/g, String(preview.immediate))
      .replace(/\{pending\}/g, String(layering))
  }
  return labels.lotsXTrades
    .replace(/\{lot\}/g, lot)
    .replace(/\{total\}/g, total)
}
