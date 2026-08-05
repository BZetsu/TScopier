"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLayerPrices = normalizeLayerPrices;
exports.calculateStaticLayerPrices = calculateStaticLayerPrices;
exports.calculateDynamicLayerPrices = calculateDynamicLayerPrices;
exports.buildCalculatedLayerPlan = buildCalculatedLayerPlan;
exports.calculateStaticLayerPlan = calculateStaticLayerPlan;
exports.calculateDynamicLayerPlan = calculateDynamicLayerPlan;
const layeringModes_1 = require("./layeringModes");
const layerLotAllocation_1 = require("./layerLotAllocation");
const layerSizingConstraints_1 = require("./layerSizingConstraints");
const PRICE_EPS = 1e-9;
function isValidSide(side) {
    return side === 'buy' || side === 'sell';
}
function validRange(rangeLow, rangeHigh) {
    return Number.isFinite(rangeLow) && Number.isFinite(rangeHigh) && rangeLow <= rangeHigh;
}
function validDigits(symbolDigits) {
    return Number.isInteger(symbolDigits) && symbolDigits >= 0 && symbolDigits <= 8;
}
function roundPrice(price, symbolDigits) {
    const rounded = Number(price.toFixed(symbolDigits));
    return Object.is(rounded, -0) ? 0 : rounded;
}
function inRange(price, rangeLow, rangeHigh) {
    return price >= rangeLow - PRICE_EPS && price <= rangeHigh + PRICE_EPS;
}
function freezeSuccess(value) {
    return Object.freeze(value);
}
function uniqueReasons(reasons) {
    return Object.freeze([...new Set(reasons)]);
}
function validateLayerCount(layerCount) {
    return Number.isInteger(layerCount) && layerCount >= layeringModes_1.MIN_LAYER_COUNT && layerCount <= layeringModes_1.MAX_LAYER_COUNT;
}
function normalizeLayerPrices(input) {
    const { candidateRawPrices, rangeLow, rangeHigh, symbolDigits } = input;
    if (!validRange(rangeLow, rangeHigh))
        return { ok: false, reason: 'invalid_range' };
    if (!validDigits(symbolDigits))
        return { ok: false, reason: 'invalid_symbol_digits' };
    const normalizedPrices = [];
    const duplicateSourceIndexes = [];
    const skippedLevels = [];
    const seen = new Set();
    for (let idx = 0; idx < candidateRawPrices.length; idx++) {
        const rawPrice = candidateRawPrices[idx];
        if (rawPrice == null || !Number.isFinite(rawPrice))
            return { ok: false, reason: 'no_valid_layers' };
        const normalizedPrice = roundPrice(rawPrice, symbolDigits);
        if (!inRange(normalizedPrice, rangeLow, rangeHigh))
            return { ok: false, reason: 'invalid_range' };
        const key = normalizedPrice.toFixed(symbolDigits);
        if (seen.has(key)) {
            duplicateSourceIndexes.push(idx);
            skippedLevels.push({
                sourceIndex: idx,
                rawPrice,
                normalizedPrice,
                reason: 'duplicate_price_after_rounding',
            });
            continue;
        }
        seen.add(key);
        normalizedPrices.push(normalizedPrice);
    }
    if (normalizedPrices.length === 0)
        return { ok: false, reason: 'no_valid_layers' };
    const reasons = [];
    if (duplicateSourceIndexes.length > 0) {
        reasons.push('duplicate_price_after_rounding', 'layer_count_reduced_by_precision');
    }
    return freezeSuccess({
        ok: true,
        candidateRawPrices: Object.freeze([...candidateRawPrices]),
        normalizedCandidatePrices: Object.freeze(normalizedPrices),
        duplicateLevelsRemoved: duplicateSourceIndexes.length,
        duplicateSourceIndexes: Object.freeze(duplicateSourceIndexes),
        skippedLevels: Object.freeze(skippedLevels),
        reasons: Object.freeze(reasons),
    });
}
function calculateStaticLayerPrices(input) {
    const { side, rangeLow, rangeHigh, totalLayerCount, symbolDigits } = input;
    if (!isValidSide(side))
        return { ok: false, mode: 'static', reason: 'invalid_side' };
    if (!validRange(rangeLow, rangeHigh))
        return { ok: false, mode: 'static', reason: 'invalid_range' };
    if (!validDigits(symbolDigits))
        return { ok: false, mode: 'static', reason: 'invalid_symbol_digits' };
    if (!validateLayerCount(totalLayerCount))
        return { ok: false, mode: 'static', reason: 'invalid_layer_count' };
    if (rangeLow === rangeHigh && totalLayerCount > 1)
        return { ok: false, mode: 'static', reason: 'invalid_range' };
    const rawPrices = totalLayerCount === 1
        ? [side === 'buy' ? rangeHigh : rangeLow]
        : Array.from({ length: totalLayerCount }, (_, idx) => {
            const t = idx / (totalLayerCount - 1);
            return side === 'buy'
                ? rangeHigh - (rangeHigh - rangeLow) * t
                : rangeLow + (rangeHigh - rangeLow) * t;
        });
    const normalized = normalizeLayerPrices({ candidateRawPrices: rawPrices, rangeLow, rangeHigh, symbolDigits });
    if (!normalized.ok)
        return { ok: false, mode: 'static', reason: normalized.reason };
    return freezeSuccess({
        ok: true,
        mode: 'static',
        side,
        rangeLow,
        rangeHigh,
        rawAnchorPrice: null,
        executableAnchorPrice: null,
        requestedLayerCount: totalLayerCount,
        actualLayerCount: normalized.normalizedCandidatePrices.length,
        candidateRawPrices: normalized.candidateRawPrices,
        normalizedCandidatePrices: normalized.normalizedCandidatePrices,
        duplicateLevelsRemoved: normalized.duplicateLevelsRemoved,
        skippedLevels: normalized.skippedLevels,
        reasons: uniqueReasons(normalized.reasons),
    });
}
function calculateDynamicLayerPrices(input) {
    const { side, rangeLow, rangeHigh, firstFillPrice, stepPips, maxTotalLayers, pipSize, symbolDigits } = input;
    if (!isValidSide(side))
        return { ok: false, mode: 'dynamic', reason: 'invalid_side' };
    if (!validRange(rangeLow, rangeHigh))
        return { ok: false, mode: 'dynamic', reason: 'invalid_range' };
    if (!validDigits(symbolDigits))
        return { ok: false, mode: 'dynamic', reason: 'invalid_symbol_digits' };
    if (!Number.isFinite(firstFillPrice))
        return { ok: false, mode: 'dynamic', reason: 'invalid_anchor' };
    if (!Number.isFinite(stepPips) || stepPips <= 0)
        return { ok: false, mode: 'dynamic', reason: 'invalid_step_pips' };
    if (!Number.isFinite(pipSize) || pipSize <= 0)
        return { ok: false, mode: 'dynamic', reason: 'invalid_pip_size' };
    if (!validateLayerCount(maxTotalLayers))
        return { ok: false, mode: 'dynamic', reason: 'invalid_layer_count' };
    const outsideRange = firstFillPrice < rangeLow || firstFillPrice > rangeHigh;
    if (outsideRange || maxTotalLayers === 1) {
        const normalizedAnchor = normalizeLayerPrices({
            candidateRawPrices: [firstFillPrice],
            rangeLow,
            rangeHigh,
            symbolDigits,
        });
        if (!normalizedAnchor.ok) {
            return { ok: false, mode: 'dynamic', reason: 'anchor_unrepresentable_at_precision' };
        }
        const executableAnchorPrice = normalizedAnchor.normalizedCandidatePrices[0];
        return freezeSuccess({
            ok: true,
            mode: 'dynamic',
            side,
            rangeLow,
            rangeHigh,
            rawAnchorPrice: firstFillPrice,
            executableAnchorPrice,
            requestedLayerCount: maxTotalLayers,
            actualLayerCount: 1,
            candidateRawPrices: normalizedAnchor.candidateRawPrices,
            normalizedCandidatePrices: normalizedAnchor.normalizedCandidatePrices,
            duplicateLevelsRemoved: 0,
            skippedLevels: Object.freeze([]),
            reasons: uniqueReasons(outsideRange ? ['anchor_outside_range'] : []),
        });
    }
    const stepPrice = stepPips * pipSize;
    if (!Number.isFinite(stepPrice) || stepPrice <= 0)
        return { ok: false, mode: 'dynamic', reason: 'invalid_step_pips' };
    const farBoundary = side === 'buy' ? rangeLow : rangeHigh;
    const remainingDistance = side === 'buy' ? firstFillPrice - farBoundary : farBoundary - firstFillPrice;
    const rawPrices = [firstFillPrice];
    const reasons = [];
    if (remainingDistance + PRICE_EPS < stepPrice) {
        reasons.push('insufficient_remaining_distance');
    }
    else {
        for (let idx = 1; idx < maxTotalLayers; idx++) {
            const next = side === 'buy' ? firstFillPrice - idx * stepPrice : firstFillPrice + idx * stepPrice;
            if (side === 'buy' && next < rangeLow - PRICE_EPS)
                break;
            if (side === 'sell' && next > rangeHigh + PRICE_EPS)
                break;
            rawPrices.push(next);
        }
    }
    const normalized = normalizeLayerPrices({ candidateRawPrices: rawPrices, rangeLow, rangeHigh, symbolDigits });
    if (!normalized.ok) {
        return { ok: false, mode: 'dynamic', reason: normalized.reason === 'invalid_range' ? 'anchor_unrepresentable_at_precision' : normalized.reason };
    }
    const executableAnchorPrice = normalized.normalizedCandidatePrices[0];
    return freezeSuccess({
        ok: true,
        mode: 'dynamic',
        side,
        rangeLow,
        rangeHigh,
        rawAnchorPrice: firstFillPrice,
        executableAnchorPrice,
        requestedLayerCount: maxTotalLayers,
        actualLayerCount: normalized.normalizedCandidatePrices.length,
        candidateRawPrices: normalized.candidateRawPrices,
        normalizedCandidatePrices: normalized.normalizedCandidatePrices,
        duplicateLevelsRemoved: normalized.duplicateLevelsRemoved,
        skippedLevels: normalized.skippedLevels,
        reasons: uniqueReasons([...reasons, ...normalized.reasons]),
    });
}
function buildCalculatedLayerPlan(input) {
    if (input.sizingPlan) {
        const fundedPrices = input.pricePlan.normalizedCandidatePrices.slice(0, input.sizingPlan.effectiveLayerCount);
        const unfundedPrices = input.pricePlan.normalizedCandidatePrices.slice(input.sizingPlan.effectiveLayerCount);
        const unfundedIndexes = unfundedPrices.map((_, idx) => input.sizingPlan.effectiveLayerCount + idx);
        return freezeSuccess({
            ...input.pricePlan,
            actualLayerCount: input.sizingPlan.effectiveLayerCount,
            fundedPrices: Object.freeze(fundedPrices),
            unfundedPrices: Object.freeze(unfundedPrices),
            unfundedIndexes: Object.freeze(unfundedIndexes),
            lots: input.sizingPlan.lots,
            intendedTotalLot: input.sizingPlan.intendedTotalLot,
            allocatedTotalLot: input.sizingPlan.allocatedTotalLot,
            unallocatedLot: input.sizingPlan.unallocatedLot,
            theoreticalLayerCount: input.sizingPlan.theoreticalLayerCount,
            effectiveStepPips: input.sizingPlan.effectiveStepPips,
            requestedLayerPercent: input.sizingPlan.requestedLayerPercent,
            effectiveLayerPercent: input.sizingPlan.effectiveLayerPercent,
            allocationPercentTotal: input.sizingPlan.allocationPercentTotal,
            optimizationStrategy: input.sizingPlan.optimizationStrategy,
            reasons: uniqueReasons([...input.pricePlan.reasons, ...input.sizingPlan.warnings]),
        });
    }
    if (input.layerPercent != null
        && input.rangeDistancePips != null
        && input.stepPips != null) {
        const sizingPlan = (0, layerSizingConstraints_1.solveLayerSizingConstraints)({
            rangeDistancePips: input.rangeDistancePips,
            stepPips: input.stepPips,
            totalLot: input.intendedTotalLot,
            minLot: input.minLot,
            lotStep: input.lotStep,
            layerPercent: input.layerPercent,
            optimizationStrategy: input.optimizationStrategy,
            maxLayerCount: input.pricePlan.normalizedCandidatePrices.length,
        });
        if (!sizingPlan.ok)
            return { ok: false, mode: input.pricePlan.mode, reason: sizingPlan.reason };
        return buildCalculatedLayerPlan({ ...input, sizingPlan });
    }
    const allocation = (0, layerLotAllocation_1.allocateLayerLots)({
        intendedTotalLot: input.intendedTotalLot,
        layerCount: input.pricePlan.normalizedCandidatePrices.length,
        minLot: input.minLot,
        lotStep: input.lotStep,
    });
    if (!allocation.ok)
        return { ok: false, mode: input.pricePlan.mode, reason: allocation.reason };
    const fundedPrices = input.pricePlan.normalizedCandidatePrices.slice(0, allocation.fundedLayerCount);
    const unfundedPrices = input.pricePlan.normalizedCandidatePrices.slice(allocation.fundedLayerCount);
    const unfundedIndexes = unfundedPrices.map((_, idx) => allocation.fundedLayerCount + idx);
    return freezeSuccess({
        ...input.pricePlan,
        actualLayerCount: allocation.fundedLayerCount,
        fundedPrices: Object.freeze(fundedPrices),
        unfundedPrices: Object.freeze(unfundedPrices),
        unfundedIndexes: Object.freeze(unfundedIndexes),
        lots: allocation.lots,
        intendedTotalLot: allocation.intendedTotalLot,
        allocatedTotalLot: allocation.allocatedTotalLot,
        unallocatedLot: allocation.unallocatedLot,
        theoreticalLayerCount: null,
        effectiveStepPips: null,
        requestedLayerPercent: null,
        effectiveLayerPercent: null,
        allocationPercentTotal: null,
        optimizationStrategy: null,
        reasons: uniqueReasons([...input.pricePlan.reasons, ...allocation.reasons]),
    });
}
function calculateStaticLayerPlan(input) {
    const pricePlan = calculateStaticLayerPrices(input);
    if (!pricePlan.ok)
        return pricePlan;
    const rangeDistance = input.rangeHigh - input.rangeLow;
    const step = input.totalLayerCount > 1 ? rangeDistance / (input.totalLayerCount - 1) : rangeDistance || 1;
    return buildCalculatedLayerPlan({ pricePlan, rangeDistancePips: rangeDistance || 1, stepPips: step || 1, ...input });
}
function calculateDynamicLayerPlan(input) {
    const farBoundary = input.side === 'buy' ? input.rangeLow : input.rangeHigh;
    const remainingDistancePips = input.side === 'buy'
        ? (input.firstFillPrice - farBoundary) / input.pipSize
        : (farBoundary - input.firstFillPrice) / input.pipSize;
    const sizingPlan = input.layerPercent == null
        ? null
        : (0, layerSizingConstraints_1.solveLayerSizingConstraints)({
            rangeDistancePips: remainingDistancePips,
            stepPips: input.stepPips,
            totalLot: input.intendedTotalLot,
            minLot: input.minLot,
            lotStep: input.lotStep,
            layerPercent: input.layerPercent,
            optimizationStrategy: input.optimizationStrategy,
            maxLayerCount: input.maxTotalLayers,
        });
    if (sizingPlan && !sizingPlan.ok)
        return { ok: false, mode: 'dynamic', reason: sizingPlan.reason };
    const pricePlan = calculateDynamicLayerPrices({
        ...input,
        stepPips: sizingPlan?.effectiveStepPips ?? input.stepPips,
        maxTotalLayers: sizingPlan?.effectiveLayerCount ?? input.maxTotalLayers,
    });
    if (!pricePlan.ok)
        return pricePlan;
    return buildCalculatedLayerPlan({ pricePlan, sizingPlan: sizingPlan ?? undefined, ...input });
}
