"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideLadderFires = decideLadderFires;
exports.fireLadderLegs = fireLadderLegs;
function decideLadderFires(args) {
    if (args.frozen)
        return [];
    const capacity = Math.max(0, args.maxLegs - args.openLegCount);
    if (capacity <= 0)
        return [];
    // Fill side: a buy averages down -> fills at ask; a sell averages up -> fills at bid.
    const px = args.isBuy ? args.ask : args.bid;
    if (!Number.isFinite(px) || px <= 0)
        return [];
    const crossed = args.legs.filter(l => Number.isFinite(l.triggerPrice) && l.triggerPrice > 0
        && (args.isBuy ? px <= l.triggerPrice : px >= l.triggerPrice));
    // Shallowest rungs first (closest trigger), so we fill the ladder in order.
    crossed.sort((a, b) => a.stepIdx - b.stepIdx);
    const limit = Math.min(capacity, args.maxFiresPerTick ?? 3);
    return crossed.slice(0, limit);
}
/** Fire the decided legs idempotently through the strict client. */
async function fireLadderLegs(deps, legs) {
    let fired = 0;
    let skipped = 0;
    let failed = 0;
    for (const leg of legs) {
        const claimed = await deps.claim(leg.id).catch(() => false);
        if (!claimed) {
            skipped++;
            continue;
        }
        const result = await deps.fx.orderSend(deps.accountId, deps.platform, {
            symbol: deps.brokerSymbol,
            operation: deps.isBuy ? 'Buy' : 'Sell',
            volume: leg.volume,
            stopLoss: deps.desiredStopLoss ?? undefined,
            takeProfit: deps.desiredTakeProfit ?? undefined,
        }, { anchorSignalId: deps.anchorSignalId, legIndex: leg.stepIdx, preSnapshot: deps.preSnapshot });
        if (result.ok && result.ticket) {
            await deps.onFired(leg.id, result.ticket, result.price, result.volume ?? leg.volume).catch(() => { });
            fired++;
        }
        else if (result.retcodeName === 'AMBIGUOUS') {
            // Could not confirm; do NOT re-fire and do NOT release (avoid duplicate). Leave
            // claimed - the reconciler's orphan adoption will reconcile if it did open.
            failed++;
        }
        else {
            // Definitely not placed -> safe to release for a later tick.
            await deps.release(leg.id).catch(() => { });
            failed++;
        }
    }
    return { fired, skipped, failed };
}
