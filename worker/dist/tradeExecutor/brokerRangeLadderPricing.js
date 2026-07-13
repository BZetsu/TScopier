"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBrokerRangeLadderPricing = resolveBrokerRangeLadderPricing;
exports.snapPriceToSymbolGrid = snapPriceToSymbolGrid;
exports.brokerRangeStepIdxForLeg = brokerRangeStepIdxForLeg;
const pipCalculator_1 = require("../pipCalculator");
const signalStopUnits_1 = require("../signalStopUnits");
/** Ladder rungs for broker limits: always user step/distance, never SL/TP min-stop expansion. */
function resolveBrokerRangeLadderPricing(args) {
    const rl = args.rangeLayering;
    if (!rl)
        return null;
    const stepPips = Math.max(0, Number(rl.rangeStepPips ?? 0));
    if (stepPips <= 0)
        return null;
    let distPips = Math.max(0, Number(rl.rangeDistancePips ?? 0));
    if (rl.useSignalEntryRange === true) {
        const zoneDist = Number(rl.effectiveDistancePips ?? 0);
        if (Number.isFinite(zoneDist) && zoneDist > 0)
            distPips = zoneDist;
    }
    if (distPips <= 0)
        return null;
    const point = Number(args.params?.point) || 0;
    const digits = Math.max(0, Math.min(8, Number(args.params?.digits) || 5));
    const pipQuote = (0, pipCalculator_1.pipCalculator)(args.symbol, point, digits, args.params?.contractSize ?? null);
    const pip = (0, signalStopUnits_1.resolvePipSize)({ symbol: args.symbol, brokerPipPrice: pipQuote.pipPrice });
    if (!Number.isFinite(pip) || pip <= 0)
        return null;
    const stepPriceOffset = stepPips * pip;
    const maxStepIdx = Math.max(1, Math.floor(distPips / stepPips));
    return { stepPips, distPips, pip, stepPriceOffset, maxStepIdx, digits, point };
}
function snapPriceToSymbolGrid(price, point, digits) {
    if (Number.isFinite(point) && point > 0) {
        return Number((Math.round(price / point) * point).toFixed(digits));
    }
    return Number(price.toFixed(digits));
}
function brokerRangeStepIdxForLeg(legIndex, maxStepIdx) {
    if (maxStepIdx <= 0)
        return legIndex + 1;
    return (legIndex % maxStepIdx) + 1;
}
