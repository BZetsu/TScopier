"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signalRangeBoundary = signalRangeBoundary;
exports.signalZoneWidthPips = signalZoneWidthPips;
exports.resolveRangeDistancePips = resolveRangeDistancePips;
exports.virtualLegTriggerAllowed = virtualLegTriggerAllowed;
const parsedEntry_1 = require("./parsedEntry");
/** Far edge of the entry zone in the layering direction (buy → low, sell → high). */
function signalRangeBoundary(parsed, isBuy) {
    const z = (0, parsedEntry_1.resolvedParsedEntryZone)(parsed);
    if (!z)
        return null;
    return isBuy ? z.lo : z.hi;
}
/** Entry zone span in pips (hi − lo). */
function signalZoneWidthPips(parsed, pip) {
    const z = (0, parsedEntry_1.resolvedParsedEntryZone)(parsed);
    if (!z || !Number.isFinite(pip) || pip <= 0)
        return null;
    const width = Math.abs(z.hi - z.lo);
    if (!Number.isFinite(width) || width <= 0)
        return null;
    return width / pip;
}
function resolveRangeDistancePips(args) {
    const manualDist = Math.max(0, Number(args.manual.range_distance_pips ?? 0));
    if (args.manual.use_signal_entry_range !== true) {
        return { distPips: manualDist, boundary: null, source: 'manual' };
    }
    const widthPips = signalZoneWidthPips(args.parsed, args.pip);
    const boundary = signalRangeBoundary(args.parsed, args.isBuy);
    if (widthPips != null && widthPips > 0 && boundary != null) {
        return { distPips: widthPips, boundary, source: 'signal_zone' };
    }
    return { distPips: manualDist, boundary: null, source: 'manual' };
}
/** True when a virtual leg trigger price is still inside the signal entry zone. */
function virtualLegTriggerAllowed(args) {
    const { trigger, boundary, isBuy } = args;
    if (boundary == null || !Number.isFinite(boundary))
        return true;
    if (!Number.isFinite(trigger))
        return false;
    return isBuy ? trigger >= boundary : trigger <= boundary;
}
