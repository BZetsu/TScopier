"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideLadderFires = decideLadderFires;
exports.fireLadderLegs = fireLadderLegs;
const layerConcurrentFire_1 = require("../layerConcurrentFire");
function decideLadderFires(args) {
    if (args.frozen)
        return [];
    const capacity = Math.max(0, args.maxLegs - args.openLegCount);
    if (capacity <= 0)
        return [];
    const stepOffset = args.stepPriceOffset ?? 0;
    const anchor = args.anchor ?? 0;
    if (stepOffset > 0 && Number.isFinite(anchor) && anchor > 0) {
        const budget = (0, layerConcurrentFire_1.computeLayerFireBudget)({
            isBuy: args.isBuy,
            anchor,
            bid: args.bid,
            ask: args.ask,
            stepPriceOffset: stepOffset,
        });
        if (budget <= 0)
            return [];
        const sorted = [...args.legs].sort((a, b) => a.stepIdx - b.stepIdx);
        return sorted.filter(l => l.stepIdx >= 1 && l.stepIdx <= budget).slice(0, capacity);
    }
    // Legacy: trigger-crossing path with fixed per-tick cap.
    const px = args.isBuy ? args.ask : args.bid;
    if (!Number.isFinite(px) || px <= 0)
        return [];
    const crossed = args.legs.filter(l => Number.isFinite(l.triggerPrice) && l.triggerPrice > 0
        && (args.isBuy ? px <= l.triggerPrice : px >= l.triggerPrice));
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
            failed++;
        }
        else {
            await deps.release(leg.id).catch(() => { });
            failed++;
        }
    }
    return { fired, skipped, failed };
}
