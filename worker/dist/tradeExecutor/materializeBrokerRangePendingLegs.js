"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializeBrokerRangePendingLegs = materializeBrokerRangePendingLegs;
const rangeLayerTriggers_1 = require("../manualPlanning/rangeLayerTriggers");
const helpers_1 = require("./helpers");
const brokerRangeLadderPricing_1 = require("./brokerRangeLadderPricing");
/**
 * Place broker BuyLimit/SellLimit for each planned range ladder leg and persist
 * rows in `range_pending_legs` with status `broker_pending`.
 */
async function materializeBrokerRangePendingLegs(ctx, prep, strictBrokerPlaced, opts) {
    const { signal, broker, api, uuid, symbol, virtualPendings, params, plan, liveEntryFast, strictDeferred, } = prep;
    if (!api || virtualPendings.length === 0)
        return false;
    const anchor = opts?.anchor ?? prep.anchor;
    const anchorSource = opts?.anchorSource ?? prep.anchorSource;
    if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) {
        console.warn(`[tradeExecutor] dropping ${virtualPendings.length} broker range pendings: no anchor signal=${signal.id} broker=${broker.id} symbol=${symbol}`);
        return false;
    }
    const digits = Math.max(0, Math.min(8, Number(params?.digits) || 5));
    const ladder = (0, brokerRangeLadderPricing_1.resolveBrokerRangeLadderPricing)({
        symbol,
        rangeLayering: plan.rangeLayering,
        params,
    });
    if (!ladder) {
        console.warn(`[tradeExecutor] broker range pending: invalid ladder config signal=${signal.id} broker=${broker.id} symbol=${symbol}`);
        return false;
    }
    const signalRangeBoundary = plan.rangeLayering?.signalRangeBoundary ?? null;
    const signalZoneLo = plan.rangeLayering?.signalZoneLo ?? null;
    const signalZoneHi = plan.rangeLayering?.signalZoneHi ?? null;
    const useSignalEntryRange = plan.rangeLayering?.useSignalEntryRange === true;
    const nowMs = Date.now();
    const insertRows = [];
    const placedTickets = [];
    const pendingLegsForMap = virtualPendings.map((v, i) => ({
        stepIdx: (0, brokerRangeLadderPricing_1.brokerRangeStepIdxForLeg)(i, ladder.maxStepIdx),
        stepPriceOffset: ladder.stepPriceOffset,
        isBuy: plan.isBuy ?? v.isBuy,
    }));
    const triggerMap = (0, rangeLayerTriggers_1.buildRangeLayerTriggerMap)({
        virtualPendings: pendingLegsForMap,
        anchor,
        digits: ladder.digits,
        rangeLayering: plan.rangeLayering ?? null,
        pip: ladder.pip,
    });
    for (let i = 0; i < virtualPendings.length; i++) {
        const v = virtualPendings[i];
        const stepIdx = (0, brokerRangeLadderPricing_1.brokerRangeStepIdxForLeg)(i, ladder.maxStepIdx);
        const legForPrice = {
            ...v,
            stepIdx,
            stepPriceOffset: ladder.stepPriceOffset,
            isBuy: plan.isBuy ?? v.isBuy,
        };
        const triggerPrice = triggerMap.get(stepIdx) ?? (0, helpers_1.triggerPriceFor)(legForPrice, anchor, ladder.digits);
        if (!(0, helpers_1.virtualPendingTriggerAllowed)({
            triggerPrice,
            signalRangeBoundary,
            isBuy: legForPrice.isBuy,
            stopsZoneLo: null,
            stopsZoneHi: null,
            signalZoneLo,
            signalZoneHi,
            useSignalEntryRange,
        })) {
            continue;
        }
        const pendingOp = legForPrice.isBuy ? 'BuyLimit' : 'SellLimit';
        const limitPx = (0, brokerRangeLadderPricing_1.snapPriceToSymbolGrid)(triggerPrice, ladder.point, ladder.digits);
        const vol = (0, helpers_1.roundLot)(v.volume, params);
        const sendArgs = {
            symbol,
            operation: pendingOp,
            volume: vol,
            price: limitPx,
            stoploss: v.stoploss ?? 0,
            takeprofit: v.cweClosePrice != null ? 0 : (v.takeprofit ?? 0),
            slippage: v.slippage ?? 20,
            comment: v.comment ?? '',
            expertID: v.expertID ?? 909090,
        };
        const clamped = (0, helpers_1.clampOrderStops)(sendArgs, params);
        if (clamped.adjustments.length > 0) {
            console.warn(`[tradeExecutor] broker range pending stops clamped signal=${signal.id} step=${stepIdx}: ${clamped.adjustments.join(', ')}`);
        }
        try {
            let result;
            try {
                result = await api.orderSend(uuid, clamped.args);
            }
            catch (sendErr) {
                const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
                const isInvalidStops = /invalid\s+stops/i.test(msg);
                const hasStops = (Number(clamped.args.stoploss) || 0) > 0
                    || (Number(clamped.args.takeprofit) || 0) > 0;
                if (isInvalidStops && hasStops) {
                    result = await api.orderSend(uuid, { ...clamped.args, stoploss: 0, takeprofit: 0 });
                }
                else {
                    console.warn(`[tradeExecutor] broker range pending rejected signal=${signal.id} step=${stepIdx} op=${pendingOp} price=${limitPx}: ${msg}`);
                    continue;
                }
            }
            const ticket = result.ticket;
            if (ticket == null || !Number.isFinite(Number(ticket)) || Number(ticket) <= 0) {
                console.warn(`[tradeExecutor] broker range pending missing ticket signal=${signal.id} step=${stepIdx}`);
                continue;
            }
            const expiresAt = v.expiryHours && v.expiryHours > 0
                ? new Date(nowMs + v.expiryHours * 60 * 60 * 1000).toISOString()
                : null;
            const row = {
                signal_id: signal.id,
                user_id: signal.user_id,
                broker_account_id: broker.id,
                metaapi_account_id: uuid,
                symbol,
                step_idx: stepIdx,
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
            };
            insertRows.push(row);
            placedTickets.push({ ticket: Number(ticket), row });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[tradeExecutor] broker range pending OrderSend failed signal=${signal.id} step=${stepIdx}: ${msg}`);
        }
    }
    if (insertRows.length === 0)
        return false;
    const persistLabel = `broker range pending signal=${signal.id} broker=${broker.id}`;
    const persist = await ctx.persistRangePendingLegRows(insertRows, persistLabel);
    if (!persist.ok) {
        console.error(`[tradeExecutor] broker range_pending_legs persist failed signal=${signal.id} broker=${broker.id}: ${persist.lastError ?? 'unknown'}`);
        for (const { ticket } of placedTickets) {
            try {
                await api.orderClose(uuid, { ticket });
            }
            catch { /* best-effort rollback */ }
        }
        if (!liveEntryFast) {
            try {
                await ctx.supabase.from('trade_execution_logs').insert({
                    user_id: signal.user_id,
                    signal_id: signal.id,
                    broker_account_id: broker.id,
                    action: 'range_broker_pending_failed',
                    status: 'failed',
                    request_payload: { rows: insertRows.length, anchor, anchorSource },
                    error_message: persist.lastError ?? 'unknown',
                });
            }
            catch { /* best-effort */ }
        }
        return false;
    }
    console.log(`[tradeExecutor] broker range pendings inserted=${insertRows.length} signal=${signal.id} broker=${broker.id} symbol=${symbol} anchor=${anchor} (${anchorSource}) step_pips=${ladder.stepPips} dist_pips=${ladder.distPips} max_step_idx=${ladder.maxStepIdx} step_offset=${ladder.stepPriceOffset}`);
    try {
        await ctx.supabase.from('trade_execution_logs').insert({
            user_id: signal.user_id,
            signal_id: signal.id,
            broker_account_id: broker.id,
            action: 'range_broker_pending_inserted',
            status: 'success',
            request_payload: {
                rows: insertRows.length,
                anchor,
                anchorSource,
                symbol,
                stepIdxs: insertRows.map(r => r.step_idx),
                triggers: insertRows.map(r => r.trigger_price),
                tickets: insertRows.map(r => r.ticket),
                range_layering: plan.rangeLayering ?? null,
                ladder_pricing: ladder,
                strict_deferred: strictDeferred,
                strict_broker_pending: strictBrokerPlaced,
                layering_type: 'pending_order',
            },
        });
    }
    catch { /* best-effort */ }
    return true;
}
