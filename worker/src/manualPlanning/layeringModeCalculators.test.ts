import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  buildCalculatedLayerPlan,
  calculateDynamicLayerPlan,
  calculateDynamicLayerPrices,
  calculateStaticLayerPlan,
  calculateStaticLayerPrices,
  normalizeLayerPrices,
} from './layeringModeCalculators'
import type { LayerPlanReason } from './layeringModeCalculators'

const staticBase = Object.freeze({
  side: 'buy' as const,
  rangeLow: 3340,
  rangeHigh: 3360,
  totalLayerCount: 5,
  symbolDigits: 2,
})

const dynamicBase = Object.freeze({
  side: 'buy' as const,
  rangeLow: 3340,
  rangeHigh: 3360,
  firstFillPrice: 3356,
  stepPips: 4,
  maxTotalLayers: 5,
  pipSize: 1,
  symbolDigits: 2,
})

function assertReason(result: { ok: boolean; reason?: LayerPlanReason }, reason: LayerPlanReason): void {
  assert.equal(result.ok, false)
  assert.equal(result.reason, reason)
}

test('static prices: BUY 3340-3360 with 5 layers', () => {
  const out = calculateStaticLayerPrices(staticBase)
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3360, 3355, 3350, 3345, 3340])
})

test('static prices: SELL 3340-3360 with 5 layers', () => {
  const out = calculateStaticLayerPrices({ ...staticBase, side: 'sell' })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3340, 3345, 3350, 3355, 3360])
})

test('static prices: one layer uses start boundary by side', () => {
  const buy = calculateStaticLayerPrices({ ...staticBase, totalLayerCount: 1 })
  const sell = calculateStaticLayerPrices({ ...staticBase, side: 'sell', totalLayerCount: 1 })
  assert.equal(buy.ok, true)
  assert.equal(sell.ok, true)
  assert.deepEqual(buy.normalizedCandidatePrices, [3360])
  assert.deepEqual(sell.normalizedCandidatePrices, [3340])
})

test('static prices: two layers include exact boundaries', () => {
  const buy = calculateStaticLayerPrices({ ...staticBase, totalLayerCount: 2 })
  const sell = calculateStaticLayerPrices({ ...staticBase, side: 'sell', totalLayerCount: 2 })
  assert.equal(buy.ok, true)
  assert.equal(sell.ok, true)
  assert.deepEqual(buy.normalizedCandidatePrices, [3360, 3340])
  assert.deepEqual(sell.normalizedCandidatePrices, [3340, 3360])
})

test('static prices: ten layers preserve directional order', () => {
  const buy = calculateStaticLayerPrices({ ...staticBase, totalLayerCount: 10 })
  const sell = calculateStaticLayerPrices({ ...staticBase, side: 'sell', totalLayerCount: 10 })
  assert.equal(buy.ok, true)
  assert.equal(sell.ok, true)
  assert.equal(buy.normalizedCandidatePrices.length, 10)
  assert.equal(sell.normalizedCandidatePrices.length, 10)
  assert.ok(buy.normalizedCandidatePrices.every((p, idx, arr) => idx === 0 || p < arr[idx - 1]!))
  assert.ok(sell.normalizedCandidatePrices.every((p, idx, arr) => idx === 0 || p > arr[idx - 1]!))
})

test('static prices: invalid counts and ranges are rejected', () => {
  assert.deepEqual(calculateStaticLayerPrices({ ...staticBase, totalLayerCount: 0 }), {
    ok: false,
    mode: 'static',
    reason: 'invalid_layer_count',
  })
  assertReason(calculateStaticLayerPrices({ ...staticBase, totalLayerCount: -1 }), 'invalid_layer_count')
  assertReason(calculateStaticLayerPrices({ ...staticBase, totalLayerCount: 1.5 }), 'invalid_layer_count')
  assertReason(calculateStaticLayerPrices({ ...staticBase, totalLayerCount: 21 }), 'invalid_layer_count')
  assertReason(calculateStaticLayerPrices({ ...staticBase, rangeLow: 3360, rangeHigh: 3340 }), 'invalid_range')
})

