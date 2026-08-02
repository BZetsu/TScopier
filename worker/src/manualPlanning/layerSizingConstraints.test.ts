import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { solveLayerSizingConstraints } from './layerSizingConstraints'

test('solveLayerSizingConstraints: computes theoretical layers from range and step', () => {
  const out = solveLayerSizingConstraints({
    rangeDistancePips: 20,
    stepPips: 5,
    totalLot: 1,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 10,
  })
  assert.equal(out.ok, true)
  assert.equal(out.theoreticalLayerCount, 5)
  assert.equal(out.effectiveLayerCount, 5)
  assert.deepEqual(out.lots, [0.1, 0.1, 0.1, 0.1, 0.1])
  assert.equal(out.allocationPercentTotal, 50)
})

test('solveLayerSizingConstraints: recalculates per-layer percent when cumulative allocation exceeds 100%', () => {
  const out = solveLayerSizingConstraints({
    rangeDistancePips: 50,
    stepPips: 10,
    totalLot: 1,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 25,
    optimizationStrategy: 'adjust_percent',
  })
  assert.equal(out.ok, true)
  assert.equal(out.theoreticalLayerCount, 6)
  assert.equal(out.effectiveLayerCount, 6)
  assert.equal(out.lotPerLayer, 0.16)
  assert.equal(out.effectiveLayerPercent, 16)
  assert.equal(out.allocationPercentTotal, 96)
  assert.ok(out.warnings.includes('layer_percent_recalculated'))
})

test('solveLayerSizingConstraints: reduces layer count when selected strategy preserves percent', () => {
  const out = solveLayerSizingConstraints({
    rangeDistancePips: 50,
    stepPips: 10,
    totalLot: 1,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 25,
    optimizationStrategy: 'reduce_layers',
  })
  assert.equal(out.ok, true)
  assert.equal(out.theoreticalLayerCount, 6)
  assert.equal(out.effectiveLayerCount, 4)
  assert.equal(out.effectiveLayerPercent, 25)
  assert.equal(out.allocationPercentTotal, 100)
  assert.ok(out.warnings.includes('layer_count_reduced_by_percentage'))
})

test('solveLayerSizingConstraints: widens step distance when layer count must fall', () => {
  const out = solveLayerSizingConstraints({
    rangeDistancePips: 50,
    stepPips: 10,
    totalLot: 1,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 25,
    optimizationStrategy: 'widen_step',
  })
  assert.equal(out.ok, true)
  assert.equal(out.effectiveLayerCount, 4)
  assert.equal(out.effectiveStepPips, 16.66666667)
  assert.ok(out.warnings.includes('step_distance_recalculated'))
})

test('solveLayerSizingConstraints: broker minimum lot can force a valid reduced plan', () => {
  const out = solveLayerSizingConstraints({
    rangeDistancePips: 90,
    stepPips: 10,
    totalLot: 0.05,
    minLot: 0.02,
    lotStep: 0.01,
    layerPercent: 10,
    optimizationStrategy: 'adjust_percent',
  })
  assert.equal(out.ok, true)
  assert.equal(out.theoreticalLayerCount, 10)
  assert.equal(out.effectiveLayerCount, 2)
  assert.deepEqual(out.lots, [0.02, 0.02])
  assert.equal(out.allocatedTotalLot, 0.04)
  assert.ok(out.warnings.includes('optimization_strategy_fallback'))
  assert.ok(out.warnings.includes('layer_count_reduced_by_minimum_lot'))
})

test('solveLayerSizingConstraints: impossible totals return validation failures', () => {
  const out = solveLayerSizingConstraints({
    rangeDistancePips: 20,
    stepPips: 5,
    totalLot: 0.005,
    minLot: 0.01,
    lotStep: 0.01,
    layerPercent: 10,
  })
  assert.deepEqual(out, { ok: false, reason: 'total_lot_below_minimum' })
})
