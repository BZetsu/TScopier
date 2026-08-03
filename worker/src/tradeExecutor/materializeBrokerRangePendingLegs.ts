import { MtOperation, OrderSendArgs } from '../fxsocketClient'
import type { TradeExecutorContext } from './context'
import { buildRangeLayerTriggerMap } from '../manualPlanning/rangeLayerTriggers'
import { clampOrderStops, roundLot, triggerPriceFor, virtualPendingTriggerAllowed } from './helpers'
import type { PreparedEntry } from './entryPrepare'
import {
  brokerRangeStepIdxForLeg,
  resolveBrokerRangeLadderPricing,
  snapPriceToSymbolGrid,
} from './brokerRangeLadderPricing'
import {
  isBrokerPendingLimitPriceRejectMessage,
  nextValidRangePendingPrice,
  orderRangePendingCandidates,
  type RangePendingCandidate,
} from './rangePendingPriceRemap'

export type MaterializeBrokerRangeOpts = {
  anchor?: number
  anchorSource?: 'signal' | 'quote' | 'fill' | 'unknown'
}

/**
 * Place broker BuyLimit/SellLimit for each planned range ladder leg and persist
 * rows in `range_pending_legs` with status `broker_pending`.
 *
 * When a planned price is invalid / too close to market, remap that leg onto the
 * next deeper valid price in the range instead of dropping it or waiting for a
 * retrace. Skipped shallow steps are persisted as `cancelled` so basket refresh
 * cannot re-add them.
 */
