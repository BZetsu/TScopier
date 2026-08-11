"use strict";
/**
 * Last-resort SL/TP assign after a naked broker-pending fill when basket
 * TP% rebalance left the new trade still without stops.
 * Prefer syncRangeBasketTakeProfits(forceLayeringRebalance) as the primary path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignNakedBrokerFillStops = assignNakedBrokerFillStops;
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const basketEffectiveStops_1 = require("./basketEffectiveStops");
const orderModifySafe_1 = require("./orderModifySafe");
const rangeBasketTpSync_1 = require("./rangeBasketTpSync");
/**
 * Resolve intended stops (leg row + effective basket) and OrderModify the fill.
 * Updates the trades row when at least one side applies.
 */
async function assignNakedBrokerFillStops(args) {
    const { supabase, api, leg, tradeRowId, ticket, entryPrice, channelId } = args;
    if (!(ticket > 0)) {
        return { ok: false, stoploss: 0, takeprofit: 0, error: 'invalid_ticket' };
    }
    let stoploss = 0;
    let takeprofit = 0;
    try {
        const { data: sigMeta } = await supabase
            .from('signals')
            .select('created_at,parsed_data')
            .eq('id', leg.signal_id)
            .maybeSingle();
        const basketCreatedAt = sigMeta?.created_at ?? null;
        const anchorParsed = (0, rangeBasketTpSync_1.toRangeBasketParsedSlice)(sigMeta?.parsed_data);
        const familyTrades = await (0, basketSlTpReconcile_1.loadOpenBasketLegs)(supabase, leg.broker_account_id, leg.signal_id, leg.symbol);
        const effective = await (0, basketEffectiveStops_1.resolveEffectiveBasketStops)({
            supabase,
            userId: leg.user_id,
            channelId,
            anchorSignalId: leg.signal_id,
            symbol: leg.symbol,
            basketCreatedAt,
            anchorParsed,
            familyTrades,
            brokerAccountId: leg.broker_account_id,
        });
        const firing = (0, rangeBasketTpSync_1.resolveFiringLegStops)({
            legStoploss: leg.stoploss,
            legTakeprofit: leg.takeprofit,
            cweClosePrice: leg.cwe_close_price,
            effective,
            isBuy: leg.is_buy,
        });
        stoploss = firing.stoploss;
        takeprofit = firing.takeprofit;
    }
    catch (err) {
        // Fall back to stops persisted on the pending row at materialize time.
        const curSl = Number(leg.stoploss);
        const curTp = Number(leg.takeprofit);
        stoploss = Number.isFinite(curSl) && curSl > 0 ? curSl : 0;
        takeprofit = leg.cwe_close_price != null
            ? 0
            : (Number.isFinite(curTp) && curTp > 0 ? curTp : 0);
        console.warn(`[brokerPendingFillStops] resolve failed leg=${leg.id}; using row stops`
            + ` sl=${stoploss} tp=${takeprofit}:`
            + ` ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!(stoploss > 0) && !(takeprofit > 0)) {
        return { ok: false, stoploss: 0, takeprofit: 0, error: 'no_stops_resolved' };
    }
    const deepestTp = takeprofit > 0 ? takeprofit : undefined;
    const outcome = await (0, orderModifySafe_1.modifyLegSlTpWithFallback)(api, leg.metaapi_account_id, ticket, stoploss, takeprofit, deepestTp != null ? { deepestTp } : undefined);
    if (!outcome.ok) {
        console.warn(`[brokerPendingFillStops] OrderModify failed leg=${leg.id} ticket=${ticket}`
            + ` sl=${stoploss} tp=${takeprofit}: ${outcome.error ?? 'unknown'}`);
        return {
            ok: false,
            stoploss,
            takeprofit,
            error: outcome.error ?? 'order_modify_failed',
        };
    }
    const dbPatch = {};
    if (outcome.slApplied && outcome.appliedSl > 0)
        dbPatch.sl = outcome.appliedSl;
    if (outcome.tpApplied && outcome.appliedTp > 0)
        dbPatch.tp = outcome.appliedTp;
    if (Object.keys(dbPatch).length > 0) {
        await supabase.from('trades').update(dbPatch).eq('id', tradeRowId);
    }
    console.log(`[brokerPendingFillStops] assigned leg=${leg.id} ticket=${ticket}`
        + ` sl=${outcome.appliedSl || 0} tp=${outcome.appliedTp || 0}`
        + ` mode=${outcome.mode} entry=${entryPrice}`);
    try {
        await supabase.from('trade_execution_logs').insert({
            user_id: leg.user_id,
            signal_id: leg.signal_id,
            broker_account_id: leg.broker_account_id,
            action: 'range_broker_pending_stops_assigned',
            status: 'success',
            request_payload: {
                leg_id: leg.id,
                ticket,
                trade_id: tradeRowId,
                stoploss: outcome.appliedSl || 0,
                takeprofit: outcome.appliedTp || 0,
                mode: outcome.mode,
                naked_fill: true,
            },
        });
    }
    catch { /* best-effort */ }
    return {
        ok: true,
        stoploss: outcome.appliedSl || stoploss,
        takeprofit: outcome.appliedTp || takeprofit,
    };
}
