"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderRangePendingCandidates = orderRangePendingCandidates;
exports.isBrokerPendingLimitPriceRejectMessage = isBrokerPendingLimitPriceRejectMessage;
exports.nextValidRangePendingPrice = nextValidRangePendingPrice;
const layeringModeBrokerPending_1 = require("./layeringModeBrokerPending");
/**
 * Order ladder rungs shallow → deep (adverse direction).
 * Buy: highest price first (closest below market). Sell: lowest first.
 */
function orderRangePendingCandidates(entries, isBuy) {
    const sorted = entries
        .filter(e => Number.isFinite(e.stepIdx) && Number.isFinite(e.price) && e.price > 0)
        .map(e => ({ stepIdx: Math.floor(e.stepIdx), price: e.price }));
    sorted.sort((a, b) => (isBuy ? b.price - a.price : a.price - b.price));
    return sorted;
}
/** Broker rejected the limit price itself (not SL/TP stops). */
function isBrokerPendingLimitPriceRejectMessage(msg) {
    const m = String(msg ?? '').toLowerCase();
    if (/invalid\s+stops/.test(m))
        return false;
    return (/invalid\s+price/.test(m)
        || /price.*invalid/.test(m)
        || /off\s*quotes/.test(m)
        || /too\s+close/.test(m)
        || /min(?:imum)?\s+distance/.test(m)
        || /not\s+enough\s+distance/.test(m)
        || /invalid\s+request/.test(m));
}
/**
 * Next unused candidate that clears broker min-distance / side rules.
 * Callers should mark `reasonSkipped` steps as exhausted so they are not retried
 * and can be persisted as cancelled footprints.
 */
function nextValidRangePendingPrice(args) {
    const reasonSkipped = [];
    for (const c of args.candidates) {
        if (args.usedOrExhaustedStepIdxs.has(c.stepIdx))
            continue;
        const reason = (0, layeringModeBrokerPending_1.validateBrokerPendingPrice)({
            side: args.side,
            price: c.price,
            bid: args.bid,
            ask: args.ask,
            point: args.point,
            stopsLevel: args.stopsLevel,
            freezeLevel: args.freezeLevel,
        });
        if (reason == null) {
            return { candidate: c, reasonSkipped };
        }
        reasonSkipped.push({ stepIdx: c.stepIdx, price: c.price, reason });
    }
    return { candidate: null, reasonSkipped };
}