export async function materializeBrokerRangePendingLegs(
  ctx: TradeExecutorContext,
  prep: PreparedEntry,
  strictBrokerPlaced: boolean,
  opts?: MaterializeBrokerRangeOpts,
): Promise<boolean> {
  const {
    signal, broker, api, uuid, symbol, virtualPendings,
    params, plan, liveEntryFast, strictDeferred,
  } = prep

  if (!api || virtualPendings.length === 0) return false

  const anchor = opts?.anchor ?? prep.anchor
  const anchorSource = opts?.anchorSource ?? prep.anchorSource

  if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) {
    console.warn(
      `[tradeExecutor] dropping ${virtualPendings.length} broker range pendings: no anchor signal=${signal.id} broker=${broker.id} symbol=${symbol}`,
    )
    return false
  }

  const digits = Math.max(0, Math.min(8, Number(params?.digits) || 5))
  const ladder = resolveBrokerRangeLadderPricing({
    symbol,
    rangeLayering: plan.rangeLayering,
    params,
  })
  if (!ladder) {
    console.warn(
      `[tradeExecutor] broker range pending: invalid ladder config signal=${signal.id} broker=${broker.id} symbol=${symbol}`,
    )
    return false
  }

  const signalRangeBoundary = plan.rangeLayering?.signalRangeBoundary ?? null
  const signalZoneLo = plan.rangeLayering?.signalZoneLo ?? null
  const signalZoneHi = plan.rangeLayering?.signalZoneHi ?? null
  const useSignalEntryRange = plan.rangeLayering?.useSignalEntryRange === true
  const nowMs = Date.now()
  const isBuy = plan.isBuy !== false
  const side: 'buy' | 'sell' = isBuy ? 'buy' : 'sell'
  const pendingOp: MtOperation = isBuy ? 'BuyLimit' : 'SellLimit'
  const point = ladder.point
  const stopsLevel = Number(params?.stopsLevel) || 0
  const freezeLevel = Number(params?.freezeLevel) || 0

  let bid = 0
  let ask = 0
  try {
    const q = prep.strictEntryPrefetch ?? await api.quote(uuid, symbol)
    bid = Number(q.bid)
    ask = Number(q.ask)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(
      `[tradeExecutor] broker range pending quote failed signal=${signal.id} broker=${broker.id}: ${msg}`,
    )
  }
  const haveQuote = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0

  const pendingLegsForMap = virtualPendings.map((v, i) => ({
    stepIdx: brokerRangeStepIdxForLeg(i, ladder.maxStepIdx),
    stepPriceOffset: ladder.stepPriceOffset,
    isBuy: plan.isBuy ?? v.isBuy,
  }))
  const triggerMap = buildRangeLayerTriggerMap({
    virtualPendings: pendingLegsForMap,
    anchor,
    digits: ladder.digits,
    rangeLayering: plan.rangeLayering ?? null,
    pip: ladder.pip,
  })

  const plannedEntries: RangePendingCandidate[] = []
  const plannedStepIdxs = new Set<number>()
  for (let i = 0; i < virtualPendings.length; i++) {
    const v = virtualPendings[i]!
    const stepIdx = brokerRangeStepIdxForLeg(i, ladder.maxStepIdx)
    const legForPrice = {
      ...v,
      stepIdx,
      stepPriceOffset: ladder.stepPriceOffset,
      isBuy,
    }
    const raw = triggerMap.get(stepIdx) ?? triggerPriceFor(legForPrice, anchor, ladder.digits)
    const price = snapPriceToSymbolGrid(raw, point, ladder.digits)
    if (!virtualPendingTriggerAllowed({
      triggerPrice: price,
      signalRangeBoundary,
      isBuy,
      stopsZoneLo: null,
      stopsZoneHi: null,
      signalZoneLo,
      signalZoneHi,
      useSignalEntryRange,
    })) {
      plannedStepIdxs.add(stepIdx)
      continue
    }
    plannedStepIdxs.add(stepIdx)
    plannedEntries.push({ stepIdx, price })
  }

  const candidates = orderRangePendingCandidates(plannedEntries, isBuy)
  const usedOrExhaustedStepIdxs = new Set<number>()
  const exhaustedInvalidSteps = new Map<number, { price: number; reason: string }>()
  const remaps: Array<{ fromStepIdx: number; fromPrice: number; toStepIdx: number; toPrice: number; reason: string }> = []

  const insertRows: Record<string, unknown>[] = []
  const placedTickets: Array<{ ticket: number; row: Record<string, unknown> }> = []

  for (let i = 0; i < virtualPendings.length; i++) {
    const v = virtualPendings[i]!
    const plannedStepIdx = brokerRangeStepIdxForLeg(i, ladder.maxStepIdx)
    const plannedPrice = snapPriceToSymbolGrid(
      triggerMap.get(plannedStepIdx)
        ?? triggerPriceFor({
          ...v,
          stepIdx: plannedStepIdx,
          stepPriceOffset: ladder.stepPriceOffset,
          isBuy,
        }, anchor, ladder.digits),
      point,
      ladder.digits,
    )
    const vol = roundLot(v.volume, params)

    let placed = false
    let attempts = 0
    const maxAttempts = Math.max(1, candidates.length)

    while (!placed && attempts < maxAttempts) {
      attempts += 1

      let pick: RangePendingCandidate | null = null
      if (haveQuote) {
        const next = nextValidRangePendingPrice({
          candidates,
          usedOrExhaustedStepIdxs,
          side,
          bid,
          ask,
          point,
          stopsLevel,
          freezeLevel,
        })
        for (const skipped of next.reasonSkipped) {
          usedOrExhaustedStepIdxs.add(skipped.stepIdx)
          exhaustedInvalidSteps.set(skipped.stepIdx, {
            price: skipped.price,
            reason: skipped.reason,
          })
        }
        pick = next.candidate
      } else {
        // No quote: fall back to first unused candidate (broker may still reject).
        pick = candidates.find(c => !usedOrExhaustedStepIdxs.has(c.stepIdx)) ?? null
      }

      if (!pick) break

      const limitPx = snapPriceToSymbolGrid(pick.price, point, ladder.digits)
      const sendArgs: OrderSendArgs = {
        symbol,
        operation: pendingOp,
        volume: vol,
        price: limitPx,
        stoploss: v.stoploss ?? 0,
        takeprofit: v.cweClosePrice != null ? 0 : (v.takeprofit ?? 0),
        slippage: v.slippage ?? 20,
        comment: v.comment ?? '',
        expertID: v.expertID ?? 909090,
      }
      const clamped = clampOrderStops(sendArgs, params)
      if (clamped.adjustments.length > 0) {
        console.warn(
          `[tradeExecutor] broker range pending stops clamped signal=${signal.id} step=${pick.stepIdx}: ${clamped.adjustments.join(', ')}`,
        )
      }

      try {
        let result
        try {
          result = await api.orderSend(uuid, clamped.args)
        } catch (sendErr) {
          const msg = sendErr instanceof Error ? sendErr.message : String(sendErr)
          const isInvalidStops = /invalid\s+stops/i.test(msg)
          const hasStops = (Number(clamped.args.stoploss) || 0) > 0
            || (Number(clamped.args.takeprofit) || 0) > 0
          if (isInvalidStops && hasStops) {
            result = await api.orderSend(uuid, { ...clamped.args, stoploss: 0, takeprofit: 0 })
          } else if (isBrokerPendingLimitPriceRejectMessage(msg)) {
            usedOrExhaustedStepIdxs.add(pick.stepIdx)
            exhaustedInvalidSteps.set(pick.stepIdx, { price: limitPx, reason: msg })
            console.warn(
              `[tradeExecutor] broker range pending price rejected signal=${signal.id}`
              + ` step=${pick.stepIdx} price=${limitPx}; trying next deeper rung: ${msg}`,
            )
            continue
          } else {
            console.warn(
              `[tradeExecutor] broker range pending rejected signal=${signal.id} step=${pick.stepIdx} op=${pendingOp} price=${limitPx}: ${msg}`,
            )
            usedOrExhaustedStepIdxs.add(pick.stepIdx)
            break
          }
        }

        const ticket = result.ticket
        if (ticket == null || !Number.isFinite(Number(ticket)) || Number(ticket) <= 0) {
          console.warn(
            `[tradeExecutor] broker range pending missing ticket signal=${signal.id} step=${pick.stepIdx}`,
          )
          usedOrExhaustedStepIdxs.add(pick.stepIdx)
          break
        }

        if (pick.stepIdx !== plannedStepIdx || Math.abs(limitPx - plannedPrice) > 1e-9) {
          remaps.push({
            fromStepIdx: plannedStepIdx,
            fromPrice: plannedPrice,
            toStepIdx: pick.stepIdx,
            toPrice: limitPx,
            reason: exhaustedInvalidSteps.get(plannedStepIdx)?.reason ?? 'remap_to_next_valid',
          })
          console.log(
            `[tradeExecutor] broker range pending remapped signal=${signal.id}`
            + ` from step=${plannedStepIdx} @${plannedPrice} → step=${pick.stepIdx} @${limitPx}`,
          )
        }

        usedOrExhaustedStepIdxs.add(pick.stepIdx)
        exhaustedInvalidSteps.delete(pick.stepIdx)

        const expiresAt = v.expiryHours && v.expiryHours > 0
          ? new Date(nowMs + v.expiryHours * 60 * 60 * 1000).toISOString()
          : null

        const row: Record<string, unknown> = {
          signal_id: signal.id,
          user_id: signal.user_id,
          broker_account_id: broker.id,
          metaapi_account_id: uuid,
          symbol,
          step_idx: pick.stepIdx,
          is_buy: v.isBuy,
          volume: vol,
          anchor_price: anchor,
          trigger_price: limitPx,
          stoploss: clamped.args.stoploss && clamped.args.stoploss > 0 ? clamped.args.stoploss : v.stoploss,
          takeprofit: clamped.args.takeprofit && clamped.args.takeprofit > 0 ? clamped.args.takeprofit : v.takeprofit,
          slippage: v.slippage ?? 20,
          comment: v.comment,
          expert_id: v.expertID ?? null,
          expires_at: expiresAt,
          status: 'broker_pending',
          ticket: String(ticket),
          cwe_close_price: v.cweClosePrice ?? null,
        }
        insertRows.push(row)
        placedTickets.push({ ticket: Number(ticket), row })
        placed = true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isBrokerPendingLimitPriceRejectMessage(msg)) {
          usedOrExhaustedStepIdxs.add(pick.stepIdx)
          exhaustedInvalidSteps.set(pick.stepIdx, { price: pick.price, reason: msg })
          console.warn(
            `[tradeExecutor] broker range pending price rejected signal=${signal.id}`
            + ` step=${pick.stepIdx}; trying next deeper rung: ${msg}`,
          )
          continue
        }
        console.warn(
          `[tradeExecutor] broker range pending OrderSend failed signal=${signal.id} step=${pick.stepIdx}: ${msg}`,
        )
        usedOrExhaustedStepIdxs.add(pick.stepIdx)
        break
      }
    }
  }

  // Cancel remapped-away / invalid shallow steps so ladder sync cannot re-add them.
  const cancelledRows: Record<string, unknown>[] = []
  const placedStepIdxs = new Set(insertRows.map(r => Number(r.step_idx)))
  for (const [stepIdx, meta] of exhaustedInvalidSteps) {
    if (placedStepIdxs.has(stepIdx)) continue
    cancelledRows.push({
      signal_id: signal.id,
      user_id: signal.user_id,
      broker_account_id: broker.id,
      metaapi_account_id: uuid,
      symbol,
      step_idx: stepIdx,
      is_buy: isBuy,
      volume: roundLot(virtualPendings[0]?.volume ?? 0.01, params),
      anchor_price: anchor,
      trigger_price: meta.price,
      stoploss: null,
      takeprofit: null,
      slippage: 20,
      comment: virtualPendings[0]?.comment ?? '',
      expert_id: virtualPendings[0]?.expertID ?? null,
      expires_at: null,
      status: 'cancelled',
      ticket: null,
      error_message: `skipped_invalid_price:${meta.reason}`,
      cwe_close_price: null,
    })
  }
  // Also cancel planned steps that were skipped by zone filter and never placed.
  for (const stepIdx of plannedStepIdxs) {
    if (placedStepIdxs.has(stepIdx)) continue
    if (exhaustedInvalidSteps.has(stepIdx)) continue
    if (candidates.some(c => c.stepIdx === stepIdx)) continue
    cancelledRows.push({
      signal_id: signal.id,
      user_id: signal.user_id,
      broker_account_id: broker.id,
      metaapi_account_id: uuid,
      symbol,
      step_idx: stepIdx,
      is_buy: isBuy,
      volume: roundLot(virtualPendings[0]?.volume ?? 0.01, params),
      anchor_price: anchor,
      trigger_price: snapPriceToSymbolGrid(
        triggerMap.get(stepIdx) ?? anchor,
        point,
        ladder.digits,
      ),
      stoploss: null,
      takeprofit: null,
      slippage: 20,
      comment: virtualPendings[0]?.comment ?? '',
      expert_id: virtualPendings[0]?.expertID ?? null,
      expires_at: null,
      status: 'cancelled',
      ticket: null,
      error_message: 'skipped_invalid_price:zone_or_filter',
      cwe_close_price: null,
    })
  }

  if (insertRows.length === 0 && cancelledRows.length === 0) return false

  const allRows = [...insertRows, ...cancelledRows]
  const persistLabel = `broker range pending signal=${signal.id} broker=${broker.id}`
  const persist = await ctx.persistRangePendingLegRows(allRows, persistLabel)
  if (!persist.ok) {
    console.error(
      `[tradeExecutor] broker range_pending_legs persist failed signal=${signal.id} broker=${broker.id}: ${persist.lastError ?? 'unknown'}`,
    )
    for (const { ticket } of placedTickets) {
      try {
        await api.orderClose(uuid, { ticket })
      } catch { /* best-effort rollback */ }
    }
    if (!liveEntryFast) {
      try {
        await ctx.supabase.from('trade_execution_logs').insert({
          user_id: signal.user_id,
          signal_id: signal.id,
          broker_account_id: broker.id,
          action: 'range_broker_pending_failed',
          status: 'failed',
          request_payload: { rows: insertRows.length, anchor, anchorSource } as unknown as Record<string, unknown>,
          error_message: persist.lastError ?? 'unknown',
        })
      } catch { /* best-effort */ }
    }
    return false
  }

  if (insertRows.length === 0) {
    console.warn(
      `[tradeExecutor] broker range pendings: no limits placed (cancelled=${cancelledRows.length})`
      + ` signal=${signal.id} broker=${broker.id}`,
    )
    return false
  }

  console.log(
    `[tradeExecutor] broker range pendings inserted=${insertRows.length}`
    + ` cancelled_invalid=${cancelledRows.length} remapped=${remaps.length}`
    + ` signal=${signal.id} broker=${broker.id} symbol=${symbol} anchor=${anchor} (${anchorSource})`
    + ` step_pips=${ladder.stepPips} dist_pips=${ladder.distPips} max_step_idx=${ladder.maxStepIdx}`
    + ` step_offset=${ladder.stepPriceOffset}`,
  )
  try {
    await ctx.supabase.from('trade_execution_logs').insert({
      user_id: signal.user_id,
      signal_id: signal.id,
      broker_account_id: broker.id,
      action: 'range_broker_pending_inserted',
      status: 'success',
      request_payload: {
        rows: insertRows.length,
        cancelled_invalid: cancelledRows.length,
        remaps,
        anchor,
        anchorSource,
        symbol,
        stepIdxs: insertRows.map(r => r.step_idx),
        triggers: insertRows.map(r => r.trigger_price),
        tickets: insertRows.map(r => r.ticket),
        range_layering: plan.rangeLayering ?? null,
        ladder_pricing: ladder,
        basket_leg_cap: plan.rangeLayering?.basketLegCap ?? null,
        strict_deferred: strictDeferred,
        strict_broker_pending: strictBrokerPlaced,
        layering_type: 'pending_order',
      } as unknown as Record<string, unknown>,
    })
  } catch { /* best-effort */ }
  return true
}
