"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTI_TRADE_ABS_MAX_LEGS = void 0;
exports.computeMultiTradeOrderCount = computeMultiTradeOrderCount;
/** Hard cap aligned with planner + AccountConfig preview. */
exports.MULTI_TRADE_ABS_MAX_LEGS = 500;
const multiTradeLegUnits_1 = require("./multiTradeLegUnits");
const resolveRangeLayerStepPips_1 = require("./resolveRangeLayerStepPips");
/**
 * Mirrors `src/lib/estimateMultiTradeOrders.ts` — Total Open Trades =
 * immediate + activePending (distance/step capped, or full reserved with Auto / signal range).
 */
function computeMultiTradeOrderCount(args) {
    const minLot = args.minLot ?? 0.01;
    const lotStep = args.lotStep ?? 0.01;
    const legPct = Math.max(0.1, Math.min(100, Number(args.legPercent ?? 5)));
    const manualLot = Number(args.manualLot);
    if (!Number.isFinite(manualLot) || manualLot <= 0)
        return 0;
    const { manualUnits, targetUnits, minUnits } = (0, multiTradeLegUnits_1.resolveMultiTradeTargetUnits)({
        manualLot,
        legPercent: legPct,
        minLot,
        lotStep,
    });
    if (targetUnits < minUnits || manualUnits < minUnits)
        return 1;
    const baseLegs = Math.max(1, Math.min(exports.MULTI_TRADE_ABS_MAX_LEGS, Math.floor(manualUnits / targetUnits)));
    const remainderUnits = manualUnits - baseLegs * targetUnits;
    const signalRange = args.useSignalEntryRange === true;
    if (args.rangeTrading
        && (signalRange
            || (Number.isFinite(args.rangeDistancePips) && (args.rangeDistancePips ?? 0) > 0))) {
        const pct = Math.max(0, Math.min(100, Number(args.rangePercent ?? 0)));
        const pending = Math.max(0, Math.round((baseLegs * pct) / 100));
        const immediate = Math.max(0, baseLegs - pending);
        if (signalRange) {
            return Math.min(exports.MULTI_TRADE_ABS_MAX_LEGS, immediate + pending);
        }
        const resolved = (0, resolveRangeLayerStepPips_1.resolveRangeLayerStepPips)({
            stepPips: Number(args.rangeStepPips ?? 0),
            distPips: Number(args.rangeDistancePips ?? 0),
            reservedLegs: pending,
            forceAuto: args.forceAutoStep === true,
        });
        if (!resolved)
            return Math.min(exports.MULTI_TRADE_ABS_MAX_LEGS, immediate);
        const activePending = resolved.auto
            ? resolved.fittedLegs
            : Math.min(pending, Math.max(0, Math.floor((args.rangeDistancePips ?? 0) / resolved.effectiveStepPips)));
        return Math.min(exports.MULTI_TRADE_ABS_MAX_LEGS, immediate + activePending);
    }
    const extraRemainderLeg = remainderUnits >= minUnits && baseLegs < exports.MULTI_TRADE_ABS_MAX_LEGS;
    return Math.min(exports.MULTI_TRADE_ABS_MAX_LEGS, baseLegs + (extraRemainderLeg ? 1 : 0));
}
