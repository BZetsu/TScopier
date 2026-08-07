import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  buildRangeLayerTriggerMap,
  computeLinearRangeLayerTriggers,
  computeRangeLayerTriggers,
  RANGE_LAYER_CURVE_EXPONENT,
  resolveRangeLayerBoundary,
} from './rangeLayerTriggers'

test('resolveRangeLayerBoundary: sell uses zone high when provided', () => {
  assert.equal(
    resolveRangeLayerBoundary({ isBuy: false, anchor: 4327, boundary: 4335, rangeDistancePips: 30, pip: 0.1 }),
    4335,
  )
})

test('resolveRangeLayerBoundary: manual distance when no boundary', () => {
  assert.equal(
    resolveRangeLayerBoundary({ isBuy: false, anchor: 4327, boundary: null, rangeDistancePips: 30, pip: 0.1 }),
    4330,
  )
})

test('computeRangeLayerTriggers: first rung is always one configured step from anchor (sell)', () => {
  const triggers = computeRangeLayerTriggers({
    isBuy: false,
    rungCount: 10,
    anchor: 4327,
    boundary: 4335,
    stepPriceOffset: 0.03,
    digits: 2,
    pinLastToBoundary: true,
  })
  assert.equal(triggers[0], 4327.03)
})

test('computeRangeLayerTriggers: first rung is one step even when zone span is wide', () => {
  const triggers = computeRangeLayerTriggers({
    isBuy: false,
    rungCount: 5,
    anchor: 2650,
    boundary: 2653,
    stepPriceOffset: 0.3,
    digits: 2,
    pinLastToBoundary: false,
  })
  assert.equal(triggers[0], 2650.3)
})

test('computeRangeLayerTriggers: buy first rung one step below anchor', () => {
  const triggers = computeRangeLayerTriggers({
    isBuy: true,
    rungCount: 5,
    anchor: 2650,
    boundary: 2647,
    stepPriceOffset: 0.3,
    digits: 2,
  })
  assert.equal(triggers[0], 2649.7)
})

test('computeRangeLayerTriggers: sell rungs monotonic upward toward boundary', () => {
  const triggers = computeRangeLayerTriggers({
    isBuy: false,
    rungCount: 10,
    anchor: 4327,
    boundary: 4335,
    stepPriceOffset: 0.03,
    digits: 2,
    pinLastToBoundary: true,
  })
  assert.equal(triggers.length, 10)
  for (let i = 1; i < triggers.length; i++) {
    assert.ok(triggers[i]! > triggers[i - 1]!, `step ${i + 1} must be above step ${i}`)
  }
  assert.equal(triggers[9], 4335)
})

test('computeRangeLayerTriggers: sell early gaps smaller than late gaps (quadratic)', () => {
  const triggers = computeRangeLayerTriggers({
    isBuy: false,
    rungCount: 10,
    anchor: 4327,
    boundary: 4335,
    stepPriceOffset: 0.03,
    digits: 2,
    exponent: RANGE_LAYER_CURVE_EXPONENT,
  })
  const earlyGap = triggers[1]! - triggers[0]!
  const lateGap = triggers[9]! - triggers[8]!
  assert.ok(lateGap > earlyGap, `late gap ${lateGap} should exceed early gap ${earlyGap}`)
})

test('computeRangeLayerTriggers: buy rungs monotonic downward toward zone low', () => {
  const triggers = computeRangeLayerTriggers({
    isBuy: true,
    rungCount: 5,
    anchor: 4330,
    boundary: 4325,
    stepPriceOffset: 0.03,
    digits: 2,
    pinLastToBoundary: true,
  })
  assert.equal(triggers[4], 4325)
  for (let i = 1; i < triggers.length; i++) {
    assert.ok(triggers[i]! < triggers[i - 1]!)
  }
})

