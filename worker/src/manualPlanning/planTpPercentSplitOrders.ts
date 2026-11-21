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

  /**
   * Size one order per Targets % bucket. `tp` may be 0 on teasers (prices attach
   * on the follow-up); volume split still applies whenever ≥2 buckets survive.
   */
  const emitPercentSplit = (
    buckets: SplitBucket[],
    emptyLadderFallback: string,
  ): PlannerResult => {
    if (buckets.length === 0) {
      return directOrder(ladder[0] ?? 0, emptyLadderFallback)
    }
    if (buckets.length === 1) {
      return directOrder(
        buckets[0]!.tp,
        `${reasonPrefix}_single_bucket_${buckets[0]!.label}`,
        buckets[0]!.label,
      )
    }

    const toUnits = (lots: number): number => Math.floor((lots / lotStep) + 1e-9)
    const totalUnits = toUnits(manualLot)
    // Ceil (not floor) so a minLot that is not a lotStep multiple still yields a
    // legal, ≥-minLot promotion target.
    const minUnits = Math.max(1, Math.ceil(minLot / lotStep - 1e-9))

    const planned = buckets.map(b => ({ ...b, units: Math.max(0, toUnits(b.rawLots)) }))
    // Over-100 guard over ALL floors (surviving and short alike): if the
    // configured Targets % oversubscribe the lot even after flooring, fall back
    // to a single full-lot order rather than splitting a broken config.
    let floorSumAll = 0
    for (const b of planned) floorSumAll += b.units
    if (totalUnits - floorSumAll < 0) {
      return directOrder(ladder[0] ?? 0, `${reasonPrefix}_targets_over_100`)
    }

    // Distribution rule (owner-approved 2026-11-13): floor every share to a
    // legal step; lift any level that fell below the broker minimum back up to
    // the minimum using the leftovers (nearest level first, so the deep levels
    // are sacrificed first when the pot cannot save everyone); give whatever is
    // still unassigned to the deepest surviving level. Prices are never touched
    // — only lot distribution — and the opened volume always equals the lot.
    const short: typeof planned = []
    let openUnits = 0
    for (const b of planned) {
      if (b.units >= minUnits) openUnits += b.units
      else short.push(b)
    }
    // The rescue pot = unassigned percent (disabled rows, fewer TPs than rows)
    // + flooring leftovers + the floored shares of levels that cannot open yet.
    // The over-100 guard above guarantees pot ≥ 0 here.
    let pot = totalUnits - openUnits
    for (const b of short) {
      if (pot >= minUnits) {
        b.units = minUnits
        pot -= minUnits
      }
    }

    // Surviving levels in ladder order (nearest → farthest): promoted levels
    // keep their ladder position, so the farthest level below is really the
    // deepest trade and the order list reads TP1, TP2, …
    const alive = planned.filter(b => b.units >= minUnits)

    if (alive.length === 0) {
      // The pot could not lift any level to the minimum: one full-lot order.
      return directOrder(ladder[0] ?? 0, `${reasonPrefix}_all_buckets_below_min_lot`)
    }
    if (alive.length === 1) {
      const only = alive[0]!
      return directOrder(only.tp, `${reasonPrefix}_single_bucket_${only.label}`, only.label)
    }

    // Whatever volume is still unassigned (floor leftovers of surviving levels,
    // shares of levels that stayed dead, unassigned percent) goes to the deepest
    // surviving level, so the opened total always equals the lot.
    const farthest = alive[alive.length - 1]!
    farthest.units += pot

    const orders: OrderSendArgs[] = []
    for (const b of alive) {
      const units = b.units
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

    if (orders.length === 0) return directOrder(ladder[0] ?? 0, `${reasonPrefix}_zero_orders`)
    if (orders.length === 1) {
      return directOrder(ladder[0] ?? orders[0]!.takeprofit, `${reasonPrefix}_single_surviving_leg`)
    }

    return {
      orders,
      ...tail,
      ...(ladder.length === 0 ? { fallback_reason: `${reasonPrefix}_open_tp_split` } : {}),
    }
  }

  // Teaser / bare entry (no TP prices yet): still split by Targets % when the
  // channel has ≥2 enabled percent rows. Legs open naked; follow-up attaches TPs.
  if (ladder.length === 0) {
    const lots = manual.tp_lots ?? []
    const buckets: SplitBucket[] = []
    for (let i = 0; i < lots.length; i++) {
      const row = lots[i]
      if (!row || row.enabled === false) continue
      const pct = Number(row.percent)
      if (!(Number.isFinite(pct) && pct > 0)) continue
      buckets.push({
        tpIndex: i,
        tp: 0,
        label: String(row.label ?? `TP${i + 1}`),
        rawLots: (manualLot * Math.min(100, pct)) / 100,
      })
    }
    if (buckets.length < 2) return directOrder(0, `${reasonPrefix}_open_tp`)
    return emitPercentSplit(buckets, `${reasonPrefix}_open_tp`)
  }

  const { bucketRows } = resolveTpBucketRows(ladder, manual.tp_lots ?? null)
  const buckets: SplitBucket[] = []
  for (let i = 0; i < bucketRows.length; i++) {
    const row = bucketRows[i]!
    const tp = ladder[i]
    if (row.percent <= 0 || tp == null || !Number.isFinite(tp) || tp <= 0) continue
    buckets.push({ tpIndex: i, tp, label: row.label, rawLots: (manualLot * row.percent) / 100 })
  }

  return emitPercentSplit(buckets, `${reasonPrefix}_no_enabled_buckets`)
}
