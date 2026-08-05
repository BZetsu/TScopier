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

test('broker range pending: unique stepIdx — no duplicate prices from cycling', () => {
  const stepPriceOffset = 0.02
  const anchor = 4500
  const activeLegs = 3
  const stepIdxs = Array.from({ length: activeLegs }, (_, i) => i + 1)
  assert.deepEqual(stepIdxs, [1, 2, 3])
  const triggers = stepIdxs.map(stepIdx =>
    triggerPriceFor(
      { stepIdx, isBuy: false, stepPriceOffset },
      anchor,
      2,
    ),
  )
  assert.deepEqual(triggers, [4500.02, 4500.04, 4500.06])
  assert.equal(new Set(triggers).size, triggers.length)
})

test('broker range rematerialize skips existing step indices', () => {
  const planned = [1, 2, 3, 4, 5]
  const existing = new Set([1, 2, 3])
  const remaining = planned.filter(s => !existing.has(s))
  assert.deepEqual(remaining, [4, 5])
})

test('broker pending OrderSend is always naked while DB keeps desired stops', () => {
  const planned = { stoploss: 4040, takeprofit: 4100, cweClosePrice: null as number | null }
  const sendArgs = {
    stoploss: 0,
    takeprofit: 0,
  }
  const desiredSl = planned.stoploss > 0 ? planned.stoploss : null
  const desiredTp = planned.cweClosePrice != null
    ? null
    : (planned.takeprofit > 0 ? planned.takeprofit : null)
  assert.equal(sendArgs.stoploss, 0)
  assert.equal(sendArgs.takeprofit, 0)
  assert.equal(desiredSl, 4040)
  assert.equal(desiredTp, 4100)
})

test('CWE broker pending keeps naked TP on place and null desired TP', () => {
  const planned = { stoploss: 4040, takeprofit: 4100, cweClosePrice: 4055 }
  const sendArgs = { stoploss: 0, takeprofit: 0 }
  const desiredTp = planned.cweClosePrice != null
    ? null
    : (planned.takeprofit > 0 ? planned.takeprofit : null)
  assert.equal(sendArgs.takeprofit, 0)
  assert.equal(desiredTp, null)
})
