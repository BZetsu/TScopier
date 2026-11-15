import type { OrderSendArgs } from '../fxsocketClient'
import type { PipQuote } from '../pipCalculator'
import type { ManualSettings, PlannerContext, PlannerResult, PlannerStrictEntry } from './types'
import { appendOrderCommentSuffix } from '../tradeComment'
import { normalizeAutoBeConfig, resolveAutoBeTpHitTriggerPrice } from '../autoManagement'
import { resolveTpBucketRows } from './tpBucketDistribution'

interface SplitBucket {
  tpIndex: number
  tp: number
  label: string
  rawLots: number
}

export interface PlanTpPercentSplitOrdersArgs {
  orderBase: Omit<OrderSendArgs, 'volume' | 'stoploss' | 'takeprofit' | 'expiration' | 'expirationType'>
  expirationFields: { expiration?: string; expirationType?: OrderSendArgs['expirationType'] }
  strictEntry: PlannerStrictEntry | undefined
  manual: ManualSettings
  manualLot: number
  ctx: PlannerContext
  delay_ms: number
  entryAnchor: number | null
  isBuy: boolean
  pip: number
  pipQuote: PipQuote
  finalSl: number | null
  finalTps: number[]
  roundPrice: (v: number | null | undefined) => number
  commentPrefix: string
  /** Prefix for fallback_reason (e.g. `bundle`, `single_tp_split`). */
  reasonPrefix?: string
}

/**
 * One immediate broker order per take-profit level, sized by Targets % rows
 * (50/30/20 by default). Each leg carries its own broker-side TP; no
 * partial_tp_legs are emitted. Used by Single trade style and bundled Multi.
 */
export function planTpPercentSplitOrders(args: PlanTpPercentSplitOrdersArgs): PlannerResult {
  const {
    orderBase,
    expirationFields,
    strictEntry,
    manual,
    manualLot,
    ctx,
    delay_ms,
    entryAnchor,
    isBuy,
    pip,
    pipQuote,
    finalSl,
    finalTps,
    roundPrice,
    commentPrefix,
  } = args
  const reasonPrefix = args.reasonPrefix ?? 'tp_split'

  const minLot = Number.isFinite(ctx.minLot) && ctx.minLot > 0 ? ctx.minLot : 0.01
  const lotStep = Number.isFinite(ctx.lotStep) && ctx.lotStep > 0 ? ctx.lotStep : 0.01

  if (!(manualLot > 0) || manualLot < minLot) {
    return { orders: [], skip_reason: 'lot_below_symbol_min', delay_ms }
  }

  const ladder = finalTps.filter(t => typeof t === 'number' && Number.isFinite(t) && t > 0)

  const autoBeCfg = normalizeAutoBeConfig(manual)
  const autoBeTpHitTriggerPrice = ladder.length > 0 && autoBeCfg?.mode === 'tp_hit'
    ? resolveAutoBeTpHitTriggerPrice({
      tpIndex: autoBeCfg.tpIndex,
      finalTps: ladder,
      brokerTp: null,
    })
    : null

  const tail = {
    delay_ms,
    anchor: {
      source: entryAnchor != null ? ('signal' as const) : ('unknown' as const),
      value: entryAnchor,
    },
    pip,
    pipQuote,
    isBuy,
    ...(strictEntry ? { strictEntry } : {}),
    ...(autoBeTpHitTriggerPrice != null ? { autoBeTpHitTriggerPrice } : {}),
  }

  const directOrder = (takeprofit: number, fallbackReason: string, label?: string): PlannerResult => ({
    orders: [{
      ...orderBase,
      volume: manualLot,
      stoploss: roundPrice(finalSl),
      takeprofit: roundPrice(takeprofit),
      ...expirationFields,
      ...(label ? { comment: appendOrderCommentSuffix(commentPrefix, `:${label.toLowerCase()}`) } : {}),
    }],
    ...tail,
    fallback_reason: fallbackReason,
  })

  if (ladder.length === 0) {
    return directOrder(0, `${reasonPrefix}_open_tp`)
  }

  const { bucketRows } = resolveTpBucketRows(ladder, manual.tp_lots ?? null)
  const buckets: SplitBucket[] = []
  for (let i = 0; i < bucketRows.length; i++) {
    const row = bucketRows[i]!
    const tp = ladder[i]
    if (row.percent <= 0 || tp == null || !Number.isFinite(tp) || tp <= 0) continue
    buckets.push({ tpIndex: i, tp, label: row.label, rawLots: (manualLot * row.percent) / 100 })
  }

  if (buckets.length === 0) return directOrder(ladder[0]!, `${reasonPrefix}_no_enabled_buckets`)
  if (buckets.length === 1) {
    return directOrder(
      buckets[0]!.tp,
      `${reasonPrefix}_single_bucket_${buckets[0]!.label}`,
      buckets[0]!.label,
    )
  }

  const toUnits = (lots: number): number => Math.floor((lots / lotStep) + 1e-9)
  const totalUnits = toUnits(manualLot)
  const minUnits = Math.max(1, toUnits(minLot))

  const planned = buckets.map(b => ({ ...b, units: Math.max(0, toUnits(b.rawLots)) }))
  const kept: typeof planned = []
  let rescuedUnits = 0
  for (const b of planned) {
    if (b.units > 0 && b.units >= minUnits) kept.push(b)
    else rescuedUnits += b.units
  }
  if (kept.length === 0) {
    return directOrder(ladder[0]!, `${reasonPrefix}_all_buckets_below_min_lot`)
  }
  if (kept.length === 1) {
    return directOrder(
      kept[0]!.tp,
      `${reasonPrefix}_single_bucket_${kept[0]!.label}`,
      kept[0]!.label,
    )
  }

  const farthest = kept[kept.length - 1]!
  let floorSum = 0
  for (const b of kept) floorSum += b.units
  const remainderUnits = totalUnits - floorSum - rescuedUnits
  if (remainderUnits < 0) return directOrder(ladder[0]!, `${reasonPrefix}_targets_over_100`)
  const farthestUnits = farthest.units + rescuedUnits + remainderUnits
  if (farthestUnits < minUnits) {
    return directOrder(farthest.tp, `${reasonPrefix}_total_below_min_lot`, farthest.label)
  }

  const orders: OrderSendArgs[] = []
  for (const b of kept) {
    const units = b === farthest ? farthestUnits : b.units
    if (units < minUnits) continue
    const volume = Math.round(units * lotStep * 1e8) / 1e8
    if (!(volume > 0)) continue
    orders.push({
      ...orderBase,
      volume,
      stoploss: roundPrice(finalSl),
      takeprofit: roundPrice(b.tp),
      ...expirationFields,
      comment: appendOrderCommentSuffix(commentPrefix, `:${b.label.toLowerCase()}`),
    })
  }

  if (orders.length === 0) return directOrder(ladder[0]!, `${reasonPrefix}_zero_orders`)
  if (orders.length === 1) return directOrder(ladder[0]!, `${reasonPrefix}_single_surviving_leg`)

  return { orders, ...tail }
}
