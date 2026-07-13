import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeReanchorTriggers,
  deriveStepPriceOffset,
  isGapFill,
} from './gapFillReanchor'

test('deriveStepPriceOffset: buy step 1', () => {
  assert.equal(
    deriveStepPriceOffset({
      stepIdx: 1,
      triggerPrice: 4074.37,
      anchorPrice: 4074.39,
      isBuy: true,
    }),
    0.02,
  )
})

test('isGapFill: buy fill far below trigger', () => {
  assert.equal(
    isGapFill({ isBuy: true, triggerPrice: 4074.37, fillPrice: 4069.83, tolerance: 0.2 }),
    true,
  )
  assert.equal(
    isGapFill({ isBuy: true, triggerPrice: 4074.37, fillPrice: 4074.30, tolerance: 0.2 }),
    false,
  )
})

test('computeReanchorTriggers: buy gap re-ladders below fill', () => {
  const map = computeReanchorTriggers({
    isBuy: true,
    fillPrice: 4069.83,
    stepPriceOffset: 0.02,
    firedStepIdx: 1,
    pendingStepIndices: [2, 3, 4],
    digits: 2,
  })
  assert.equal(map.get(2), 4069.81)
  assert.equal(map.get(3), 4069.79)
  assert.equal(map.get(4), 4069.77)
})
