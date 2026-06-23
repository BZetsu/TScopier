"use strict";
/**
 * Relative range layering: each rung is step pips from the last open fill,
 * not a fixed ladder from signal entry.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rangeLayerRelativeStepEnabled = rangeLayerRelativeStepEnabled;
exports.stepPriceOffsetFromPips = stepPriceOffsetFromPips;
exports.roundLayerPrice = roundLayerPrice;
exports.computeFirstFillAnchor = computeFirstFillAnchor;
exports.resolveLayerReferenceEntry = resolveLayerReferenceEntry;
exports.computeNextLayerTrigger = computeNextLayerTrigger;
exports.resolveEffectiveLayerTriggerPrice = resolveEffectiveLayerTriggerPrice;
exports.adverseMoveReached = adverseMoveReached;
exports.inactiveLayerTrigger = inactiveLayerTrigger;
exports.isInactiveLayerTrigger = isInactiveLayerTrigger;
exports.resolveEffectiveStepPips = resolveEffectiveStepPips;
exports.buildRelativeMaterializationTriggers = buildRelativeMaterializationTriggers;
exports.refreshPendingLayerTriggersAfterFire = refreshPendingLayerTriggersAfterFire;
exports.layerFillDeltaPips = layerFillDeltaPips;
exports.resolveRangePendingTrigger = resolveRangePendingTrigger;
const signalPip_1 = require("./signalPip");
function rangeLayerRelativeStepEnabled() {
    const v = String(process.env.RANGE_LAYER_RELATIVE_STEP ?? 'true').toLowerCase().trim();
    return v !== '0' && v !== 'false' && v !== 'no';
}
function stepPriceOffsetFromPips(stepPips, pip) {
    if (!Number.isFinite(stepPips) || stepPips <= 0 || !Number.isFinite(pip) || pip <= 0)
        return 0;
    return stepPips * pip;
}
function roundLayerPrice(price, digits) {
    const d = Math.max(0, Math.min(8, Math.floor(digits)));
    return Number(price.toFixed(d));
}
/** VWAP of immediate fills — ladder anchor. */
function computeFirstFillAnchor(fills) {
    let totalLots = 0;
    let weighted = 0;
    for (const f of fills) {
        const px = Number(f.entryPrice);
        const lots = Number(f.lot_size ?? 1);
        if (!Number.isFinite(px) || px <= 0)
            continue;
        const w = Number.isFinite(lots) && lots > 0 ? lots : 1;
        totalLots += w;
        weighted += px * w;
    }
    if (totalLots <= 0)
        return null;
    return weighted / totalLots;
}
/**
 * Reference entry for next layer: worst price in the adverse direction
 * (sell → highest entry, buy → lowest entry).
 */
