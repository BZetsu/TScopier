"use strict";
/**
 * Pip vs absolute-price detection for signal SL/TP levels, plus conversion
 * from pip offsets to broker prices at planning time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tpClauseHasExplicitPips = tpClauseHasExplicitPips;
exports.slClauseHasExplicitPips = slClauseHasExplicitPips;
exports.looksLikePipOffsetMagnitudes = looksLikePipOffsetMagnitudes;
exports.entryRefFromParsed = entryRefFromParsed;
exports.resolveTpUnit = resolveTpUnit;
exports.resolveSlUnit = resolveSlUnit;
exports.convertPipOffsetsToPrices = convertPipOffsetsToPrices;
exports.convertPipOffsetToPrice = convertPipOffsetToPrice;
exports.resolvePipSize = resolvePipSize;
const signalPip_1 = require("./signalPip");
const TP_LABEL = '(?:tp|take\\s*profit|target(?:\\s+level)?)';
const SL_LABEL = '(?:sl|s\\/?l|stop\\s*loss|stoploss|risk)';
/** True when a TP clause explicitly ends with / contains a pip unit. */
function tpClauseHasExplicitPips(message) {
    const text = String(message ?? '');
    // TP:30/50/100pips  |  TP: 30 / 50 / 100 pips  |  TP1: 30pips  |  take profit 50 pip
    if (new RegExp(`\\b${TP_LABEL}\\s*#?\\s*\\d*\\s*[:=\\-]?\\s*[\\d./\\s|&and]+\\s*pips?\\b`, 'i').test(text)) {
        return true;
    }
    // Glued: 100pips immediately after TP number list without space
    if (new RegExp(`\\b${TP_LABEL}\\s*[:=\\-]?\\s*\\d+(?:\\.\\d+)?(?:\\s*[/|]\\s*\\d+(?:\\.\\d+)?)*pips?\\b`, 'i').test(text)) {
        return true;
    }
    return false;
}
/** True when an SL clause explicitly uses a pip unit (e.g. SL: 20 pips). */
function slClauseHasExplicitPips(message) {
    const text = String(message ?? '');
    return new RegExp(`\\b${SL_LABEL}\\s*[:=\\-]?\\s*\\d+(?:\\.\\d+)?\\s*pips?\\b`, 'i').test(text);
}
/**
 * Magnitude heuristic: all TP values look like small offsets vs a market-price ref
 * (entry / zone mid / SL), not absolute quotes on the same scale.
 */
function looksLikePipOffsetMagnitudes(tps, ref) {
    const values = (tps ?? []).filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0);
    if (!values.length)
        return false;
    const maxTp = Math.max(...values);
    if (maxTp >= 500)
        return false;
    const r = Number(ref);
    if (!Number.isFinite(r) || r <= 0) {
        // No ref: still treat very small ladders as pips (typical 10–200 pip TPs).
        return maxTp < 500 && values.every(v => v < 500);
    }
    // Same order of magnitude as ref → absolute prices (e.g. TP 4090 vs entry 4109).
    if (values.some(v => v >= r * 0.5))
        return false;
    return maxTp < 500 && maxTp < r * 0.05;
}
function entryRefFromParsed(parsed) {
    const ep = Number(parsed.entry_price);
    if (Number.isFinite(ep) && ep > 0)
        return ep;
    const lo = Number(parsed.entry_zone_low);
    const hi = Number(parsed.entry_zone_high);
    if (Number.isFinite(lo) && lo > 0 && Number.isFinite(hi) && hi > 0) {
        return (lo + hi) / 2;
    }
    if (Number.isFinite(lo) && lo > 0)
        return lo;
    if (Number.isFinite(hi) && hi > 0)
        return hi;
    const sl = Number(parsed.sl);
    if (Number.isFinite(sl) && sl > 0)
        return sl;
    return null;
}
function resolveTpUnit(args) {
    if (args.explicitFromExtract || tpClauseHasExplicitPips(args.message))
        return 'pips';
    if (args.channelTpInPips === true)
        return 'pips';
    if (looksLikePipOffsetMagnitudes(args.tps, args.ref ?? null))
        return 'pips';
    return 'price';
}
function resolveSlUnit(args) {
    if (slClauseHasExplicitPips(args.message))
        return 'pips';
    if (args.channelSlInPips === true)
        return 'pips';
    const sl = Number(args.sl);
    const r = Number(args.ref);
    if (Number.isFinite(sl)
        && sl > 0
        && sl < 500
        && Number.isFinite(r)
        && r > 0
        && sl < r * 0.05
        && sl < r * 0.5) {
        return 'pips';
    }
    return 'price';
}
/** Convert pip-offset levels to absolute prices relative to entry. */
function convertPipOffsetsToPrices(args) {
    const { offsets, entryAnchor, isBuy, pipSize } = args;
    if (!Number.isFinite(entryAnchor) || entryAnchor <= 0)
        return [];
    if (!Number.isFinite(pipSize) || pipSize <= 0)
        return [];
    return offsets
        .map(Number)
        .filter(n => Number.isFinite(n) && n > 0)
        .map(n => (isBuy ? entryAnchor + n * pipSize : entryAnchor - n * pipSize));
}
function convertPipOffsetToPrice(args) {
    const converted = convertPipOffsetsToPrices({
        offsets: [args.offset],
        entryAnchor: args.entryAnchor,
        isBuy: args.isBuy,
        pipSize: args.pipSize,
    });
    return converted[0] ?? null;
}
function resolvePipSize(args) {
    const broker = Number(args.brokerPipPrice);
    if (Number.isFinite(broker) && broker > 0)
        return broker;
    return (0, signalPip_1.signalPipPrice)(args.symbol);
}
