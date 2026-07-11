import { pipCalculator } from '../pipCalculator'
import { resolvePipSize } from '../signalStopUnits'
import type { PlannerRangeLayering } from '../manualPlanning/types'
import type { SymbolCacheEntry } from './types'

export type BrokerRangeLadderPricing = {
  stepPips: number
  distPips: number
  pip: number
  stepPriceOffset: number
  maxStepIdx: number
  digits: number
  point: number
}

/** Ladder rungs for broker limits: always user step/distance, never SL/TP min-stop expansion. */
export function resolveBrokerRangeLadderPricing(args: {
  symbol: string
  rangeLayering: PlannerRangeLayering | null | undefined
  params: SymbolCacheEntry | null
}): BrokerRangeLadderPricing | null {
  const rl = args.rangeLayering
  if (!rl) return null

  const stepPips = Math.max(0, Number(rl.rangeStepPips ?? 0))
  if (stepPips <= 0) return null

  let distPips = Math.max(0, Number(rl.rangeDistancePips ?? 0))
  if (rl.useSignalEntryRange === true) {
    const zoneDist = Number(rl.effectiveDistancePips ?? 0)
    if (Number.isFinite(zoneDist) && zoneDist > 0) distPips = zoneDist
  }
  if (distPips <= 0) return null

  const point = Number(args.params?.point) || 0
  const digits = Math.max(0, Math.min(8, Number(args.params?.digits) || 5))
  const pipQuote = pipCalculator(
    args.symbol,
    point,
    digits,
    args.params?.contractSize ?? null,
  )
  const pip = resolvePipSize({ symbol: args.symbol, brokerPipPrice: pipQuote.pipPrice })
  if (!Number.isFinite(pip) || pip <= 0) return null

  const stepPriceOffset = stepPips * pip
  const maxStepIdx = Math.max(1, Math.floor(distPips / stepPips))

  return { stepPips, distPips, pip, stepPriceOffset, maxStepIdx, digits, point }
}

export function snapPriceToSymbolGrid(price: number, point: number, digits: number): number {
  if (Number.isFinite(point) && point > 0) {
    return Number((Math.round(price / point) * point).toFixed(digits))
  }
  return Number(price.toFixed(digits))
}

export function brokerRangeStepIdxForLeg(legIndex: number, maxStepIdx: number): number {
  if (maxStepIdx <= 0) return legIndex + 1
  return (legIndex % maxStepIdx) + 1
}
