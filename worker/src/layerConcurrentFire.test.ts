import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  adverseDistanceFromAnchor,
  computeLayerFireBudget,
  isDistanceBurstFillAllowed,
  isLegEligibleByDistance,
  newLayersForTick,
  selectLegsForDistanceBurst,
  selectPendingLegsForDistanceBurst,
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

test('computeLayerFireBudget: 3 pip step — 1 per 3 pips adverse', () => {
  const base = { isBuy: true, anchor: 4080, stepPriceOffset: 0.03 }
  assert.equal(computeLayerFireBudget({ ...base, bid: 4079.97, ask: 4079.99 }), 1)
  assert.equal(computeLayerFireBudget({ ...base, bid: 4079.94, ask: 4079.96 }), 2)
  assert.equal(computeLayerFireBudget({ ...base, bid: 4079.91, ask: 4079.93 }), 3)
  assert.equal(computeLayerFireBudget({ ...base, bid: 4079.82, ask: 4079.84 }), 6)
})

test('computeLayerFireBudget: returns 0 below one step without anyTriggered', () => {
  assert.equal(
    computeLayerFireBudget({
      isBuy: true,
      anchor: 4077.35,
      bid: 4077.34,
      ask: 4077.36,
      stepPriceOffset: 0.02,
    }),
    0,
  )
})

test('isLegEligibleByDistance: step N needs N × step adverse move', () => {
  assert.equal(isLegEligibleByDistance(true, 4080, 4079.94, 4079.96, 1, 0.03), true)
  assert.equal(isLegEligibleByDistance(true, 4080, 4079.94, 4079.96, 2, 0.03), true)
  assert.equal(isLegEligibleByDistance(true, 4080, 4079.97, 4079.99, 2, 0.03), false)
})

test('selectPendingLegsForDistanceBurst: fast -6 pips fires steps 1-2', () => {
  const legs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 - step_idx * 0.03,
    is_buy: true,
  }))
  const selected = selectPendingLegsForDistanceBurst({ pendingLegs: legs, budget: 2 })
  assert.deepEqual(selected.map(l => l.step_idx), [1, 2])
})

test('selectPendingLegsForDistanceBurst: excludes already-fired shallow steps', () => {
  const legs = [1, 2, 3, 4].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 - step_idx * 0.03,
    is_buy: true,
  }))
  const selected = selectPendingLegsForDistanceBurst({
    pendingLegs: legs,
    budget: 6,
    highestFiredStepIdx: 3,
  })
  assert.deepEqual(selected.map(l => l.step_idx), [4])
})

test('newLayersForTick: steps in (fired, budget]', () => {
  assert.deepEqual(newLayersForTick(6, 3), [4, 5, 6])
  assert.deepEqual(newLayersForTick(2, 2), [])
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
})

test('isDistanceBurstFillAllowed: gap fill below rung is allowed', () => {
  const out = isDistanceBurstFillAllowed({
    isBuy: true,
    anchor: 4080,
    bid: 4079.82,
    ask: 4079.84,
    stepIdx: 4,
    stepPriceOffset: 0.03,
    triggerPrice: 4079.88,
    slippagePoints: 20,
    point: 0.01,
  })
  assert.equal(out.ok, true)
})

test('isDistanceBurstFillAllowed: bounce above rung slippage is rejected', () => {
  const out = isDistanceBurstFillAllowed({
    isBuy: true,
    anchor: 4080,
    bid: 4079.95,
    ask: 4080.50,
    stepIdx: 1,
    stepPriceOffset: 0.03,
    triggerPrice: 4079.97,
    slippagePoints: 20,
    point: 0.01,
  })
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'fill_outside_trigger_band')
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