test('static prices: zero-width range allows one layer but rejects multiple', () => {
  const one = calculateStaticLayerPrices({ ...staticBase, rangeLow: 3340, rangeHigh: 3340, totalLayerCount: 1 })
  assert.equal(one.ok, true)
  assert.deepEqual(one.normalizedCandidatePrices, [3340])
  assertReason(calculateStaticLayerPrices({ ...staticBase, rangeLow: 3340, rangeHigh: 3340, totalLayerCount: 2 }), 'invalid_range')
})

test('static prices: rejects non-finite range and invalid digits', () => {
  assertReason(calculateStaticLayerPrices({ ...staticBase, rangeLow: Number.NaN }), 'invalid_range')
  assertReason(calculateStaticLayerPrices({ ...staticBase, rangeHigh: Number.POSITIVE_INFINITY }), 'invalid_range')
  assertReason(calculateStaticLayerPrices({ ...staticBase, symbolDigits: 1.5 }), 'invalid_symbol_digits')
})

test('static prices: precision rounding, dedupe reduction, bounds, and negative zero', () => {
  const rounded = calculateStaticLayerPrices({ ...staticBase, rangeLow: 1, rangeHigh: 1.02, totalLayerCount: 3, symbolDigits: 1 })
  assert.equal(rounded.ok, true)
  assert.deepEqual(rounded.normalizedCandidatePrices, [1])
  assert.equal(rounded.duplicateLevelsRemoved, 2)
  assert.ok(rounded.reasons.includes('duplicate_price_after_rounding'))

  const zero = calculateStaticLayerPrices({ ...staticBase, rangeLow: -0.004, rangeHigh: 0.004, totalLayerCount: 1, symbolDigits: 2 })
  assert.equal(zero.ok, true)
  assert.equal(Object.is(zero.normalizedCandidatePrices[0], -0), false)
})

test('static prices: input not mutated and deterministic repeated output', () => {
  const input = { ...staticBase }
  const before = JSON.stringify(input)
  const a = calculateStaticLayerPrices(input)
  const b = calculateStaticLayerPrices(input)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(a, b)
})

test('dynamic prices: BUY anchor 3356 toward 3340', () => {
  const out = calculateDynamicLayerPrices(dynamicBase)
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3356, 3352, 3348, 3344, 3340])
  assert.equal(out.executableAnchorPrice, 3356)
})

test('dynamic prices: SELL anchor 3344 toward 3360', () => {
  const out = calculateDynamicLayerPrices({ ...dynamicBase, side: 'sell', firstFillPrice: 3344 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3344, 3348, 3352, 3356, 3360])
})

test('dynamic prices: max cap and anchor counts as first layer', () => {
  const out = calculateDynamicLayerPrices({ ...dynamicBase, maxTotalLayers: 3 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3356, 3352, 3348])
  assert.equal(out.requestedLayerCount, 3)
})

test('dynamic prices: anchor at far boundary or less than one step leaves anchor only', () => {
  const boundary = calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: 3340 })
  const short = calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: 3342, stepPips: 4 })
  assert.equal(boundary.ok, true)
  assert.equal(short.ok, true)
  assert.deepEqual(boundary.normalizedCandidatePrices, [3340])
  assert.deepEqual(short.normalizedCandidatePrices, [3342])
  assert.ok(boundary.reasons.includes('insufficient_remaining_distance'))
  assert.ok(short.reasons.includes('insufficient_remaining_distance'))
})

test('dynamic prices: unrepresentable outside anchors fail closed', () => {
  const below = calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: 3339 })
  const above = calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: 3361 })
  assertReason(below, 'anchor_unrepresentable_at_precision')
  assertReason(above, 'anchor_unrepresentable_at_precision')
})

