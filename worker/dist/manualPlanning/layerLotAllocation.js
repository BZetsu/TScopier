"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocateLayerLots = allocateLayerLots;
const LOT_EPS = 1e-9;
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
function toLotUnits(value, lotStep) {
    const scale = decimalScale(value, lotStep);
    const scaledValue = Math.floor(value * scale);
    const scaledStep = Math.round(lotStep * scale);
    if (scaledStep <= 0)
        return 0;
    return Math.max(0, Math.floor(scaledValue / scaledStep));
}
function fromLotUnits(units, lotStep) {
    return Number((units * lotStep).toFixed(8));
}
function isPositiveFinite(value) {
    return Number.isFinite(value) && value > 0;
}
function allocateLayerLots(input) {
    const { intendedTotalLot, layerCount, minLot, lotStep } = input;
    if (!Number.isFinite(intendedTotalLot) || intendedTotalLot < 0) {
        return { ok: false, reason: 'invalid_total_lot' };
    }
    if (!Number.isInteger(layerCount) || layerCount <= 0) {
        return { ok: false, reason: 'invalid_layer_count' };
    }
    if (!isPositiveFinite(minLot)) {
        return { ok: false, reason: 'invalid_min_lot' };
    }
    if (!isPositiveFinite(lotStep)) {
        return { ok: false, reason: 'invalid_lot_step' };
    }
    const totalUnits = toLotUnits(intendedTotalLot, lotStep);
    const minScale = decimalScale(minLot, lotStep);
    const minUnits = Math.max(1, Math.ceil(Math.ceil(minLot * minScale) / Math.round(lotStep * minScale)));
    if (totalUnits < minUnits) {
        return { ok: false, reason: 'total_lot_below_minimum' };
    }
    const maxFundedByMinimum = Math.floor(totalUnits / minUnits);
    const fundedLayerCount = Math.min(layerCount, maxFundedByMinimum);
    if (fundedLayerCount <= 0) {
        return { ok: false, reason: 'total_lot_below_minimum' };
    }
    const baseUnits = Math.floor(totalUnits / fundedLayerCount);
    const remainderUnits = totalUnits - baseUnits * fundedLayerCount;
    const lots = Array.from({ length: fundedLayerCount }, (_, idx) => (fromLotUnits(baseUnits + (idx < remainderUnits ? 1 : 0), lotStep)));
    const allocatedTotalLot = fromLotUnits(lots.reduce((sum, lot) => sum + toLotUnits(lot, lotStep), 0), lotStep);
    if (allocatedTotalLot > intendedTotalLot) {
        return { ok: false, reason: 'total_lot_below_minimum' };
    }
    const unallocatedLot = Number(Math.max(0, intendedTotalLot - allocatedTotalLot).toFixed(8));
    const reasons = [];
    if (fundedLayerCount < layerCount)
        reasons.push('funded_layer_count_reduced');
    if (unallocatedLot > LOT_EPS)
        reasons.push('allocation_reduced_by_lot_step');
    return Object.freeze({
        ok: true,
        requestedLayerCount: layerCount,
        fundedLayerCount,
        lots: Object.freeze(lots),
        intendedTotalLot,
        allocatedTotalLot,
        unallocatedLot,
        reasons: Object.freeze(reasons),
    });
}
