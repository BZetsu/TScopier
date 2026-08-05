import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTpTouch, shouldLockBasketLayering } from './rangeBasketLayeringLock'

test('evaluateTpTouch: buy basket locks at nearest TP touch', () => {
  const out = evaluateTpTouch({
    direction: 'buy',
    tps: [2500, 2510, 2520],
    bid: 2500,
    ask: 2500.2,
  })
  assert.equal(out.touched, true)
  assert.equal(out.triggerPrice, 2500)
  assert.equal(out.triggerSide, 'bid')
})

test('evaluateTpTouch: sell basket locks at nearest TP touch', () => {
  const out = evaluateTpTouch({
    direction: 'sell',
    tps: [2500, 2490, 2480],
    bid: 2499.8,
    ask: 2500,
  })
  assert.equal(out.touched, true)
  assert.equal(out.triggerPrice, 2500)
  assert.equal(out.triggerSide, 'ask')
})

test('evaluateTpTouch: ignores invalid TP direction/noise', () => {
  const out = evaluateTpTouch({
    direction: 'hold',
    tps: [2500, 0, NaN],
    bid: 2600,
    ask: 2600.2,
  })
  assert.equal(out.touched, false)
  assert.equal(out.triggerPrice, null)
})

test('shouldLockBasketLayering: live TP touch locks (sell)', () => {
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [2500, 2490],
    openCount: 2,
    closedCount: 0,
    bid: 2499.8,
    ask: 2500,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'tp_touched')
})

test('shouldLockBasketLayering: partially closed basket locks even when quote is far from remaining TPs', () => {
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [2400],
    openCount: 1,
    closedCount: 2,
    bid: 2500,
    ask: 2500.2,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'basket_partially_closed')
})

test('shouldLockBasketLayering: fully open basket with no touch stays unlocked', () => {
  const out = shouldLockBasketLayering({
    direction: 'buy',
    openTps: [2600],
    openCount: 1,
    closedCount: 0,
    bid: 2500,
    ask: 2500.2,
  })
  assert.equal(out.lock, false)
  assert.equal(out.reason, null)
})

test('shouldLockBasketLayering: flat basket with closed legs locks to stop refire', () => {
  const out = shouldLockBasketLayering({
    direction: 'buy',
    openTps: [],
    openCount: 0,
    closedCount: 3,
    bid: 2500,
    ask: 2500.2,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'basket_fully_closed')
})

test('shouldLockBasketLayering: empty basket with no history stays unlocked', () => {
  const out = shouldLockBasketLayering({
    direction: 'buy',
    openTps: [],
    openCount: 0,
    closedCount: 0,
    bid: 2500,
    ask: 2500.2,
  })
  assert.equal(out.lock, false)
  assert.equal(out.reason, null)
})
