"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LAYER_PLAN_ID_LENGTH = exports.MIN_LAYER_PLAN_ID_LENGTH = exports.LAYERING_PLAN_CALCULATOR_VERSION = exports.LAYERING_PLAN_SCHEMA_VERSION = exports.DEFAULT_DYNAMIC_STEP_PIPS = exports.DEFAULT_DYNAMIC_MAX_LAYERS = exports.DEFAULT_STATIC_LAYER_COUNT = exports.MAX_LAYER_COUNT = exports.MIN_LAYER_COUNT = exports.DEFAULT_LAYERING_MODE = exports.LAYERING_MODES = void 0;
exports.isValidLayerPlanId = isValidLayerPlanId;
exports.resolveLayeringMode = resolveLayeringMode;
exports.isLegacyLayeringMode = isLegacyLayeringMode;
exports.isStaticLayeringMode = isStaticLayeringMode;
exports.isDynamicLayeringMode = isDynamicLayeringMode;
exports.layeringModesExecutionEnabled = layeringModesExecutionEnabled;
exports.normalizeLayeringModeSettings = normalizeLayeringModeSettings;
exports.assertLayeringModeExecutionSupported = assertLayeringModeExecutionSupported;
exports.parseLayeringPlanSnapshot = parseLayeringPlanSnapshot;
exports.serializeLayeringPlanSnapshot = serializeLayeringPlanSnapshot;
exports.changeLayeringPlanMode = changeLayeringPlanMode;
const layeringModeRollout_1 = require("./layeringModeRollout");
exports.LAYERING_MODES = ['legacy', 'static', 'dynamic'];
exports.DEFAULT_LAYERING_MODE = 'legacy';
exports.MIN_LAYER_COUNT = 1;
exports.MAX_LAYER_COUNT = 20;
exports.DEFAULT_STATIC_LAYER_COUNT = 5;
exports.DEFAULT_DYNAMIC_MAX_LAYERS = 5;
exports.DEFAULT_DYNAMIC_STEP_PIPS = 3;
exports.LAYERING_PLAN_SCHEMA_VERSION = 1;
exports.LAYERING_PLAN_CALCULATOR_VERSION = 'layering-v1';
const ANCHOR_SOURCES = new Set(['signal', 'quote', 'fill', 'unknown']);
exports.MIN_LAYER_PLAN_ID_LENGTH = 8;
exports.MAX_LAYER_PLAN_ID_LENGTH = 128;
const LAYER_PLAN_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_LAYER_PLAN_DECIMAL_PLACES = 12;
function isRecord(value) {
    return value != null
        && typeof value === 'object'
        && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function looseFiniteNumber(value) {
    if (value == null || value === '')
        return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
function normalizeInteger(value, fallback) {
    const n = looseFiniteNumber(value);
    if (n == null)
        return fallback;
    return Math.max(exports.MIN_LAYER_COUNT, Math.min(exports.MAX_LAYER_COUNT, Math.floor(n)));
}
function normalizePositiveNumber(value, fallback) {
    const n = looseFiniteNumber(value);
    if (n == null || n <= 0)
        return fallback;
    return n;
}
function strictFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function strictLayerCount(value) {
    const n = strictFiniteNumber(value);
    if (n == null || !Number.isInteger(n) || n < exports.MIN_LAYER_COUNT || n > exports.MAX_LAYER_COUNT)
        return null;
    return n;
}
function strictNonNegativeNumber(value) {
    const n = strictFiniteNumber(value);
    return n != null && n >= 0 ? n : null;
}
function strictPositiveNumber(value) {
    const n = strictFiniteNumber(value);
    return n != null && n > 0 ? n : null;
}
function strictString(value) {
    return typeof value === 'string' && value.trim() ? value : null;
}
function strictNumberArray(value) {
    if (!Array.isArray(value))
        return null;
    const out = [];
    for (const item of value) {
        const n = strictFiniteNumber(item);
        if (n == null)
            return null;
        out.push(n);
    }
    return Object.freeze(out);
}
function strictPositiveNumberArray(value) {
    const arr = strictNumberArray(value);
    if (arr == null || arr.some(v => v <= 0))
        return null;
    return arr;
}
function uniqueNumbers(values) {
    return new Set(values.map(v => String(v))).size === values.length;
}
function pricesOrdered(side, prices) {
    for (let idx = 1; idx < prices.length; idx++) {
        if (side === 'buy' && prices[idx] >= prices[idx - 1])
            return false;
        if (side === 'sell' && prices[idx] <= prices[idx - 1])
            return false;
    }
    return true;
}
function decimalPlaces(value) {
    if (!Number.isFinite(value))
        return Number.POSITIVE_INFINITY;
    const text = value.toString().toLowerCase();
    const [mantissa, expText] = text.split('e');
    const exponent = expText == null ? 0 : Number(expText);
    const decimals = (mantissa?.split('.')[1]?.length ?? 0) - exponent;
    return Math.max(0, decimals);
}
function decimalScalePlaces(values) {
    const places = Math.max(...values.map(decimalPlaces));
    if (!Number.isFinite(places) || places > MAX_LAYER_PLAN_DECIMAL_PLACES)
        return null;
    return places;
}
function toDecimalUnits(value, places) {
    if (!Number.isFinite(value))
        return null;
    const text = value.toFixed(places);
    if (!/^-?\d+(?:\.\d+)?$/.test(text))
        return null;
    const negative = text.startsWith('-');
    const unsigned = negative ? text.slice(1) : text;
    const [whole, fraction = ''] = unsigned.split('.');
    const padded = fraction.padEnd(places, '0');
    const unitsText = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
    const units = Number(unitsText || '0');
    if (!Number.isSafeInteger(units))
        return null;
    return negative ? -units : units;
}
function validatePlanLotTotals(plannedTotalLot, allocatedTotalLot, unallocatedLot, lots) {
    if (plannedTotalLot == null || allocatedTotalLot == null || unallocatedLot == null || lots == null)
        return true;
    const values = [plannedTotalLot, allocatedTotalLot, unallocatedLot, ...lots];
    const places = decimalScalePlaces(values);
    if (places == null)
        return false;
    const plannedUnits = toDecimalUnits(plannedTotalLot, places);
    const allocatedUnits = toDecimalUnits(allocatedTotalLot, places);
    const unallocatedUnits = toDecimalUnits(unallocatedLot, places);
    const lotUnits = lots.map(lot => toDecimalUnits(lot, places));
    if (plannedUnits == null || allocatedUnits == null || unallocatedUnits == null || lotUnits.some(v => v == null))
        return false;
    const lotSumUnits = lotUnits.reduce((sum, units) => sum + units, 0);
    return allocatedUnits === lotSumUnits
        && allocatedUnits <= plannedUnits
        && unallocatedUnits === plannedUnits - allocatedUnits
        && unallocatedUnits >= 0;
}
function isValidLayerPlanId(value) {
    if (typeof value !== 'string')
        return false;
    if (value.trim() !== value)
        return false;
    if (value.length < exports.MIN_LAYER_PLAN_ID_LENGTH || value.length > exports.MAX_LAYER_PLAN_ID_LENGTH)
        return false;
    return LAYER_PLAN_ID_RE.test(value);
}
function strictTimestamp(value) {
    if (typeof value !== 'string' || !value.trim())
        return null;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        return null;
    return new Date(ms).toISOString() === value ? value : null;
}
function resolveLayeringMode(settings) {
    const raw = isRecord(settings) ? settings.layering_mode : undefined;
    return raw === 'static' || raw === 'dynamic' || raw === 'legacy' ? raw : exports.DEFAULT_LAYERING_MODE;
}
function isLegacyLayeringMode(settings) {
    return resolveLayeringMode(settings) === 'legacy';
}
function isStaticLayeringMode(settings) {
    return resolveLayeringMode(settings) === 'static';
}
function isDynamicLayeringMode(settings) {
    return resolveLayeringMode(settings) === 'dynamic';
}
function layeringModesExecutionEnabled() {
    return (0, layeringModeRollout_1.resolveLayeringModeRolloutDecision)({
        mode: 'static',
        brokerAccountId: '__capability_probe__',
    }).prepareAllowed
        || (0, layeringModeRollout_1.resolveLayeringModeRolloutDecision)({
            mode: 'dynamic',
            brokerAccountId: '__capability_probe__',
        }).prepareAllowed;
}
function normalizeLayeringModeSettings(raw) {
    const rangeStepFallback = normalizePositiveNumber(raw.range_step_pips, exports.DEFAULT_DYNAMIC_STEP_PIPS);
    return {
        layering_mode: resolveLayeringMode(raw),
        static_layer_count: normalizeInteger(raw.static_layer_count, exports.DEFAULT_STATIC_LAYER_COUNT),
        dynamic_step_pips: normalizePositiveNumber(raw.dynamic_step_pips, rangeStepFallback),
        dynamic_max_layers: normalizeInteger(raw.dynamic_max_layers, exports.DEFAULT_DYNAMIC_MAX_LAYERS),
    };
}
function assertLayeringModeExecutionSupported(settings) {
    const mode = resolveLayeringMode(settings);
    if (mode === 'legacy')
        return { ok: true };
    const decision = (0, layeringModeRollout_1.resolveLayeringModeRolloutDecision)({ mode });
    if (decision.prepareAllowed)
        return { ok: true };
    return { ok: false, reason: `layering_mode_${mode}_${decision.reason}` };
}
function parseLayeringPlanSnapshot(raw) {
    try {
        if (raw == null) {
            return {
                schemaVersion: 0,
                calculatorVersion: 'legacy',
                planId: 'legacy',
                mode: 'legacy',
                signalId: '',
                brokerAccountId: '',
                basketKey: null,
                symbol: '',
                side: 'buy',
                originalRangeLow: null,
                originalRangeHigh: null,
                anchorPrice: null,
                executableAnchorPrice: null,
                anchorSource: 'unknown',
                configuredStaticLayerCount: null,
                configuredDynamicStepPips: null,
                configuredDynamicMaxLayers: null,
                optimizationStrategy: null,
                theoreticalLayerCount: null,
                effectiveStepPips: null,
                requestedLayerPercent: null,
                effectiveLayerPercent: null,
                allocationPercentTotal: null,
                requestedLayerCount: null,
                plannedLayerCount: null,
                plannedTotalLot: null,
                allocatedTotalLot: null,
                unallocatedLot: null,
                fundedPrices: null,
                lots: null,
                reasons: Object.freeze([]),
                createdAt: new Date(0).toISOString(),
                lockedAt: null,
            };
        }
        if (!isRecord(raw))
            return null;
        const row = raw;
        const rawMode = row.mode;
        if (rawMode !== 'static' && rawMode !== 'dynamic' && rawMode !== 'legacy')
            return null;
        const mode = rawMode;
        const rawSide = row.side == null && mode === 'legacy' ? 'buy' : row.side;
        if (rawSide !== 'buy' && rawSide !== 'sell')
            return null;
        const side = rawSide;
        const schemaVersion = row.schemaVersion == null && mode === 'legacy'
            ? 0
            : strictFiniteNumber(row.schemaVersion);
        if (schemaVersion == null || !Number.isInteger(schemaVersion))
            return null;
        if (mode === 'legacy') {
            if (schemaVersion !== 0 && schemaVersion !== exports.LAYERING_PLAN_SCHEMA_VERSION)
                return null;
        }
        else if (schemaVersion !== exports.LAYERING_PLAN_SCHEMA_VERSION) {
            return null;
        }
        const calculatorVersion = row.calculatorVersion == null && mode === 'legacy'
            ? 'legacy'
            : strictString(row.calculatorVersion);
        if (calculatorVersion == null)
            return null;
        if (mode !== 'legacy' && calculatorVersion !== exports.LAYERING_PLAN_CALCULATOR_VERSION)
            return null;
        const anchorSource = ANCHOR_SOURCES.has(row.anchorSource)
            ? row.anchorSource
            : null;
        if (anchorSource == null)
            return null;
        const planId = isValidLayerPlanId(row.planId) ? row.planId : null;
        if (planId == null && mode !== 'legacy')
            return null;
        const plannedLayerCount = row.plannedLayerCount == null ? null : strictLayerCount(row.plannedLayerCount);
        if (row.plannedLayerCount != null && plannedLayerCount == null)
            return null;
        const requestedLayerCount = row.requestedLayerCount == null ? null : strictLayerCount(row.requestedLayerCount);
        if (row.requestedLayerCount != null && requestedLayerCount == null)
            return null;
        const plannedTotalLot = row.plannedTotalLot == null ? null : strictNonNegativeNumber(row.plannedTotalLot);
        if (row.plannedTotalLot != null && plannedTotalLot == null)
            return null;
        const allocatedTotalLot = row.allocatedTotalLot == null ? null : strictNonNegativeNumber(row.allocatedTotalLot);
        if (row.allocatedTotalLot != null && allocatedTotalLot == null)
            return null;
        const unallocatedLot = row.unallocatedLot == null ? null : strictNonNegativeNumber(row.unallocatedLot);
        if (row.unallocatedLot != null && unallocatedLot == null)
            return null;
        if (allocatedTotalLot != null && plannedTotalLot != null && allocatedTotalLot > plannedTotalLot)
            return null;
        const configuredStaticLayerCount = row.configuredStaticLayerCount == null ? null : strictLayerCount(row.configuredStaticLayerCount);
        if (row.configuredStaticLayerCount != null && configuredStaticLayerCount == null)
            return null;
        const configuredDynamicStepPips = row.configuredDynamicStepPips == null ? null : strictPositiveNumber(row.configuredDynamicStepPips);
        if (row.configuredDynamicStepPips != null && configuredDynamicStepPips == null)
            return null;
        const configuredDynamicMaxLayers = row.configuredDynamicMaxLayers == null ? null : strictLayerCount(row.configuredDynamicMaxLayers);
        if (row.configuredDynamicMaxLayers != null && configuredDynamicMaxLayers == null)
            return null;
        const optimizationStrategy = row.optimizationStrategy == null
            ? null
            : row.optimizationStrategy === 'adjust_percent' || row.optimizationStrategy === 'reduce_layers' || row.optimizationStrategy === 'widen_step'
                ? row.optimizationStrategy
                : null;
        if (row.optimizationStrategy != null && optimizationStrategy == null)
            return null;
        const theoreticalLayerCount = row.theoreticalLayerCount == null ? null : strictLayerCount(row.theoreticalLayerCount);
        if (row.theoreticalLayerCount != null && theoreticalLayerCount == null)
            return null;
        const effectiveStepPips = row.effectiveStepPips == null ? null : strictPositiveNumber(row.effectiveStepPips);
        if (row.effectiveStepPips != null && effectiveStepPips == null)
            return null;
        const requestedLayerPercent = row.requestedLayerPercent == null ? null : strictPositiveNumber(row.requestedLayerPercent);
        if (row.requestedLayerPercent != null && (requestedLayerPercent == null || requestedLayerPercent > 100))
            return null;
        const effectiveLayerPercent = row.effectiveLayerPercent == null ? null : strictPositiveNumber(row.effectiveLayerPercent);
        if (row.effectiveLayerPercent != null && (effectiveLayerPercent == null || effectiveLayerPercent > 100))
            return null;
        const allocationPercentTotal = row.allocationPercentTotal == null ? null : strictNonNegativeNumber(row.allocationPercentTotal);
        if (row.allocationPercentTotal != null && (allocationPercentTotal == null || allocationPercentTotal > 100))
            return null;
        if (mode === 'static' && configuredStaticLayerCount == null) {
            return null;
        }
        if (mode === 'dynamic' && (configuredDynamicStepPips == null || configuredDynamicMaxLayers == null)) {
            return null;
        }
        const originalRangeLow = row.originalRangeLow == null ? null : strictFiniteNumber(row.originalRangeLow);
        const originalRangeHigh = row.originalRangeHigh == null ? null : strictFiniteNumber(row.originalRangeHigh);
        if ((row.originalRangeLow != null && originalRangeLow == null)
            || (row.originalRangeHigh != null && originalRangeHigh == null)
            || (originalRangeLow != null && originalRangeHigh != null && originalRangeLow > originalRangeHigh))
            return null;
        const anchorPrice = row.anchorPrice == null ? null : strictFiniteNumber(row.anchorPrice);
        if (row.anchorPrice != null && anchorPrice == null)
            return null;
        const executableAnchorPrice = row.executableAnchorPrice == null ? null : strictFiniteNumber(row.executableAnchorPrice);
        if (row.executableAnchorPrice != null && executableAnchorPrice == null)
            return null;
        const fundedPrices = row.fundedPrices == null ? null : strictNumberArray(row.fundedPrices);
        if (row.fundedPrices != null && fundedPrices == null)
            return null;
        const lots = row.lots == null ? null : strictPositiveNumberArray(row.lots);
        if (row.lots != null && lots == null)
            return null;
        const reasons = row.reasons == null
            ? Object.freeze([])
            : Array.isArray(row.reasons) && row.reasons.every(r => typeof r === 'string' && r.length <= 128)
                ? Object.freeze([...new Set(row.reasons)])
                : null;
        if (reasons == null)
            return null;
        if (fundedPrices != null) {
            if (!uniqueNumbers(fundedPrices))
                return null;
            if (originalRangeLow != null && originalRangeHigh != null && fundedPrices.some(p => p < originalRangeLow || p > originalRangeHigh))
                return null;
            if (!pricesOrdered(side, fundedPrices))
                return null;
        }
        if ((fundedPrices == null) !== (lots == null))
            return null;
        if (fundedPrices != null && lots != null && fundedPrices.length !== lots.length)
            return null;
        if (plannedLayerCount != null && fundedPrices != null && plannedLayerCount !== fundedPrices.length)
            return null;
        if (!validatePlanLotTotals(plannedTotalLot, allocatedTotalLot, unallocatedLot, lots))
            return null;
        if (mode === 'static' && requestedLayerCount != null && configuredStaticLayerCount != null && requestedLayerCount !== configuredStaticLayerCount) {
            return null;
        }
        if (mode === 'dynamic' && plannedLayerCount != null && configuredDynamicMaxLayers != null && plannedLayerCount > configuredDynamicMaxLayers) {
            return null;
        }
        if (mode === 'dynamic' && executableAnchorPrice != null && fundedPrices != null && fundedPrices[0] !== executableAnchorPrice) {
            return null;
        }
        if (mode !== 'legacy'
            && (planId == null
                || originalRangeLow == null
                || originalRangeHigh == null
                || requestedLayerCount == null
                || plannedLayerCount == null
                || plannedTotalLot == null
                || allocatedTotalLot == null
                || unallocatedLot == null
                || fundedPrices == null
                || lots == null
                || (mode === 'dynamic' && anchorPrice == null)))
            return null;
        const createdAt = strictTimestamp(row.createdAt);
        const lockedAt = row.lockedAt == null ? null : strictTimestamp(row.lockedAt);
        if (createdAt == null || (row.lockedAt != null && lockedAt == null))
            return null;
        if (lockedAt != null && Date.parse(lockedAt) < Date.parse(createdAt))
            return null;
        return {
            schemaVersion,
            calculatorVersion,
            planId: planId ?? 'legacy',
            mode,
            signalId: typeof row.signalId === 'string' ? row.signalId : '',
            brokerAccountId: typeof row.brokerAccountId === 'string' ? row.brokerAccountId : '',
            basketKey: row.basketKey == null ? null : (typeof row.basketKey === 'string' ? row.basketKey : ''),
            symbol: typeof row.symbol === 'string' ? row.symbol : '',
            side,
            originalRangeLow,
            originalRangeHigh,
            anchorPrice,
            executableAnchorPrice,
            anchorSource,
            configuredStaticLayerCount,
            configuredDynamicStepPips,
            configuredDynamicMaxLayers,
            optimizationStrategy,
            theoreticalLayerCount,
            effectiveStepPips,
            requestedLayerPercent,
            effectiveLayerPercent,
            allocationPercentTotal,
            requestedLayerCount,
            plannedLayerCount,
            plannedTotalLot,
            allocatedTotalLot,
            unallocatedLot,
            fundedPrices,
            lots,
            reasons,
            createdAt,
            lockedAt,
        };
    }
    catch {
        return null;
    }
}
function serializeLayeringPlanSnapshot(snapshot) {
    const parsed = parseLayeringPlanSnapshot(snapshot);
    if (parsed == null)
        return null;
    return { ...parsed };
}
function changeLayeringPlanMode(snapshot, nextMode) {
    if (snapshot.lockedAt && snapshot.mode !== nextMode) {
        throw new Error('locked layering plan mode cannot change');
    }
    return { ...snapshot, mode: nextMode };
}
