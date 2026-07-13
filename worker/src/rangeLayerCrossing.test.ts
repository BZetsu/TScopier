import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isAdverselyCrossed, triggerPriceFor } from './tradeExecutor/helpers'
import type { VirtualPendingLeg } from './manualPlanner'

test('isAdverselyCrossed: sell fires on upward cross through trigger', () => {
  assert.equal(isAdverselyCrossed(false, 4090, 4089.8, 4089.9, 4090, 4090.1), true)
  assert.equal(isAdverselyCrossed(false, 4090, 4089.5, 4089.6, 4090, 4090.1), true)
})

test('isAdverselyCrossed: sell does NOT fire on retrace through already-passed rung', () => {
  assert.equal(isAdverselyCrossed(false, 4089.5, 4090, 4090.1, 4089.5, 4089.6), false)
  assert.equal(isAdverselyCrossed(false, 4090.2, 4091, 4091.1, 4090.5, 4090.6), false)
})

test('isAdverselyCrossed: buy fires on downward cross through trigger', () => {
  assert.equal(isAdverselyCrossed(true, 4080, 4081, 4081.1, 4080, 4080.1), true)
  assert.equal(isAdverselyCrossed(true, 4080, 4080.5, 4080.6, 4079.5, 4079.6), true)
})

test('isAdverselyCrossed: buy does NOT fire on bounce up through already-passed rung', () => {
  assert.equal(isAdverselyCrossed(true, 4082, 4080, 4080.1, 4082, 4082.1), false)
  assert.equal(isAdverselyCrossed(true, 4078, 4075, 4075.1, 4078, 4078.1), false)
})

test('isAdverselyCrossed: rejects invalid prices', () => {
  assert.equal(isAdverselyCrossed(false, 0, 4090, 4090.1, 4090, 4090.1), false)
  assert.equal(isAdverselyCrossed(false, 4090, Number.NaN, 4090.1, 4090, 4090.1), false)
})

test('triggerPriceFor: sell ladder rungs above fill anchor not parsed entry', () => {
  const leg: VirtualPendingLeg = {
    stepIdx: 1,
    stepPriceOffset: 0.2,
    isBuy: false,
    volume: 0.01,
    stoploss: null,
    takeprofit: null,
    slippage: 20,
    comment: 'test',
    expertID: null,
    expiryHours: null,
    cweClosePrice: null,
  }
  const fillAnchor = 4089
  const parsedAnchor = 4088
  assert.equal(triggerPriceFor(leg, fillAnchor, 2), 4089.2)
  assert.equal(triggerPriceFor(leg, parsedAnchor, 2), 4088.2)
  assert.ok(triggerPriceFor(leg, fillAnchor, 2) > fillAnchor)
})
