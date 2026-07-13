"use strict";
/** Distance-scaled concurrent virtual layer firing (pure helpers). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MAX_LAYER_FIRES_PER_TICK = void 0;
exports.adverseDistanceFromAnchor = adverseDistanceFromAnchor;
exports.stepPriceOffsetForBasket = stepPriceOffsetForBasket;
exports.rungsFromAdverseDistance = rungsFromAdverseDistance;
exports.computeLayerFireBudget = computeLayerFireBudget;
exports.isLegEligibleByDistance = isLegEligibleByDistance;
exports.isLayerTriggered = isLayerTriggered;
exports.highestFiredStepIdxForBasket = highestFiredStepIdxForBasket;
exports.selectLegsForLayerTick = selectLegsForLayerTick;
exports.selectPendingLegsForDistanceBurst = selectPendingLegsForDistanceBurst;
exports.newLayersForTick = newLayersForTick;
exports.selectLegsForDistanceBurst = selectLegsForDistanceBurst;
exports.isDistanceBurstFillAllowed = isDistanceBurstFillAllowed;
exports.DEFAULT_MAX_LAYER_FIRES_PER_TICK = 3;
/** Adverse move from fill anchor in price units (0 when price has not moved adversely). */
function adverseDistanceFromAnchor(isBuy, anchor, bid, ask) {
    if (!Number.isFinite(anchor) || anchor <= 0)
        return 0;
    if (!Number.isFinite(bid) || !Number.isFinite(ask))
        return 0;
    if (isBuy)
        return Math.max(0, anchor - bid);
    return Math.max(0, ask - anchor);
}
/** Derive one-step price offset from materialized pending rows in a basket. */
function stepPriceOffsetForBasket(legs) {
    if (!legs.length)
        return null;
    const isBuy = legs[0].is_buy;
    let best = null;
    for (const leg of legs) {
        const anchor = Number(leg.anchor_price);
        const trigger = Number(leg.trigger_price);
        const stepIdx = Number(leg.step_idx);
        if (!Number.isFinite(anchor) || anchor <= 0)
            continue;
        if (!Number.isFinite(trigger) || trigger <= 0)
            continue;
        if (!Number.isFinite(stepIdx) || stepIdx <= 0)
            continue;
        const span = isBuy ? anchor - trigger : trigger - anchor;
        if (!Number.isFinite(span) || span <= 0)
            continue;
        const offset = span / stepIdx;
        if (!Number.isFinite(offset) || offset <= 0)
            continue;
        const rounded = Number(offset.toFixed(8));
        if (best == null || rounded < best)
            best = rounded;
    }
    return best;
}
/** Floor distance/step with tolerance for broker price rounding. */
function rungsFromAdverseDistance(dist, stepPriceOffset) {
    const offset = Math.max(0, stepPriceOffset);
    if (offset <= 0 || dist <= 0)
        return 0;
    const raw = dist / offset;
    const nearest = Math.round(raw);
    if (Math.abs(raw - nearest) < 1e-6)
        return Math.max(0, nearest);
    return Math.max(0, Math.floor(raw + 1e-9));
}
/**
 * How many ladder rungs may fire from cumulative adverse distance alone.
 * Returns 0 when step offset is unknown or distance is below one step.
 */
function computeLayerFireBudget(args) {
    const offset = Math.max(0, args.stepPriceOffset);
    if (offset <= 0)
        return args.anyTriggered ? 1 : 0;
    const dist = adverseDistanceFromAnchor(args.isBuy, args.anchor, args.bid, args.ask);
    const fromDist = rungsFromAdverseDistance(dist, offset);
    if (fromDist >= 1)
        return fromDist;
    return args.anyTriggered ? 1 : 0;
}
/** True when adverse distance from anchor reaches this rung (step N needs dist >= N × step). */
function isLegEligibleByDistance(isBuy, anchor, bid, ask, stepIdx, stepPriceOffset) {
    if (!Number.isFinite(stepIdx) || stepIdx < 1)
        return false;
    const offset = Math.max(0, stepPriceOffset);
    if (offset <= 0)
        return false;
    const budget = rungsFromAdverseDistance(adverseDistanceFromAnchor(isBuy, anchor, bid, ask), offset);
    return budget >= stepIdx;
}
/** Buy ladder fires when bid <= trigger; sell when ask >= trigger. */
function isLayerTriggered(isBuy, triggerPrice, bid, ask) {
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0)
        return false;
    if (!Number.isFinite(bid) || !Number.isFinite(ask))
        return false;
    return isBuy ? bid <= triggerPrice : ask >= triggerPrice;
}
/** Max step_idx already fired for a basket (0 when none). */
function highestFiredStepIdxForBasket(firedStepIndices) {
    let max = 0;
    for (const raw of firedStepIndices) {
        const s = Math.floor(Number(raw));
        if (Number.isFinite(s) && s > max)
            max = s;
    }
    return max;
}
/**
 * Select pending legs to fire this tick: trigger cross + distance ceiling,
 * shallowest first, capped per tick (catch-up burst when multiple triggers crossed).
 */
