"use strict";
/**
 * Reconcile DB `trades.status = 'open'` against live broker positions.
 * Closes rows whose ticket no longer appears in /OpenedOrders (TP/SL/manual close).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findGhostOpenTradeIds = findGhostOpenTradeIds;
exports.reconcileOpenTradesForBroker = reconcileOpenTradesForBroker;
const basketSlTpReconcile_1 = require("./basketSlTpReconcile");
const rangePendingLegDelete_1 = require("./rangePendingLegDelete");
/** Open DB legs whose ticket is valid but absent from the broker snapshot. */
function findGhostOpenTradeIds(openTrades, brokerTickets) {
    const ghostIds = [];
    for (const trade of openTrades) {
        const ticket = Number(trade.metaapi_order_id);
        if (!Number.isFinite(ticket) || ticket <= 0)
            continue;
        if (!brokerTickets.has(ticket))
            ghostIds.push(trade.id);
    }
    return ghostIds;
}
function basketScopesForGhosts(openTrades, ghostIds) {
    const ghostSet = new Set(ghostIds);
    const scopes = new Map();
    for (const trade of openTrades) {
        if (!ghostSet.has(trade.id))
            continue;
        const signalId = trade.signal_id;
        const brokerAccountId = trade.broker_account_id;
        if (!signalId || !brokerAccountId)
            continue;
        scopes.set(`${signalId}|${brokerAccountId}`, { signalId, brokerAccountId });
    }
    return [...scopes.values()];
}
async function reconcileOpenTradesForBroker(supabase, api, metaapiAccountId, openTrades) {
    if (!openTrades.length)
        return 0;
    const brokerTickets = await (0, basketSlTpReconcile_1.fetchOpenBrokerTicketsStrict)(api, metaapiAccountId);
    // SAFETY: an empty (but successful) OpenedOrders snapshot usually means the
    // FxSocket session is disconnected — never mass-mark every open row closed.
    if (brokerTickets.size === 0 && openTrades.length > 0) {
        console.warn(`[openTradeReconcile] empty OpenedOrders with ${openTrades.length} tracked open trade(s)`
            + ` account=${metaapiAccountId} — deferring ghost close (suspected disconnect)`);
        return 0;
    }
    const ghostIds = findGhostOpenTradeIds(openTrades, brokerTickets);
    if (!ghostIds.length)
        return 0;
    const closed = await (0, basketSlTpReconcile_1.closeStaleOpenTrades)(supabase, ghostIds);
    if (closed > 0) {
        const scopes = basketScopesForGhosts(openTrades, ghostIds);
        if (scopes.length) {
            await (0, rangePendingLegDelete_1.purgeRangePendingLegsForBaskets)(supabase, scopes, 'basket_flat_reconcile');
        }
    }
    return closed;
}
