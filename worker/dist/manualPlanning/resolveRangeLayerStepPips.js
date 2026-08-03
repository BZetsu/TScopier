"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_AUTO_RANGE_STEP_PIPS = void 0;
exports.resolveRangeLayerStepPips = resolveRangeLayerStepPips;
/** Never pack Auto layers tighter than this many pips (avoids micro-step floods). */
exports.MIN_AUTO_RANGE_STEP_PIPS = 1;
/**
 * Resolve layering step in pips.
 *
 * - Manual: stepPips > 0 → use as-is (caller may still distance-cap legs).
 * - Auto (stepPips ≤ 0 or forceAuto): space reserved legs evenly across distance,
 *   but never below {@link MIN_AUTO_RANGE_STEP_PIPS}. When reserved would force a
 *   tighter step, `fittedLegs` is reduced so spacing stays ≥ the minimum.
 */
function resolveRangeLayerStepPips(args) {
    const dist = Number(args.distPips);
    const reserved = Math.max(0, Math.floor(Number(args.reservedLegs) || 0));
    if (!Number.isFinite(dist) || dist <= 0 || reserved <= 0)
        return null;
    const rawStep = Number(args.stepPips);
    const auto = args.forceAuto === true || !Number.isFinite(rawStep) || rawStep <= 0;
    if (!auto) {
        return { effectiveStepPips: rawStep, auto: false, fittedLegs: reserved };
    }
    let fittedLegs = reserved;
    let effectiveStepPips = dist / reserved;
    if (effectiveStepPips < exports.MIN_AUTO_RANGE_STEP_PIPS) {
        fittedLegs = Math.min(reserved, Math.max(0, Math.floor(dist / exports.MIN_AUTO_RANGE_STEP_PIPS)));
        if (fittedLegs <= 0)
            return null;
        effectiveStepPips = dist / fittedLegs;
    }
    return { effectiveStepPips, auto: true, fittedLegs };
}
