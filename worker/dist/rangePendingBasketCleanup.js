"use strict";
/**
 * Reconcile flat baskets against the broker (SL/TP hit, manual close on MT)
 * and purge virtual range ladder rows so deeper rungs cannot re-fire.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeRangePendingLegsForBaskets = exports.purgeRangePendingLegsIfBasketFlat = exports.deleteRangePendingLegsForBasket = void 0;
exports.reconcileBasketFlatFromBroker = reconcileBasketFlatFromBroker;
exports.reconcilePendingLegBasketsFromBroker = reconcilePendingLegBasketsFromBroker;
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const rangePendingLegDelete_1 = require("./rangePendingLegDelete");
var rangePendingLegDelete_2 = require("./rangePendingLegDelete");
Object.defineProperty(exports, "deleteRangePendingLegsForBasket", { enumerable: true, get: function () { return rangePendingLegDelete_2.deleteRangePendingLegsForBasket; } });
Object.defineProperty(exports, "purgeRangePendingLegsIfBasketFlat", { enumerable: true, get: function () { return rangePendingLegDelete_2.purgeRangePendingLegsIfBasketFlat; } });
Object.defineProperty(exports, "purgeRangePendingLegsForBaskets", { enumerable: true, get: function () { return rangePendingLegDelete_2.purgeRangePendingLegsForBaskets; } });
/**
 * Close DB "open" legs absent from the broker (SL/TP/manual close), then purge
 * virtual pendings when the basket is flat.
 */
async function reconcileBasketFlatFromBroker(supabase, api, metaapiAccountId, scope) {
    const { data, error } = await supabase
        .from('trades')
        .select('id,status,metaapi_order_id')
        .eq('signal_id', scope.signalId)
        .eq('broker_account_id', scope.brokerAccountId)
        .in('status', ['open', 'pending'])
        .limit(200);
    if (error) {
        console.warn(`[rangePendingBasketCleanup] load trades failed signal=${scope.signalId}: ${error.message}`);
        return null;
    }
    const openRows = (data ?? []);
    if (!openRows.length) {
        await (0, rangePendingLegDelete_1.purgeRangePendingLegsIfBasketFlat)(supabase, scope, 'signal_closed');
        return 'signal_closed';
    }
    if (!api || !metaapiAccountId)
        return null;
    let brokerTickets;
    try {
        brokerTickets = await (0, basketSlTpReconcile_1.fetchOpenBrokerTicketsStrict)(api, metaapiAccountId);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[rangePendingBasketCleanup] openedOrders failed account=${metaapiAccountId}: ${msg}`);
        return null;
    }
    const family = openRows.map(r => ({
        id: r.id,
        signal_id: scope.signalId,
        metaapi_order_id: r.metaapi_order_id,
        opened_at: '',
        lot_size: 0,
        sl: null,
        tp: null,
        entry_price: null,
        direction: 'buy',
        symbol: '',
    }));
    const { ghost } = (0, basketSlTpReconcile_1.classifyGhostBasketLegs)(family, brokerTickets);
    if (ghost.length) {
        await (0, basketSlTpReconcile_1.closeStaleOpenTrades)(supabase, ghost.map(g => g.id));
    }
    const purged = await (0, rangePendingLegDelete_1.purgeRangePendingLegsIfBasketFlat)(supabase, scope, 'basket_flat_broker');
    if (purged > 0)
        return 'basket_flat_broker';
    const stillOpen = openRows.length - ghost.length;
    return stillOpen > 0 ? null : 'signal_closed';
}
/** Reconcile every unique basket represented in pending leg rows. */
async function reconcilePendingLegBasketsFromBroker(supabase, legs, apiForAccount) {
    const baskets = new Map();
    for (const leg of legs) {
        const key = `${leg.signal_id}|${leg.broker_account_id}`;
        if (!baskets.has(key)) {
            baskets.set(key, {
                signalId: leg.signal_id,
                brokerAccountId: leg.broker_account_id,
                metaapiAccountId: leg.metaapi_account_id,
            });
        }
    }
    let purged = 0;
    for (const basket of baskets.values()) {
        const api = apiForAccount(basket.metaapiAccountId);
        const reason = await reconcileBasketFlatFromBroker(supabase, api, basket.metaapiAccountId, { signalId: basket.signalId, brokerAccountId: basket.brokerAccountId });
        if (reason)
            purged += 1;
    }
    return purged;
}