test('dynamic prices: in-range anchors that round outside range are rejected as unrepresentable', () => {
  assertReason(calculateDynamicLayerPrices({
    ...dynamicBase,
    rangeLow: 1.001,
    rangeHigh: 1.004,
    firstFillPrice: 1.004,
    stepPips: 1,
    pipSize: 0.001,
    symbolDigits: 2,
  }), 'anchor_unrepresentable_at_precision')
  assertReason(calculateDynamicLayerPrices({
    ...dynamicBase,
    rangeLow: 1.996,
    rangeHigh: 1.999,
    firstFillPrice: 1.996,
    stepPips: 1,
    pipSize: 0.001,
    symbolDigits: 2,
  }), 'anchor_unrepresentable_at_precision')
})

test('dynamic prices: outside anchors can only return anchor-only when precision keeps them inside range', () => {
  const below = calculateDynamicLayerPrices({
    ...dynamicBase,
    rangeLow: 1,
    rangeHigh: 2,
    firstFillPrice: 0.999,
    stepPips: 1,
    pipSize: 0.01,
    symbolDigits: 2,
  })
  assert.equal(below.ok, true)
  assert.deepEqual(below.normalizedCandidatePrices, [1])
  assert.equal(below.rawAnchorPrice, 0.999)
  assert.equal(below.executableAnchorPrice, 1)
  assert.ok(below.reasons.includes('anchor_outside_range'))

  assertReason(calculateDynamicLayerPrices({
    ...dynamicBase,
    rangeLow: 1,
    rangeHigh: 2,
    firstFillPrice: 0.99,
    stepPips: 1,
    pipSize: 0.01,
    symbolDigits: 2,
  }), 'anchor_unrepresentable_at_precision')
})

test('dynamic prices: boundary epsilon does not add a partial layer past the boundary', () => {
  const out = calculateDynamicLayerPrices({
    ...dynamicBase,
    rangeLow: 1,
    rangeHigh: 2,
    firstFillPrice: 1.3,
    stepPips: 0.1 + 0.2,
    pipSize: 1,
    maxTotalLayers: 3,
    symbolDigits: 6,
  })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [1.3, 1])
})

test('dynamic prices: exact final boundary included and partial final step skipped', () => {
  const exact = calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: 3352, stepPips: 6, maxTotalLayers: 3 })
  const partial = calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: 3353, stepPips: 6, maxTotalLayers: 4 })
  assert.equal(exact.ok, true)
  assert.equal(partial.ok, true)
  assert.deepEqual(exact.normalizedCandidatePrices, [3352, 3346, 3340])
  assert.deepEqual(partial.normalizedCandidatePrices, [3353, 3347, 3341])
})

test('dynamic prices: invalid step, pip size, anchor, and max count rejected', () => {
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, side: 'hold' as never }), 'invalid_side')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, stepPips: 0 }), 'invalid_step_pips')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, stepPips: -1 }), 'invalid_step_pips')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, stepPips: Number.NaN }), 'invalid_step_pips')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, stepPips: Number.POSITIVE_INFINITY }), 'invalid_step_pips')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, pipSize: 0 }), 'invalid_pip_size')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, firstFillPrice: Number.NaN }), 'invalid_anchor')
  assertReason(calculateDynamicLayerPrices({ ...dynamicBase, maxTotalLayers: 1.5 }), 'invalid_layer_count')
})

test('dynamic prices: one maximum layer returns anchor only', () => {
  const out = calculateDynamicLayerPrices({ ...dynamicBase, maxTotalLayers: 1 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3356])
})

test('dynamic prices: rounded duplicate levels are removed without recalculating spacing', () => {
  const out = calculateDynamicLayerPrices({
    ...dynamicBase,
    firstFillPrice: 1.004,
    rangeLow: 0.996,
    rangeHigh: 1.01,
    stepPips: 0.002,
    pipSize: 1,
    symbolDigits: 2,
  })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [1])
  assert.equal(out.duplicateLevelsRemoved, 4)
})

test('dynamic prices: supports max layers, tiny pip size, and large supported digits', () => {
  const out = calculateDynamicLayerPrices({
    ...dynamicBase,
    rangeLow: 1.00000001,
    rangeHigh: 1.00000020,
    firstFillPrice: 1.00000020,
    stepPips: 1,
    pipSize: 0.00000001,
    maxTotalLayers: 20,
    symbolDigits: 8,
  })
  assert.equal(out.ok, true)
  assert.equal(out.normalizedCandidatePrices.length, 20)
  assert.equal(out.normalizedCandidatePrices[0], 1.0000002)
  assert.equal(out.normalizedCandidatePrices[19], 1.00000001)
})

