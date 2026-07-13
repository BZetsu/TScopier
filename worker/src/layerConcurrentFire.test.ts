import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  adverseDistanceFromAnchor,
  computeLayerFireBudget,
  selectLegsForDistanceBurst,
  stepPriceOffsetForBasket,
} from './layerConcurrentFire'

test('adverseDistanceFromAnchor: buy uses anchor - bid', () => {
  assert.ok(Math.abs(adverseDistanceFromAnchor(true, 4077.35, 4077.25, 4077.27) - 0.1) < 1e-9)
  assert.equal(adverseDistanceFromAnchor(true, 4077.35, 4077.40, 4077.42), 0)
})

test('adverseDistanceFromAnchor: sell uses ask - anchor', () => {
  assert.ok(Math.abs(adverseDistanceFromAnchor(false, 4080, 4079.5, 4080.15) - 0.15) < 1e-9)
  assert.equal(adverseDistanceFromAnchor(false, 4080, 4081, 4079.9), 0)
})

test('stepPriceOffsetForBasket: derives from step 1 row', () => {
  assert.equal(
    stepPriceOffsetForBasket([
      { step_idx: 1, anchor_price: 4077.35, trigger_price: 4077.33, is_buy: true },
      { step_idx: 2, anchor_price: 4077.35, trigger_price: 4077.31, is_buy: true },
    ]),
    0.02,
  )
})

test('computeLayerFireBudget: 2 pip step scales with distance', () => {
  const base = { isBuy: true, anchor: 4077.35, stepPriceOffset: 0.02 }
  assert.equal(computeLayerFireBudget({ ...base, bid: 4077.33, ask: 4077.35 }), 1)
  assert.equal(computeLayerFireBudget({ ...base, bid: 4077.25, ask: 4077.27 }), 5)
  assert.equal(computeLayerFireBudget({ ...base, bid: 4076.85, ask: 4076.87 }), 25)
})

test('computeLayerFireBudget: anyTriggered forces budget 1 near anchor', () => {
  assert.equal(
    computeLayerFireBudget({
      isBuy: true,
      anchor: 4077.35,
      bid: 4077.34,
      ask: 4077.36,
      stepPriceOffset: 0.02,
      anyTriggered: true,
    }),
    1,
  )
})

test('selectLegsForDistanceBurst: fast gap fires all triggered within budget', () => {
  const legs = [1, 2, 3, 4, 5].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4077.35,
    trigger_price: 4077.35 - step_idx * 0.02,
    is_buy: true,
  }))
  const selected = selectLegsForDistanceBurst({ triggeredLegs: legs, budget: 5 })
  assert.equal(selected.length, 5)
  assert.deepEqual(selected.map(l => l.step_idx), [1, 2, 3, 4, 5])
})

test('selectLegsForDistanceBurst: near anchor only shallowest', () => {
  const legs = [1, 2, 3].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4077.35,
    trigger_price: 4077.35 - step_idx * 0.02,
    is_buy: true,
  }))
  const selected = selectLegsForDistanceBurst({ triggeredLegs: legs, budget: 1 })
  assert.deepEqual(selected.map(l => l.step_idx), [1])
})

test('selectLegsForDistanceBurst: sell symmetry', () => {
  const legs = [1, 2, 3].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 + step_idx * 0.02,
    is_buy: false,
  }))
  const selected = selectLegsForDistanceBurst({ triggeredLegs: legs, budget: 2 })
  assert.deepEqual(selected.map(l => l.step_idx), [1, 2])
})
