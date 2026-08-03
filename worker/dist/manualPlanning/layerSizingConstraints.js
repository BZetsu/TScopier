"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.solveLayerSizingConstraints = solveLayerSizingConstraints;
const layeringModes_1 = require("./layeringModes");
const LOT_EPS = 1e-9;
function isPositiveFinite(value) {
    return Number.isFinite(value) && value > 0;
}
function decimalPlaces(value) {
    if (!Number.isFinite(value))
        return 0;
    const text = value.toString().toLowerCase();
    const [mantissa, expText] = text.split('e');
    const exponent = expText != null ? Number(expText) : 0;
    const decimals = (mantissa?.split('.')[1]?.length ?? 0) - exponent;
    return Math.max(0, decimals);
}
function decimalScale(...values) {
    const places = Math.min(12, Math.max(...values.map(decimalPlaces)));
    return 10 ** places;
}
function lotUnits(value, lotStep) {
    const scale = decimalScale(value, lotStep);
    const scaledValue = Math.floor((value + LOT_EPS) * scale);
    const scaledStep = Math.round(lotStep * scale);
    if (scaledStep <= 0)
        return 0;
    return Math.max(0, Math.floor(scaledValue / scaledStep));
}
function lotFromUnits(units, lotStep) {
    return Number((units * lotStep).toFixed(8));
}
function minLotUnits(minLot, lotStep) {
    const scale = decimalScale(minLot, lotStep);
    const scaledMin = Math.ceil((minLot - LOT_EPS) * scale);
    const scaledStep = Math.round(lotStep * scale);
    if (scaledStep <= 0)
        return 0;
    return Math.max(1, Math.ceil(scaledMin / scaledStep));
}
function percentFromLot(lot, totalLot) {
    return Number(((lot / totalLot) * 100).toFixed(8));
}
function uniqueWarnings(warnings) {
    return Object.freeze([...new Set(warnings)]);
}
function normalizedStrategy(value) {
    return value === 'reduce_layers' || value === 'widen_step' || value === 'adjust_percent'
        ? value
        : 'adjust_percent';
}
function solveLayerSizingConstraints(input) {
    const strategy = normalizedStrategy(input.optimizationStrategy);
    const maxLayerCount = Number.isInteger(input.maxLayerCount)
        ? Math.max(layeringModes_1.MIN_LAYER_COUNT, Math.min(layeringModes_1.MAX_LAYER_COUNT, input.maxLayerCount ?? layeringModes_1.MAX_LAYER_COUNT))
        : layeringModes_1.MAX_LAYER_COUNT;
    if (!isPositiveFinite(input.rangeDistancePips))
        return { ok: false, reason: 'invalid_range_distance' };
    if (!isPositiveFinite(input.stepPips))
        return { ok: false, reason: 'invalid_step_pips' };
    if (!Number.isFinite(input.totalLot) || input.totalLot <= 0)
        return { ok: false, reason: 'invalid_total_lot' };
    if (!isPositiveFinite(input.minLot))
        return { ok: false, reason: 'invalid_min_lot' };
    if (!isPositiveFinite(input.lotStep))
        return { ok: false, reason: 'invalid_lot_step' };
    if (!isPositiveFinite(input.layerPercent) || input.layerPercent > 100)
        return { ok: false, reason: 'invalid_layer_percent' };
    const totalUnits = lotUnits(input.totalLot, input.lotStep);
    const minUnits = minLotUnits(input.minLot, input.lotStep);
    if (totalUnits < minUnits)
        return { ok: false, reason: 'total_lot_below_minimum' };
    const theoreticalLayerCount = Math.max(layeringModes_1.MIN_LAYER_COUNT, Math.min(maxLayerCount, Math.floor(input.rangeDistancePips / input.stepPips) + 1));
    const requestedLayerUnits = lotUnits(input.totalLot * (input.layerPercent / 100), input.lotStep);
    const maxLayersByTotalLot = Math.max(1, Math.floor(totalUnits / minUnits));
    const maxLayersByPercentCap = Math.max(1, Math.floor(100 / input.layerPercent));
    const requestedPercentTradable = requestedLayerUnits >= minUnits;
    const requestedPercentFitsCount = input.layerPercent * theoreticalLayerCount <= 100 + LOT_EPS;
    const warnings = [];
    let effectiveLayerCount = theoreticalLayerCount;
    let layerUnits = requestedLayerUnits;
    if (strategy === 'adjust_percent') {
        const maxUniformUnits = Math.floor(totalUnits / theoreticalLayerCount);
        if (requestedPercentTradable && requestedPercentFitsCount) {
            layerUnits = requestedLayerUnits;
        }
        else if (requestedLayerUnits < minUnits && maxUniformUnits >= minUnits) {
            layerUnits = minUnits;
            warnings.push('layer_percent_recalculated');
        }
        else if (requestedLayerUnits > maxUniformUnits && maxUniformUnits >= minUnits) {
            layerUnits = maxUniformUnits;
            warnings.push('layer_percent_recalculated');
        }
        else {
            effectiveLayerCount = Math.min(theoreticalLayerCount, maxLayersByTotalLot);
            layerUnits = minUnits;
            warnings.push('optimization_strategy_fallback', 'layer_count_reduced_by_minimum_lot', 'layer_percent_recalculated');
        }
    }
    else {
        effectiveLayerCount = Math.min(theoreticalLayerCount, maxLayersByTotalLot, maxLayersByPercentCap);
        if (effectiveLayerCount < theoreticalLayerCount) {
            if (effectiveLayerCount < maxLayersByPercentCap || maxLayersByPercentCap < theoreticalLayerCount) {
                warnings.push('layer_count_reduced_by_percentage');
            }
            if (effectiveLayerCount < maxLayersByTotalLot || maxLayersByTotalLot < theoreticalLayerCount) {
                warnings.push('layer_count_reduced_by_minimum_lot');
            }
        }
        if (requestedPercentTradable) {
            layerUnits = requestedLayerUnits;
        }
        else {
            layerUnits = minUnits;
            warnings.push('optimization_strategy_fallback', 'layer_percent_recalculated');
        }
    }
    effectiveLayerCount = Math.max(1, Math.min(effectiveLayerCount, Math.floor(totalUnits / Math.max(1, layerUnits))));
    if (effectiveLayerCount < theoreticalLayerCount && !warnings.includes('layer_count_reduced_by_minimum_lot') && strategy !== 'adjust_percent') {
        warnings.push('layer_count_reduced_by_minimum_lot');
    }
    const lotPerLayer = lotFromUnits(layerUnits, input.lotStep);
    const allocatedTotalLot = lotFromUnits(layerUnits * effectiveLayerCount, input.lotStep);
    const unallocatedLot = Number(Math.max(0, input.totalLot - allocatedTotalLot).toFixed(8));
    const effectiveLayerPercent = percentFromLot(lotPerLayer, input.totalLot);
    const allocationPercentTotal = Number((effectiveLayerPercent * effectiveLayerCount).toFixed(8));
    const effectiveStepPips = strategy === 'widen_step' && effectiveLayerCount > 1
        ? Number((input.rangeDistancePips / (effectiveLayerCount - 1)).toFixed(8))
        : input.stepPips;
    if (strategy === 'widen_step' && effectiveStepPips !== input.stepPips)
        warnings.push('step_distance_recalculated');
    if (Math.abs(effectiveLayerPercent - input.layerPercent) > 1e-8)
        warnings.push('layer_percent_recalculated');
    if (effectiveLayerCount < theoreticalLayerCount && strategy === 'adjust_percent')
        warnings.push('layer_count_reduced_by_minimum_lot');
    if (unallocatedLot > LOT_EPS)
        warnings.push('allocation_reduced_by_lot_step');
    if (allocationPercentTotal > 100 + LOT_EPS || allocatedTotalLot > input.totalLot + LOT_EPS || lotPerLayer < input.minLot - LOT_EPS) {
        return { ok: false, reason: 'total_lot_below_minimum' };
    }
    return Object.freeze({
        ok: true,
        optimizationStrategy: strategy,
        requestedRangeDistancePips: input.rangeDistancePips,
        requestedStepPips: input.stepPips,
        effectiveStepPips,
        theoreticalLayerCount,
        effectiveLayerCount,
        requestedLayerPercent: input.layerPercent,
        effectiveLayerPercent,
        allocationPercentTotal,
        lotPerLayer,
        lots: Object.freeze(Array.from({ length: effectiveLayerCount }, () => lotPerLayer)),
        intendedTotalLot: input.totalLot,
        allocatedTotalLot,
        unallocatedLot,
        warnings: uniqueWarnings(warnings),
    });
}