function selectLegsForLayerTick(args) {
    const stepOffset = Math.max(0, args.stepPriceOffset);
    const maxFires = Math.max(1, Math.floor(args.maxFiresPerTick ?? exports.DEFAULT_MAX_LAYER_FIRES_PER_TICK));
    const minStep = Math.max(0, Math.floor(args.highestFiredStepIdx ?? 0));
    if (!args.pendingLegs.length || stepOffset <= 0)
        return [];
    const budget = computeLayerFireBudget({
        isBuy: args.isBuy,
        anchor: args.anchor,
        bid: args.bid,
        ask: args.ask,
        stepPriceOffset: stepOffset,
    });
    if (budget <= 0)
        return [];
    return args.pendingLegs
        .filter(leg => {
        if (leg.step_idx <= minStep || leg.step_idx > budget)
            return false;
        if (!isLayerTriggered(args.isBuy, leg.trigger_price, args.bid, args.ask))
            return false;
        return isLegEligibleByDistance(args.isBuy, args.anchor, args.bid, args.ask, leg.step_idx, stepOffset);
    })
        .sort((a, b) => a.step_idx - b.step_idx || a.id.localeCompare(b.id))
        .slice(0, maxFires);
}
/** Pending legs whose step_idx fits the distance budget (shallowest first). */
function selectPendingLegsForDistanceBurst(args) {
    const budget = Math.max(0, Math.floor(args.budget));
    const minStep = Math.max(0, Math.floor(args.highestFiredStepIdx ?? 0));
    if (budget <= 0 || args.pendingLegs.length === 0)
        return [];
    return args.pendingLegs
        .filter(leg => leg.step_idx >= 1 && leg.step_idx > minStep && leg.step_idx <= budget)
        .sort((a, b) => a.step_idx - b.step_idx || a.id.localeCompare(b.id));
}
/** Steps in (highestFiredStepIdx, budget] — convenience for per-tick new layers. */
function newLayersForTick(budget, highestFiredStepIdx) {
    const lo = Math.max(0, Math.floor(highestFiredStepIdx));
    const hi = Math.max(0, Math.floor(budget));
    if (hi <= lo)
        return [];
    const out = [];
    for (let s = lo + 1; s <= hi; s++)
        out.push(s);
    return out;
}
/** @deprecated Use selectPendingLegsForDistanceBurst — kept for callers passing pre-filtered triggered legs. */
function selectLegsForDistanceBurst(args) {
    return selectPendingLegsForDistanceBurst({ pendingLegs: args.triggeredLegs, budget: args.budget });
}
/** Market fill allowed for distance burst: distance-qualified and not worse than slippage above rung. */
function isDistanceBurstFillAllowed(args) {
    if (!isLegEligibleByDistance(args.isBuy, args.anchor, args.bid, args.ask, args.stepIdx, args.stepPriceOffset)) {
        return { ok: false, reason: 'distance_not_eligible' };
    }
    const { isBuy, triggerPrice, bid, ask, slippagePoints, point } = args;
    if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
        return { ok: false, reason: 'invalid_trigger' };
    }
    if (point == null || !(point > 0))
        return { ok: true };
    const tol = Math.max(2, Math.max(0, slippagePoints)) * point;
    const fillSide = isBuy ? ask : bid;
    if (isBuy) {
        if (fillSide > triggerPrice + tol)
            return { ok: false, reason: 'fill_outside_trigger_band' };
    }
    else if (fillSide < triggerPrice - tol) {
        return { ok: false, reason: 'fill_outside_trigger_band' };
    }
    return { ok: true };
}
