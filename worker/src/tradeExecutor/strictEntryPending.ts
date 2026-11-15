import { MtOperation, OrderSendArgs } from '../fxsocketClient'
import { clampPendingExpiryHours } from '../manualPlanner'
import { autoManagementTradeSnapshot } from '../autoManagement'
import { isTpPercentSplitBasket } from '../manualPlanning/tpBundleIdentity'
import { parseOrderCommentTpIndex } from '../tradeComment'
import type { TradeExecutorContext } from './context'
import { clampOrderStops, roundLot } from './helpers'
import type { PreparedEntry } from './entryPrepare'
import { writeExecutionLog } from '../observability/executionLog'
import { humanizeOrderSendError } from '../brokerTradeError'
import { normalizeBrokerTradeTicket } from '../brokerTradeTicket'

type PlaceOnePendingArgs = {
  ctx: TradeExecutorContext
  prep: PreparedEntry
  entryPx: number
  pendingOp: MtOperation
  expiresAt: string | null
  digits: number
  volume: number
  stoploss: number
  takeprofit: number
  slippage: number
  comment: string
  expertID: number
  partialTpPlan: unknown
  nextTpIndex: number
}

async function placeOneStrictPending(args: PlaceOnePendingArgs): Promise<boolean> {
  const {
    ctx, prep, entryPx, pendingOp, expiresAt, digits,
    volume, stoploss, takeprofit, slippage, comment, expertID, partialTpPlan, nextTpIndex,
  } = args
  const { signal, broker, api, uuid, symbol, params } = prep
  if (!api) return false

  const sendArgs: OrderSendArgs = {
    symbol,
    operation: pendingOp,
    volume,
    price: entryPx,
    stoploss,
    takeprofit,
    slippage,
    comment,
    expertID,
  }
  const clamped = clampOrderStops(sendArgs, params)
  if (clamped.adjustments.length > 0) {
    console.warn(
      `[tradeExecutor] strict entry pending stops clamped signal=${signal.id} broker=${broker.id}: ${clamped.adjustments.join(', ')}`,
    )
  }

  try {
    // Never retry without the stops: a pending entry the broker refuses to
    // protect is not an entry we want. Fail it and let the user see why.
    const result = await api.orderSend(uuid, clamped.args)
    const ticket = result.ticket
    const tradeTicket = normalizeBrokerTradeTicket(broker.provider, ticket)
    if (tradeTicket == null) {
      console.error(`[tradeExecutor] strict pending order returned an invalid ticket signal=${signal.id} broker=${broker.id}`)
      return false
    }
    const isBuyLeg = pendingOp === 'BuyLimit'
    const pendingSl = clamped.args.stoploss && clamped.args.stoploss > 0 ? clamped.args.stoploss : null
    const pendingTp = clamped.args.takeprofit && clamped.args.takeprofit > 0 ? clamped.args.takeprofit : null
    const autoBeCols = autoManagementTradeSnapshot(prep.manual, entryPx, pendingSl, {
      tpHitTriggerPrice: prep.plan.autoBeTpHitTriggerPrice ?? pendingTp,
    })
    const tradeInsert = await ctx.supabase
      .from('trades')
      .insert({
        user_id: signal.user_id,
        signal_id: signal.id,
        telegram_channel_id: signal.channel_id,
        broker_account_id: broker.id,
        metaapi_order_id: tradeTicket,
        symbol,
        direction: isBuyLeg ? 'buy' : 'sell',
        entry_price: entryPx,
        sl: pendingSl,
        tp: pendingTp,
        lot_size: result.lots ?? volume,
        status: 'pending',
        opened_at: new Date().toISOString(),
        cwe_close_price: null,
        next_tp_index: nextTpIndex,
        ...autoBeCols,
      })
      .select('id')
      .maybeSingle()

    if (tradeInsert.error) {
      console.error(
        `[tradeExecutor] trades INSERT failed after strict pending OrderSend signal=${signal.id} broker=${broker.id} ticket=${ticket}: ${tradeInsert.error.message}`,
      )
      try {
        await api.orderClose(uuid, { ticket })
      } catch { /* best-effort rollback */ }
      return false
    }

    const tradeId = (tradeInsert.data as { id?: string } | null)?.id ?? null
    if (!tradeId) {
      console.error(
        `[tradeExecutor] trades INSERT returned no id after strict pending OrderSend signal=${signal.id} broker=${broker.id} ticket=${ticket}`,
      )
      try {
        await api.orderClose(uuid, { ticket })
      } catch { /* best-effort rollback */ }
      return false
    }

    const { error: sepErr } = await ctx.supabase.from('signal_entry_pending_orders').insert({
      signal_id: signal.id,
      user_id: signal.user_id,
      broker_account_id: broker.id,
      metaapi_account_id: uuid,
      symbol,
      trade_id: tradeId,
      is_buy: isBuyLeg,
      operation: pendingOp,
      entry_price: entryPx,
      volume,
      stoploss: clamped.args.stoploss && clamped.args.stoploss > 0 ? clamped.args.stoploss : null,
      takeprofit: clamped.args.takeprofit && clamped.args.takeprofit > 0 ? clamped.args.takeprofit : null,
      slippage: clamped.args.slippage ?? 20,
      comment: clamped.args.comment ?? comment,
      expert_id: clamped.args.expertID ?? null,
      broker_ticket: tradeTicket,
      status: 'broker_pending',
      expires_at: expiresAt,
      partial_tp_plan: partialTpPlan,
    })
    if (sepErr) {
      console.error(
        `[tradeExecutor] signal_entry_pending_orders INSERT failed signal=${signal.id} broker=${broker.id}: ${sepErr.message}`,
      )
      await ctx.supabase.from('trades').delete().eq('id', tradeId)
      try {
        await api.orderClose(uuid, { ticket })
      } catch { /* best-effort rollback */ }
      return false
    }

    try {
      await writeExecutionLog(ctx.supabase, {
        user_id: signal.user_id,
        signal_id: signal.id,
        broker_account_id: broker.id,
        action: 'signal_entry_pending_placed',
        status: 'success',
        request_payload: {
          ticket,
          operation: pendingOp,
          entry_price: entryPx,
          volume,
          takeprofit: pendingTp,
          symbol,
          digits,
        } as unknown as Record<string, unknown>,
        response_payload: { trade_id: tradeId } as unknown as Record<string, unknown>,
      })
    } catch { /* best-effort */ }
    return true
  } catch (err) {
    const msg = humanizeOrderSendError(
      err instanceof Error ? err.message : String(err),
      symbol,
    )
    console.error(
      `[tradeExecutor] strict entry broker OrderSend failed signal=${signal.id} broker=${broker.id} op=${pendingOp} price=${entryPx}: ${msg}`,
    )
    await writeExecutionLog(ctx.supabase, {
      user_id: signal.user_id,
      signal_id: signal.id,
      broker_account_id: broker.id,
      action: 'signal_entry_pending_failed',
      status: 'failed',
      request_payload: {
        operation: pendingOp,
        entry_price: entryPx,
        volume,
        symbol,
      } as unknown as Record<string, unknown>,
      error_message: msg,
    })
    return false
  }
}

