import { MtOperation, OrderSendArgs } from '../fxsocketClient'
import type { TradeExecutorContext } from './context'
import { buildRangeLayerTriggerMap } from '../manualPlanning/rangeLayerTriggers'
import { clampOrderStops, roundLot, triggerPriceFor, virtualPendingTriggerAllowed } from './helpers'
import type { PreparedEntry } from './entryPrepare'
import {
  resolveBrokerRangeLadderPricing,
  snapPriceToSymbolGrid,
} from './brokerRangeLadderPricing'
import {
  isBrokerPendingLimitPriceRejectMessage,
  nextValidRangePendingPrice,
  orderRangePendingCandidates,
  type RangePendingCandidate,
} from './rangePendingPriceRemap'
import { loadExistingRangeStepIndices } from '../rangePendingFireGuard'

/** In-process single-flight for broker ladder OrderSends (signal+broker+symbol). */
const brokerRangeMaterializeInflight = new Set<string>()

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

  const inflightKey = `${signal.id}:${broker.id}:${symbol}`
  if (brokerRangeMaterializeInflight.has(inflightKey)) {
    console.warn(
      `[tradeExecutor] skip duplicate broker range materialize in-flight`
      + ` signal=${signal.id} broker=${broker.id} symbol=${symbol}`,
    )
    return false
  }
  brokerRangeMaterializeInflight.add(inflightKey)
  try {
    return await materializeBrokerRangePendingLegsUnlocked(ctx, prep, strictBrokerPlaced, opts)
  } finally {
    brokerRangeMaterializeInflight.delete(inflightKey)
  }
}