test('dynamic prices: levels stay inside range and on averaging side', () => {
  const buy = calculateDynamicLayerPrices(dynamicBase)
  const sell = calculateDynamicLayerPrices({ ...dynamicBase, side: 'sell', firstFillPrice: 3344 })
  assert.equal(buy.ok, true)
  assert.equal(sell.ok, true)
  assert.ok(buy.normalizedCandidatePrices.every(p => p >= 3340 && p <= 3360 && p <= 3356))
  assert.ok(sell.normalizedCandidatePrices.every(p => p >= 3340 && p <= 3360 && p >= 3344))
})

test('dynamic prices: input not mutated and deterministic repeated output', () => {
  const input = { ...dynamicBase }
  const before = JSON.stringify(input)
  const a = calculateDynamicLayerPrices(input)
  const b = calculateDynamicLayerPrices(input)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(a, b)
})

test('normalizeLayerPrices: preserves order, reports duplicates, rejects non-finite and bounds', () => {
  const out = normalizeLayerPrices({ candidateRawPrices: [3, 2, 2.004, 1], rangeLow: 1, rangeHigh: 3, symbolDigits: 2 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3, 2, 1])
  assert.deepEqual(out.duplicateSourceIndexes, [2])

  assertReason(normalizeLayerPrices({ candidateRawPrices: [1, Number.NaN], rangeLow: 1, rangeHigh: 2, symbolDigits: 2 }), 'no_valid_layers')
  assertReason(normalizeLayerPrices({ candidateRawPrices: [3], rangeLow: 1, rangeHigh: 2, symbolDigits: 2 }), 'invalid_range')
})

