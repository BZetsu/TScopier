import type { PlannerResult } from './types'
import type { PlanMultiManualOrdersArgs } from './planMultiManualOrders'
import { planTpPercentSplitOrders } from './planTpPercentSplitOrders'

/**
 * Bundled multi plan: one immediate broker order per take-profit level, sized
 * by the Targets % rows (50/30/20 by default). Each leg carries its own
 * broker-side TP; no partial_tp_legs are emitted. Gated by TP_BUNDLE_ENABLED —
 * see docs/bundled-single-tp-trade-style.md (D2).
 */
export function planBundleManualOrders(args: PlanMultiManualOrdersArgs): PlannerResult {
  return planTpPercentSplitOrders({
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
    commentPrefix: args.commentPrefix,
    reasonPrefix: 'bundle',
  })
}
