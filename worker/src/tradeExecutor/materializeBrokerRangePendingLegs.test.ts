import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { triggerPriceFor } from './helpers'
import type { VirtualPendingLeg } from '../manualPlanner'

test('broker range pending: sell ladder from fill anchor 4500 step 2 pips', () => {
  const stepPriceOffset = 0.02 // 2 pips on XAUUSD-style 2-digit
  const anchor = 4500
  const legs: VirtualPendingLeg[] = [
    { stepIdx: 1, isBuy: false, volume: 0.01, stepPriceOffset, stoploss: 0, takeprofit: 0, slippage: 20, comment: 'a' },
    { stepIdx: 2, isBuy: false, volume: 0.01, stepPriceOffset, stoploss: 0, takeprofit: 0, slippage: 20, comment: 'b' },
    { stepIdx: 3, isBuy: false, volume: 0.01, stepPriceOffset, stoploss: 0, takeprofit: 0, slippage: 20, comment: 'c' },
  ]
  const prices = legs.map(l => triggerPriceFor(l, anchor, 2))
  assert.deepEqual(prices, [4500.02, 4500.04, 4500.06])
})

test('broker range pending: round-robin reuses stepIdx for same trigger price', () => {
  const stepPriceOffset = 0.02
  const anchor = 4500
  const maxStepIdx = 3
  const reservedLegs = 7
  const stepIdxs: number[] = []
  for (let i = 0; i < reservedLegs; i++) {
    stepIdxs.push((i % maxStepIdx) + 1)
  }
  assert.deepEqual(stepIdxs, [1, 2, 3, 1, 2, 3, 1])
  const triggers = stepIdxs.map(stepIdx =>
    triggerPriceFor(
      { stepIdx, isBuy: false, volume: 0.01, stepPriceOffset, stoploss: 0, takeprofit: 0, slippage: 20, comment: '' },
      anchor,
      2,
    ),
  )
  assert.equal(triggers.filter(p => p === 4500.02).length, 3)
  assert.equal(triggers.filter(p => p === 4500.04).length, 2)
  assert.equal(triggers.filter(p => p === 4500.06).length, 2)
})