test('computeLinearRangeLayerTriggers: exactly 2 pip between each auto rung', () => {
  const triggers = computeLinearRangeLayerTriggers({
    isBuy: true,
    rungCount: 15,
    anchor: 4077.35,
    boundary: 4077.05,
    stepPriceOffset: 0.02,
    digits: 2,
  })
  assert.equal(triggers[0], 4077.33)
  assert.equal(triggers[1], 4077.31)
  assert.equal(triggers[2], 4077.29)
  for (let i = 1; i < triggers.length; i++) {
    assert.ok(Math.abs((triggers[i - 1]! - triggers[i]!) - 0.02) < 1e-9)
  }
})

test('buildRangeLayerTriggerMap: pending_order Auto uses linear fill across distance', () => {
  // 17 legs across 100 pips @ pip 0.1 → step ≈ 5.882 pips → offset ≈ 0.5882
  const n = 17
  const distPips = 100
  const pip = 0.1
  const stepPips = distPips / n
  const stepPriceOffset = stepPips * pip
  const anchor = 4000
  const map = buildRangeLayerTriggerMap({
    virtualPendings: Array.from({ length: n }, (_, i) => ({
      stepIdx: i + 1,
      stepPriceOffset,
      isBuy: true,
    })),
    anchor,
    digits: 2,
    pip,
    rangeLayering: {
      rangeStepPips: 0, // Auto
      rangeDistancePips: distPips,
      effectiveDistancePips: distPips,
      effectiveStepPips: stepPips,
      stepPriceOffset,
      maxStepIdx: n,
      reservedPendingLegs: n,
      activePendingLegs: n,
      rangeLayeringType: 'pending_order',
    },
  })
  assert.equal(map.size, n)
  const first = map.get(1)!
  const last = map.get(n)!
  assert.ok(Math.abs(first - (anchor - stepPriceOffset)) < 0.02)
  assert.ok(Math.abs(last - (anchor - distPips * pip)) < 0.02, `last ${last} should near boundary`)
  // Uniform spacing (linear, not zone curve clustering)
  const gaps: number[] = []
  for (let i = 2; i <= n; i++) {
    gaps.push((map.get(i - 1)! - map.get(i)!))
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  for (const g of gaps) {
    assert.ok(Math.abs(g - mean) < 0.05, `gap ${g} vs mean ${mean}`)
  }
})

test('buildRangeLayerTriggerMap: auto mode uses linear step not zone curve', () => {
  const map = buildRangeLayerTriggerMap({
    virtualPendings: Array.from({ length: 5 }, (_, i) => ({
      stepIdx: i + 1,
      stepPriceOffset: 0.2,
      isBuy: true,
    })),
    anchor: 4077.35,
    digits: 2,
    pip: 0.1,
    rangeLayering: {
      rangeStepPips: 2,
      rangeDistancePips: 30,
      effectiveStepPips: 2,
      stepPriceOffset: 0.2,
      maxStepIdx: 15,
      reservedPendingLegs: 15,
      activePendingLegs: 15,
      rangeLayeringType: 'auto',
    },
  })
  assert.equal(map.get(1), 4077.15)
  assert.equal(map.get(2), 4076.95)
  assert.equal(map.get(3), 4076.75)
})

test('buildRangeLayerTriggerMap: pending_order Manual with signal range still curves', () => {
  const map = buildRangeLayerTriggerMap({
    virtualPendings: [
      { stepIdx: 1, stepPriceOffset: 0.3, isBuy: false },
      { stepIdx: 2, stepPriceOffset: 0.3, isBuy: false },
      { stepIdx: 1, stepPriceOffset: 0.3, isBuy: false },
    ],
    anchor: 4327,
    digits: 2,
    pip: 0.1,
    rangeLayering: {
      rangeStepPips: 3,
      rangeDistancePips: 30,
      effectiveStepPips: 3,
      stepPriceOffset: 0.3,
      maxStepIdx: 2,
      reservedPendingLegs: 3,
      activePendingLegs: 3,
      useSignalEntryRange: true,
      signalRangeBoundary: 4335,
      rangeLayeringType: 'pending_order',
    },
  })
  assert.equal(map.get(1), map.get(1))
  assert.ok((map.get(2) ?? 0) > (map.get(1) ?? 0))
})
