import type { OrderSendArgs } from '../fxsocketClient'
import type { PipQuote } from '../pipCalculator'
import type { ManualSettings, PlannerContext, PlannerResult, PlannerStrictEntry } from './types'
import { planTpPercentSplitOrders } from './planTpPercentSplitOrders'

export interface PlanSingleManualOrdersArgs {
  orderBase: Omit<OrderSendArgs, 'volume' | 'stoploss' | 'takeprofit' | 'expiration' | 'expirationType'>
  expirationFields: { expiration?: string; expirationType?: OrderSendArgs['expirationType'] }
  strictEntry: PlannerStrictEntry | undefined
  manualLot: number
  finalSl: number | null
  finalTps: number[]
  manual: ManualSettings
  ctx: PlannerContext
  delay_ms: number
  entryAnchor: number | null
  isBuy: boolean
  pip: number
  pipQuote: PipQuote
  roundPrice: (v: number | null | undefined) => number
  fallbackReason?: string
  /** Order comment prefix (symbol/side); used for `:tp1` suffixes on split legs. */
  commentPrefix?: string
}

/**
 * Single trade style: split the fixed lot across Targets % into one broker
 * order per TP (visible take-profits). No worker partial-close schedule.
 * Degenerate cases (one TP / lot too small) emit a single full-lot order.
 */
export function planSingleManualOrders(args: PlanSingleManualOrdersArgs): PlannerResult {
  const result = planTpPercentSplitOrders({
    orderBase: args.orderBase,
    expirationFields: args.expirationFields,
    strictEntry: args.strictEntry,
    manual: args.manual,
    manualLot: args.manualLot,
    ctx: args.ctx,
    delay_ms: args.delay_ms,
    entryAnchor: args.entryAnchor,
    isBuy: args.isBuy,
    pip: args.pip,
    pipQuote: args.pipQuote,
    finalSl: args.finalSl,
    finalTps: args.finalTps,
    roundPrice: args.roundPrice,
    commentPrefix: args.commentPrefix ?? '',
    reasonPrefix: 'single_tp_split',
  })
  if (args.fallbackReason && !result.fallback_reason) {
    return { ...result, fallback_reason: args.fallbackReason }
  }
  if (args.fallbackReason && result.fallback_reason) {
    return {
      ...result,
      fallback_reason: `${args.fallbackReason}|${result.fallback_reason}`,
    }
  }
  return result
}