/**
 * Place broker BuyLimit/SellLimit when strict signal entry defers immediates.
 *
 * Single percent-split / bundled multi: one pending per Targets % leg (own
 * volume + broker TP). Classic multi may still aggregate into one full-lot
 * pending (`:strictEntryAgg`).
 */
export async function placeStrictSignalEntryPending(
  ctx: TradeExecutorContext,
  prep: PreparedEntry,
  singleTpOverride: boolean,
): Promise<boolean> {
  const {
    signal, broker, manual, api, uuid, symbol, params, plan, capped,
    strictDeferred, commentPrefix,
  } = prep
  if (!strictDeferred || !plan.strictEntry || capped.length === 0 || !api) return false

  const se = plan.strictEntry
  const digits = Math.max(0, Math.min(8, Number(params?.digits) || 5))
  const entryPx = Number(se.entryPrice.toFixed(digits))
  const pendHours = clampPendingExpiryHours(manual.pending_expiry_hours)
  const nowMs = Date.now()
  const expiresAt = pendHours > 0
    ? new Date(nowMs + pendHours * 60 * 60 * 1000).toISOString()
    : null
  const pendingOp: MtOperation = se.isBuy ? 'BuyLimit' : 'SellLimit'

  const percentSplitPendings = isTpPercentSplitBasket(manual) && capped.length > 1
  if (percentSplitPendings) {
    let anyOk = false
    for (let i = 0; i < capped.length; i++) {
      const leg = capped[i]!
      const vol = roundLot(Number(leg.volume) || 0, params)
      if (!(vol > 0)) continue
      const takeprofitPx = Number(leg.takeprofit) || 0
      const takeprofitRounded = takeprofitPx > 0 ? Number(takeprofitPx.toFixed(digits)) : 0
      const baseComment = String(leg.comment ?? commentPrefix)
      // Keep planner `:tpN` identity; append strictEntry for pending monitors.
      const comment = baseComment.includes(':strictEntry')
        ? baseComment
        : `${baseComment}:strictEntry`
      const plannedIdx = parseOrderCommentTpIndex(baseComment)
      const ok = await placeOneStrictPending({
        ctx,
        prep,
        entryPx,
        pendingOp,
        expiresAt,
        digits,
        volume: vol,
        stoploss: Number(leg.stoploss) || 0,
        takeprofit: takeprofitRounded,
        slippage: leg.slippage ?? 20,
        comment,
        expertID: leg.expertID ?? 909090,
        partialTpPlan: null,
        nextTpIndex: plannedIdx != null ? plannedIdx + 1 : i + 1,
      })
      if (ok) anyOk = true
      else {
        console.warn(
          `[tradeExecutor] strict entry percent-split pending failed leg=${i + 1}/${capped.length}`
          + ` signal=${signal.id} broker=${broker.id}`,
        )
      }
    }
    return anyOk
  }

  const first = capped[0]!
  let aggVol = 0
  for (const o of capped) aggVol += Number(o.volume) || 0
  const vol = roundLot(capped.length === 1 ? Number(first.volume) || 0 : aggVol, params)
  const baseComment = first.comment ?? commentPrefix
  const comment = capped.length === 1 ? `${baseComment}:strictEntry` : `${baseComment}:strictEntryAgg`

  const takeprofitPx = first.takeprofit ?? 0
  const takeprofitRounded = Number.isFinite(takeprofitPx) && takeprofitPx > 0
    ? Number(takeprofitPx.toFixed(digits))
    : 0

  const partialTpPlan =
    singleTpOverride && capped.length === 1 && plan.partialTps?.length ? plan.partialTps : null

  return placeOneStrictPending({
    ctx,
    prep,
    entryPx,
    pendingOp,
    expiresAt,
    digits,
    volume: vol,
    stoploss: first.stoploss ?? 0,
    takeprofit: takeprofitRounded,
    slippage: first.slippage ?? 20,
    comment,
    expertID: first.expertID ?? 909090,
    partialTpPlan,
    nextTpIndex: 1,
  })
}
