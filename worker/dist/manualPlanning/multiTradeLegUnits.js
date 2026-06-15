"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.multiTradeToUnits = multiTradeToUnits;
exports.multiTradeUnitsToLot = multiTradeUnitsToLot;
exports.resolveMultiTradeTargetUnits = resolveMultiTradeTargetUnits;
const FP_EPS = 1e-9;
function multiTradeToUnits(v, lotStep) {
    if (!Number.isFinite(v) || v <= 0)
        return 0;
    return Math.max(0, Math.floor(v / lotStep + FP_EPS));
}
function multiTradeUnitsToLot(units, lotStep) {
    return Number((units * lotStep).toFixed(8));
}
/** Per-leg lot units for multi-trade bursts; clamps to broker min when leg% would be too small. */
function resolveMultiTradeTargetUnits(args) {
    const minLot = args.minLot ?? 0.01;
    const lotStep = args.lotStep ?? 0.01;
    const legPct = Math.max(0.1, Math.min(100, Number(args.legPercent ?? 5)));
    const manualUnits = multiTradeToUnits(args.manualLot, lotStep);
    const minUnits = Math.max(1, Math.round(minLot / lotStep));
    let targetUnits = multiTradeToUnits(args.manualLot * (legPct / 100), lotStep);
    let clampedToMinLeg = false;
    if (targetUnits < minUnits && manualUnits >= minUnits) {
        targetUnits = minUnits;
        clampedToMinLeg = true;
    }
    return { manualUnits, targetUnits, minUnits, clampedToMinLeg };
}