async function materializeBrokerRangePendingLegsUnlocked(
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

  // Coalesce duplicate stepIdx legs (legacy cycling) into one order with summed volume.
  type CoalescedLeg = {
    stepIdx: number
    volume: number
    isBuy: boolean
    stoploss: number | null | undefined
    takeprofit: number | null | undefined
    cweClosePrice: number | null | undefined
    slippage: number | undefined
    comment: string | undefined
    expertID: number | null | undefined
    expiryHours: number | undefined
    stepPriceOffset: number
  }
  const coalescedByStep = new Map<number, CoalescedLeg>()
  for (let i = 0; i < virtualPendings.length; i++) {
    const v = virtualPendings[i]!
    const stepIdx = Number.isFinite(v.stepIdx) && v.stepIdx > 0
      ? Math.floor(v.stepIdx)
      : (i + 1)
    const existing = coalescedByStep.get(stepIdx)
    if (existing) {
      existing.volume = Number((existing.volume + Number(v.volume || 0)).toFixed(8))
      continue
    }
    coalescedByStep.set(stepIdx, {
      stepIdx,
      volume: Number(v.volume || 0),
      isBuy: plan.isBuy ?? v.isBuy,
      stoploss: v.stoploss,
      takeprofit: v.takeprofit,
      cweClosePrice: v.cweClosePrice,
      slippage: v.slippage,
      comment: v.comment,
      expertID: v.expertID,
      expiryHours: v.expiryHours,
      stepPriceOffset: ladder.stepPriceOffset || v.stepPriceOffset,
    })
  }
  const coalescedLegs = [...coalescedByStep.values()].sort((a, b) => a.stepIdx - b.stepIdx)

  const pendingLegsForMap = coalescedLegs.map(v => ({
    stepIdx: v.stepIdx,
    stepPriceOffset: v.stepPriceOffset,
    isBuy: v.isBuy,
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
  const seenPrices = new Set<string>()
  for (const v of coalescedLegs) {
    const stepIdx = v.stepIdx
    const legForPrice = {
      stepIdx,
      stepPriceOffset: v.stepPriceOffset,
      isBuy: v.isBuy,
    }
    const raw = triggerMap.get(stepIdx) ?? triggerPriceFor(legForPrice, anchor, ladder.digits)
    const price = snapPriceToSymbolGrid(raw, point, ladder.digits)
    plannedStepIdxs.add(stepIdx)
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
      continue
    }
    const priceKey = price.toFixed(ladder.digits)
    if (seenPrices.has(priceKey)) continue
    seenPrices.add(priceKey)
    plannedEntries.push({ stepIdx, price })
  }

  const candidates = orderRangePendingCandidates(plannedEntries, isBuy)
  const usedOrExhaustedStepIdxs = new Set<number>()
  const usedPrices = new Set<string>()
  const exhaustedInvalidSteps = new Map<number, { price: number; reason: string }>()
  const remaps: Array<{ fromStepIdx: number; fromPrice: number; toStepIdx: number; toPrice: number; reason: string }> = []

  // Skip steps/prices already persisted (re-dispatch / deferred rematerialize).
  const existingSteps = await loadExistingRangeStepIndices(
    ctx.supabase,
    signal.id,
    broker.id,
    symbol,
  )
  if (existingSteps.size > 0) {
    for (const stepIdx of existingSteps) usedOrExhaustedStepIdxs.add(stepIdx)
    const { data: existingRows } = await ctx.supabase
      .from('range_pending_legs')
      .select('step_idx, trigger_price, status')
      .eq('signal_id', signal.id)
      .eq('broker_account_id', broker.id)
      .eq('symbol', symbol)
      .limit(500)
    for (const row of existingRows ?? []) {
      const tp = Number((row as { trigger_price?: number }).trigger_price)
      if (Number.isFinite(tp) && tp > 0) {
        usedPrices.add(snapPriceToSymbolGrid(tp, point, ladder.digits).toFixed(ladder.digits))
      }
    }
    const remaining = coalescedLegs.filter(l => !existingSteps.has(l.stepIdx))
    if (remaining.length === 0) {
      console.log(
        `[tradeExecutor] broker range pending: all ${existingSteps.size} step(s) already exist`
        + ` signal=${signal.id} broker=${broker.id}`,
      )
      return true
    }
    console.log(
      `[tradeExecutor] broker range pending: skipping ${existingSteps.size} existing step(s),`
      + ` placing ${remaining.length} remaining signal=${signal.id} broker=${broker.id}`,
    )
  }

  const insertRows: Record<string, unknown>[] = []
  const placedTickets: Array<{ ticket: number; row: Record<string, unknown> }> = []

  const pickNextCandidate = (): RangePendingCandidate | null => {
    const tryCount = Math.max(1, candidates.length)
    for (let n = 0; n < tryCount; n++) {
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
          usedPrices.add(snapPriceToSymbolGrid(skipped.price, point, ladder.digits).toFixed(ladder.digits))
        }
        const c = next.candidate
        if (!c) return null
        const key = snapPriceToSymbolGrid(c.price, point, ladder.digits).toFixed(ladder.digits)
        if (usedPrices.has(key)) {
          usedOrExhaustedStepIdxs.add(c.stepIdx)
          continue
        }
        return c
      }
      const c = candidates.find(x => {
        if (usedOrExhaustedStepIdxs.has(x.stepIdx)) return false
        const key = snapPriceToSymbolGrid(x.price, point, ladder.digits).toFixed(ladder.digits)
        return !usedPrices.has(key)
      }) ?? null
      return c
    }
    return null
  }

  const legsToPlace = existingSteps.size > 0
    ? coalescedLegs.filter(l => !existingSteps.has(l.stepIdx))
    : coalescedLegs

  for (const v of legsToPlace) {
    const plannedStepIdx = v.stepIdx
    const plannedPrice = snapPriceToSymbolGrid(
      triggerMap.get(plannedStepIdx)
        ?? triggerPriceFor({
          stepIdx: plannedStepIdx,
          stepPriceOffset: v.stepPriceOffset,
          isBuy: v.isBuy,
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

      const pick = pickNextCandidate()
      if (!pick) break

      const limitPx = snapPriceToSymbolGrid(pick.price, point, ladder.digits)
      const priceKey = limitPx.toFixed(ladder.digits)
      if (usedPrices.has(priceKey) || usedOrExhaustedStepIdxs.has(pick.stepIdx)) {
        usedOrExhaustedStepIdxs.add(pick.stepIdx)
        continue
      }

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
            usedPrices.add(priceKey)
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
            usedPrices.add(priceKey)
            break
          }
        }

        const ticket = result.ticket
        if (ticket == null || !Number.isFinite(Number(ticket)) || Number(ticket) <= 0) {
          console.warn(
            `[tradeExecutor] broker range pending missing ticket signal=${signal.id} step=${pick.stepIdx}`,
          )
          usedOrExhaustedStepIdxs.add(pick.stepIdx)
          usedPrices.add(priceKey)
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
        usedPrices.add(priceKey)
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
          usedPrices.add(priceKey)
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
        usedPrices.add(priceKey)
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