test('normalizeLayerPrices: precision behavior matches toFixed convention', () => {
  const out = normalizeLayerPrices({ candidateRawPrices: [1.234, 1.235, 1.236], rangeLow: 1, rangeHigh: 2, symbolDigits: 2 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [1.23, 1.24])
})

test('combined plans: static prices and lots align by index', () => {
  const out = calculateStaticLayerPlan({ ...staticBase, intendedTotalLot: 0.10, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3360, 3355, 3350, 3345, 3340])
  assert.deepEqual(out.fundedPrices, [3360, 3355, 3350, 3345, 3340])
  assert.deepEqual(out.lots, [0.02, 0.02, 0.02, 0.02, 0.02])
})

test('combined plans: dynamic prices and lots align by index', () => {
  const out = calculateDynamicLayerPlan({ ...dynamicBase, intendedTotalLot: 0.10, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3356, 3352, 3348, 3344, 3340])
  assert.deepEqual(out.fundedPrices, [3356, 3352, 3348, 3344, 3340])
  assert.deepEqual(out.lots, [0.02, 0.02, 0.02, 0.02, 0.02])
})

test('combined plans: reduced funded count removes unfunded prices deterministically', () => {
  const pricePlan = calculateStaticLayerPrices(staticBase)
  assert.equal(pricePlan.ok, true)
  const out = buildCalculatedLayerPlan({ pricePlan, intendedTotalLot: 0.03, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [3360, 3355, 3350, 3345, 3340])
  assert.deepEqual(out.fundedPrices, [3360, 3355, 3350])
  assert.deepEqual(out.unfundedPrices, [3345, 3340])
  assert.deepEqual(out.unfundedIndexes, [3, 4])
  assert.deepEqual(out.lots, [0.01, 0.01, 0.01])
  assert.ok(out.reasons.includes('funded_layer_count_reduced'))
  assert.equal(out.reasons.filter(r => r === 'funded_layer_count_reduced').length, 1)
})

test('combined plans: duplicate prices are removed before allocation and total never increases', () => {
  const out = calculateStaticLayerPlan({
    ...staticBase,
    rangeLow: 1,
    rangeHigh: 1.02,
    symbolDigits: 1,
    intendedTotalLot: 0.10,
    minLot: 0.01,
    lotStep: 0.01,
  })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [1])
  assert.deepEqual(out.fundedPrices, [1])
  assert.deepEqual(out.lots, [0.10])
  assert.equal(out.allocatedTotalLot, 0.10)
  assert.equal(out.unallocatedLot, 0)
  assert.ok(out.reasons.includes('duplicate_price_after_rounding'))
})

test('combined plans: stable reason codes and allocation remainder', () => {
  const out = calculateStaticLayerPlan({ ...staticBase, intendedTotalLot: 0.127, minLot: 0.01, lotStep: 0.01 })
  assert.equal(out.ok, true)
  assert.equal(out.allocatedTotalLot, 0.12)
  assert.equal(out.unallocatedLot, 0.007)
  assert.ok(out.reasons.includes('allocation_reduced_by_lot_step'))
})

test('combined plans: static solver exposes recalculated percentage allocation', () => {
  const out = calculateStaticLayerPlan({
    ...staticBase,
    totalLayerCount: 6,
    intendedTotalLot: 1,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 25,
    optimizationStrategy: 'adjust_percent',
  })
  assert.equal(out.ok, true)
  assert.equal(out.theoreticalLayerCount, 6)
  assert.equal(out.actualLayerCount, 6)
  assert.equal(out.requestedLayerPercent, 25)
  assert.equal(out.effectiveLayerPercent, 16)
  assert.equal(out.allocationPercentTotal, 96)
  assert.deepEqual(out.lots, [0.16, 0.16, 0.16, 0.16, 0.16, 0.16])
  assert.ok(out.reasons.includes('layer_percent_recalculated'))
})

test('combined plans: dynamic solver can widen step before geometry is generated', () => {
  const out = calculateDynamicLayerPlan({
    side: 'buy',
    rangeLow: 3300,
    rangeHigh: 3360,
    firstFillPrice: 3360,
    stepPips: 10,
    maxTotalLayers: 10,
    pipSize: 1,
    symbolDigits: 2,
    intendedTotalLot: 1,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 25,
    optimizationStrategy: 'widen_step',
  })
  assert.equal(out.ok, true)
  assert.equal(out.theoreticalLayerCount, 7)
  assert.equal(out.actualLayerCount, 4)
  assert.equal(out.effectiveStepPips, 20)
  assert.deepEqual(out.fundedPrices, [3360, 3340, 3320, 3300])
  assert.equal(out.allocationPercentTotal, 100)
  assert.ok(out.reasons.includes('step_distance_recalculated'))
})

test('combined plans: no allocation returns non-persistable failure', () => {
  const out = calculateStaticLayerPlan({ ...staticBase, intendedTotalLot: 0.005, minLot: 0.01, lotStep: 0.01 })
  assert.deepEqual(out, { ok: false, mode: 'static', reason: 'total_lot_below_minimum' })
})

test('combined plans: duplicate dedupe and funding reduction keep active field coherent', () => {
  const out = calculateStaticLayerPlan({
    ...staticBase,
    rangeLow: 1,
    rangeHigh: 1.04,
    totalLayerCount: 5,
    symbolDigits: 1,
    intendedTotalLot: 0.02,
    minLot: 0.01,
    lotStep: 0.01,
  })
  assert.equal(out.ok, true)
  assert.deepEqual(out.normalizedCandidatePrices, [1])
  assert.deepEqual(out.fundedPrices, [1])
  assert.deepEqual(out.unfundedPrices, [])
  assert.equal(out.fundedPrices.length, out.lots.length)
  assert.equal(out.actualLayerCount, out.fundedPrices.length)
  assert.equal(new Set(out.reasons).size, out.reasons.length)
})

test('calculator modules are not imported by legacy planner or executor paths', () => {
  const files = [
    'src/manualPlanner.ts',
    'src/manualPlanning/planManualOrders.ts',
    'src/manualPlanning/planMultiManualOrders.ts',
    'src/tradeExecutor/entryPrepare.ts',
    'src/virtualPendingMonitor.ts',
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /layeringModeCalculators|layerLotAllocation/)
  }
})