function resolveLayerReferenceEntry(openTrades, isBuy) {
    let ref = null;
    for (const t of openTrades) {
        const px = Number(t.entry_price);
        if (!Number.isFinite(px) || px <= 0)
            continue;
        if (ref == null) {
            ref = px;
            continue;
        }
        ref = isBuy ? Math.min(ref, px) : Math.max(ref, px);
    }
    return ref;
}
function computeNextLayerTrigger(args) {
    const { isBuy, lastEntryPrice, stepPriceOffset, digits } = args;
    const dir = isBuy ? -1 : 1;
    return roundLayerPrice(lastEntryPrice + dir * stepPriceOffset, digits);
}
/** Live trigger for a pending leg (relative step from worst open fill, else planned row). */
function resolveEffectiveLayerTriggerPrice(args) {
    if (!args.relativeMode)
        return args.plannedTrigger;
    const ref = args.lastEntry ?? (args.anchorPrice > 0 ? args.anchorPrice : null);
    if (ref != null && args.stepPriceOffset > 0) {
        return computeNextLayerTrigger({
            isBuy: args.isBuy,
            lastEntryPrice: ref,
            stepPriceOffset: args.stepPriceOffset,
            digits: args.digits,
        });
    }
    if (isInactiveLayerTrigger(args.isBuy, args.plannedTrigger)) {
        return args.plannedTrigger;
    }
    return args.plannedTrigger;
}
/** True when live quote has moved step pips against the position from lastEntry. */
function adverseMoveReached(args) {
    const { isBuy, lastEntry, stepPriceOffset, bid, ask } = args;
    if (!(stepPriceOffset > 0) || !(lastEntry > 0))
        return false;
    if (isBuy) {
        return Number.isFinite(bid) && bid <= lastEntry - stepPriceOffset;
    }
    return Number.isFinite(ask) && ask >= lastEntry + stepPriceOffset;
}
/** Placeholder trigger so deeper rungs do not fire until refreshed after a fill. */
function inactiveLayerTrigger(isBuy) {
    return isBuy ? 1e-9 : 1e12;
}
function isInactiveLayerTrigger(isBuy, triggerPrice) {
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0)
        return true;
    return isBuy ? triggerPrice <= 1e-6 : triggerPrice >= 1e9;
}
function resolveEffectiveStepPips(manual, rangeLayering, symbol) {
    const pip = (0, signalPip_1.signalPipPrice)(symbol);
    const configured = Number(manual?.range_step_pips ?? rangeLayering?.rangeStepPips ?? 0);
    const effective = Number(rangeLayering?.effectiveStepPips ?? configured);
    const stepPips = effective > 0 ? effective : (configured > 0 ? configured : 0);
    return { stepPips, pip, stepPriceOffset: stepPriceOffsetFromPips(stepPips, pip) };
}
function buildRelativeMaterializationTriggers(args) {
    const out = new Map();
    const sorted = [...args.stepIndices].sort((a, b) => a - b);
    for (const stepIdx of sorted) {
        if (stepIdx === sorted[0]) {
            out.set(stepIdx, computeNextLayerTrigger({
                isBuy: args.isBuy,
                lastEntryPrice: args.anchor,
                stepPriceOffset: args.stepPriceOffset,
                digits: args.digits,
            }));
        }
        else {
            out.set(stepIdx, inactiveLayerTrigger(args.isBuy));
        }
    }
    return out;
}
async function refreshPendingLayerTriggersAfterFire(supabase, args) {
    const { data, error } = await supabase
        .from('range_pending_legs')
        .select('id, step_idx')
        .eq('signal_id', args.signalId)
        .eq('broker_account_id', args.brokerAccountId)
        .eq('symbol', args.symbol)
        .eq('status', 'pending')
        .order('step_idx', { ascending: true });
    if (error || !data?.length)
        return 0;
    const { data: openRows, error: openErr } = await supabase
        .from('trades')
        .select('entry_price')
        .eq('signal_id', args.signalId)
        .eq('broker_account_id', args.brokerAccountId)
        .eq('status', 'open');
    const openTrades = [];
    if (!openErr && openRows?.length) {
        for (const row of openRows) {
            const px = Number(row.entry_price);
            if (Number.isFinite(px) && px > 0)
                openTrades.push({ entry_price: px });
        }
    }
    if (!openTrades.some(t => Math.abs(t.entry_price - args.newFillPrice) < 1e-9)) {
        openTrades.push({ entry_price: args.newFillPrice });
    }
    const referenceEntry = resolveLayerReferenceEntry(openTrades, args.isBuy) ?? args.newFillPrice;
    const nextTrigger = computeNextLayerTrigger({
        isBuy: args.isBuy,
        lastEntryPrice: referenceEntry,
        stepPriceOffset: args.stepPriceOffset,
        digits: args.digits,
    });
    let updated = 0;
    const shallowest = data[0];
    if (shallowest) {
        const { error: upErr } = await supabase
            .from('range_pending_legs')
            .update({
            trigger_price: nextTrigger,
            anchor_price: referenceEntry,
            updated_at: new Date().toISOString(),
        })
            .eq('id', shallowest.id)
            .eq('status', 'pending');
        if (!upErr)
            updated += 1;
    }
    for (const row of data.slice(1)) {
        const { error: upErr } = await supabase
            .from('range_pending_legs')
            .update({
            trigger_price: inactiveLayerTrigger(args.isBuy),
            updated_at: new Date().toISOString(),
        })
            .eq('id', row.id)
            .eq('status', 'pending');
        if (!upErr)
            updated += 1;
    }
    return updated;
}
function layerFillDeltaPips(fillPrice, triggerPrice, symbol) {
    return (0, signalPip_1.priceDeltaToPips)(Math.abs(fillPrice - triggerPrice), symbol);
}
function resolveRangePendingTrigger(args) {
    if (!args.relativeMode) {
        const dir = args.virtual.isBuy ? -1 : 1;
        const px = args.anchor + dir * args.virtual.stepIdx * args.virtual.stepPriceOffset;
        return roundLayerPrice(px, args.digits);
    }
    const triggers = buildRelativeMaterializationTriggers({
        anchor: args.anchor,
        isBuy: args.virtual.isBuy,
        stepPriceOffset: args.virtual.stepPriceOffset,
        digits: args.digits,
        stepIndices: args.allStepIndices,
    });
    return triggers.get(args.virtual.stepIdx) ?? inactiveLayerTrigger(args.virtual.isBuy);
}
