"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeBasketTargetStops = sanitizeBasketTargetStops;
/**
 * Validate basket-level SL/TP before persisting or sending to the broker.
 */
const channelActiveTradeParams_1 = require("./channelActiveTradeParams");
function sanitizeBasketTargetStops(args) {
    const rejected = [];
    let stoploss = positive(args.stoploss);
    let tpLevels = args.tpLevels.map(t => positive(t)).filter((t) => t != null);
    if (stoploss != null && tpLevels.length > 0) {
        const maxTp = Math.max(...tpLevels);
        const minTp = Math.min(...tpLevels);
        // Common misparse: deepest TP value stored as SL while entry/sell price sits in TP ladder.
        if (stoploss <= maxTp && stoploss >= minTp) {
            rejected.push(`incoherent_sl_within_tp_ladder sl=${stoploss}`);
            stoploss = null;
        }
    }
    const ref = args.referencePrice;
    if (ref != null && ref > 0 && (stoploss != null || tpLevels.length > 0)) {
        const probeSl = stoploss ?? 0;
        const probeTp = tpLevels.length > 0 ? tpLevels[0] : 0;
        const stripped = (0, channelActiveTradeParams_1.stripInvalidStopsForSide)({
            stoploss: probeSl,
            takeprofit: probeTp,
            referencePrice: ref,
            isBuy: args.isBuy,
        });
        if (stoploss != null && stripped.stoploss === 0) {
            rejected.push(`invalid_sl_for_side sl=${stoploss} ref=${ref}`);
            stoploss = null;
        }
        tpLevels = tpLevels.filter(tp => {
            const s = (0, channelActiveTradeParams_1.stripInvalidStopsForSide)({
                stoploss: 0,
                takeprofit: tp,
                referencePrice: ref,
                isBuy: args.isBuy,
            });
            if (s.takeprofit === 0) {
                rejected.push(`invalid_tp_for_side tp=${tp}`);
                return false;
            }
            return true;
        });
    }
    return { stoploss, tpLevels, rejected };
}
function positive(v) {
    const n = typeof v === 'number' ? v : Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : null;
}
