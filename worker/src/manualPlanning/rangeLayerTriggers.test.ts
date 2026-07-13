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
    resolveRangeLayerBoundary({ isBuy: false, anchor: 4327, boundary: 4335, rangeDistancePips: 30, pip: 0.01 }),
    4335,
  )
})

test('resolveRangeLayerBoundary: manual distance when no boundary', () => {
  assert.equal(
    resolveRangeLayerBoundary({ isBuy: false, anchor: 4327, boundary: null, rangeDistancePips: 30, pip: 0.01 }),
    4327.3,
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

test('buildRangeLayerTriggerMap: auto mode uses linear step not zone curve', () => {
  const map = buildRangeLayerTriggerMap({
    virtualPendings: Array.from({ length: 5 }, (_, i) => ({
      stepIdx: i + 1,
      stepPriceOffset: 0.02,
      isBuy: true,
    })),
    anchor: 4077.35,
    digits: 2,
    pip: 0.01,
    rangeLayering: {
      rangeStepPips: 2,
      rangeDistancePips: 30,
      effectiveStepPips: 2,
      stepPriceOffset: 0.02,
      maxStepIdx: 15,
      reservedPendingLegs: 15,
      activePendingLegs: 15,
      rangeLayeringType: 'auto',
    },
  })
  assert.equal(map.get(1), 4077.33)
  assert.equal(map.get(2), 4077.31)
  assert.equal(map.get(3), 4077.29)
})

test('buildRangeLayerTriggerMap: pending_order shares stepIdx trigger', () => {
  const map = buildRangeLayerTriggerMap({
    virtualPendings: [
      { stepIdx: 1, stepPriceOffset: 0.03, isBuy: false },
      { stepIdx: 2, stepPriceOffset: 0.03, isBuy: false },
      { stepIdx: 1, stepPriceOffset: 0.03, isBuy: false },
    ],
    anchor: 4327,
    digits: 2,
    pip: 0.01,
    rangeLayering: {
      rangeStepPips: 3,
      rangeDistancePips: 30,
      effectiveStepPips: 3,
      stepPriceOffset: 0.03,
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
