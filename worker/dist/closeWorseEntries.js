"use strict";
/**
 * Close-worse-entries helpers.
 *
 * Auto (cweCloseMonitor): when market reaches anchor ± X pips, tagged immediates
 * (+ optional shallow layers) are closed via a fixed threshold on each row.
 *
 * Telegram (`close_worse_entries` management): at instruction time, close every
 * open basket leg whose entry is within X pips of the live quote.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEntryWithinPipsOfReference = isEntryWithinPipsOfReference;
exports.referencePriceForDirection = referencePriceForDirection;
exports.filterTradesWithinPipsOfReference = filterTradesWithinPipsOfReference;
function isEntryWithinPipsOfReference(entryPrice, referencePrice, pips, pipSize) {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0)
        return false;
    if (!Number.isFinite(referencePrice) || referencePrice <= 0)
        return false;
    if (!Number.isFinite(pips) || pips <= 0)
        return false;
    if (!Number.isFinite(pipSize) || pipSize <= 0)
        return false;
    const band = pips * pipSize;
    return Math.abs(referencePrice - entryPrice) <= band + 1e-12;
}
/** Quote side used to measure distance to entry (bid for longs, ask for shorts). */
function referencePriceForDirection(direction, bid, ask) {
    const isBuy = String(direction).toLowerCase() === 'buy';
    return isBuy ? bid : ask;
}
function filterTradesWithinPipsOfReference(args) {
    const { trades, referencePrice, pips, pipSize } = args;
    return trades.filter(t => {
        if (t.status !== 'open')
            return false;
        const entry = t.entry_price;
        if (entry == null || !Number.isFinite(entry) || entry <= 0)
            return false;
        return isEntryWithinPipsOfReference(entry, referencePrice, pips, pipSize);
    });
}
