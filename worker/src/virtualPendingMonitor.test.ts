import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  evaluateTpTouch,
  fillWithinTriggerBand,
  isTriggered,
  shouldLockBasketLayering,
  VirtualPendingMonitor,
} from './virtualPendingMonitor'
import { isAdverselyCrossed, isOutwardCatchUp } from './tradeExecutor/helpers'
import { isBlockedByShallowerStep } from './virtualPendingMonitor'
import {
  computeLayerFireBudget,
  isLegEligibleByDistance,
  newLayersForTick,
  selectPendingLegsForDistanceBurst,
} from './layerConcurrentFire'

// Buy ladder = averaging DOWN: trigger fires when bid drops to / below trigger_price.
test('isTriggered: buy fires when bid <= trigger', () => {
  assert.equal(isTriggered(true, 1840, 1839.5, 1839.6), true)
  assert.equal(isTriggered(true, 1840, 1840, 1840.1), true)   // exactly at trigger
})

test('isTriggered: buy does NOT fire when bid > trigger', () => {
  assert.equal(isTriggered(true, 1840, 1850, 1850.1), false)
})

// Sell ladder = averaging UP: trigger fires when ask rises to / above trigger_price.
test('isTriggered: sell fires when ask >= trigger', () => {
  assert.equal(isTriggered(false, 1860, 1859.9, 1860), true)  // exactly at trigger
  assert.equal(isTriggered(false, 1860, 1860, 1861), true)
})

test('isTriggered: sell does NOT fire when ask < trigger', () => {
  assert.equal(isTriggered(false, 1860, 1849, 1849.5), false)
})

test('isTriggered: rejects invalid inputs', () => {
  assert.equal(isTriggered(true, 0, 1840, 1841), false)
  assert.equal(isTriggered(true, NaN, 1840, 1841), false)
  assert.equal(isTriggered(true, 1840, NaN, 1841), false)
  assert.equal(isTriggered(false, 1840, 1841, NaN), false)
})

// Pip math sanity: a buy ladder anchored at 1850 with stepPriceOffset=1.0 and
// stepIdx=3 has trigger = 1847. Bid at 1847.0 ⇒ fire.
test('isTriggered: realistic XAUUSD buy ladder fires correctly', () => {
  const anchor = 1850
  const stepPriceOffset = 1.0 // 10 smart pips on XAUUSD @ 2-digit
  const trigger = anchor - 3 * stepPriceOffset
  assert.equal(trigger, 1847)
  assert.equal(isTriggered(true, trigger, 1846.95, 1847.05), true)
  assert.equal(isTriggered(true, trigger, 1847.05, 1847.15), false)
})

// XAUUSD: point=0.01, slippage 20 points ⇒ tolerance $0.20 around the rung.
test('fillWithinTriggerBand: buy fill at/near the rung is allowed', () => {
  assert.deepEqual(
    fillWithinTriggerBand({ isBuy: true, triggerPrice: 4109.63, bid: 4109.50, ask: 4109.70, slippagePoints: 20, point: 0.01 }),
    { ok: true },
  )
})

test('fillWithinTriggerBand: buy fill BELOW the rung (better entry) is allowed', () => {
  assert.deepEqual(
    fillWithinTriggerBand({ isBuy: true, triggerPrice: 4109.63, bid: 4105.10, ask: 4105.30, slippagePoints: 20, point: 0.01 }),
    { ok: true },
  )
})

// Regression for the "layer fired at the top of a rally" bug: trigger crossed
// on a dip, but by send time ask rallied $2 above the rung — must NOT fire.
test('fillWithinTriggerBand: buy fill far above the rung is rejected', () => {
  const out = fillWithinTriggerBand({ isBuy: true, triggerPrice: 4109.63, bid: 4111.60, ask: 4111.81, slippagePoints: 20, point: 0.01 })
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'no_longer_triggered')
})

test('fillWithinTriggerBand: buy still triggered on bid but ask outside slippage band is rejected', () => {
  const out = fillWithinTriggerBand({ isBuy: true, triggerPrice: 4109.63, bid: 4109.60, ask: 4110.40, slippagePoints: 20, point: 0.01 })
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'fill_outside_trigger_band')
})

test('fillWithinTriggerBand: sell fill below the rung beyond slippage is rejected', () => {
  const out = fillWithinTriggerBand({ isBuy: false, triggerPrice: 4120, bid: 4118.90, ask: 4120.05, slippagePoints: 20, point: 0.01 })
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'fill_outside_trigger_band')
})

test('fillWithinTriggerBand: sell fill at/above the rung is allowed', () => {
  assert.deepEqual(
    fillWithinTriggerBand({ isBuy: false, triggerPrice: 4120, bid: 4120.10, ask: 4120.30, slippagePoints: 20, point: 0.01 }),
    { ok: true },
  )
})

test('fillWithinTriggerBand: without symbol point only re-checks the trigger', () => {
  assert.deepEqual(
    fillWithinTriggerBand({ isBuy: true, triggerPrice: 4109.63, bid: 4109.60, ask: 4112.00, slippagePoints: 20, point: null }),
    { ok: true },
  )
  assert.equal(
    fillWithinTriggerBand({ isBuy: true, triggerPrice: 4109.63, bid: 4111.00, ask: 4111.20, slippagePoints: 20, point: null }).ok,
    false,
  )
})

test('evaluateTpTouch: buy basket locks at nearest TP touch', () => {
  const out = evaluateTpTouch({
    direction: 'buy',
    tps: [4510, 4530, 4550],
    bid: 4510,
    ask: 4510.2,
  })
  assert.equal(out.touched, true)
  assert.equal(out.triggerPrice, 4510)
  assert.equal(out.triggerSide, 'bid')
})

test('evaluateTpTouch: sell basket locks at nearest TP touch', () => {
  const out = evaluateTpTouch({
    direction: 'sell',
    tps: [4500, 4480, 4460],
    bid: 4500.2,
    ask: 4500,
  })
  assert.equal(out.touched, true)
  assert.equal(out.triggerPrice, 4500)
  assert.equal(out.triggerSide, 'ask')
})

test('evaluateTpTouch: ignores invalid TP direction/noise', () => {
  const out = evaluateTpTouch({
    direction: 'unknown',
    tps: [4500, 0, Number.NaN],
    bid: 4600,
    ask: 4600.5,
  })
  assert.equal(out.touched, false)
  assert.equal(out.triggerPrice, null)
  assert.equal(out.triggerSide, null)
})

test('shouldLockBasketLayering: live TP touch locks (sell)', () => {
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [4089.8, 4087.1, 4074.5],
    openCount: 3,
    closedCount: 0,
    bid: 4090,
    ask: 4089.7,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'tp_touched')
  assert.equal(out.triggerPrice, 4089.8)
})

test('shouldLockBasketLayering: partially closed basket locks even when quote is far from remaining TPs', () => {
  // TP1 trades closed at the broker; only deep-TP trades remain open and the
  // quote has reversed away — the open-only touch check can never fire.
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [4074.5],
    openCount: 5,
    closedCount: 16,
    bid: 4094.5,
    ask: 4094.8,
  })
  assert.equal(out.lock, true)
  assert.equal(out.reason, 'basket_partially_closed')
  assert.equal(out.triggerPrice, null)
})

test('shouldLockBasketLayering: fully open basket with no touch stays unlocked', () => {
  const out = shouldLockBasketLayering({
    direction: 'buy',
    openTps: [4120, 4140],
    openCount: 4,
    closedCount: 0,
    bid: 4095,
    ask: 4095.3,
  })
  assert.equal(out.lock, false)
  assert.equal(out.reason, null)
})

test('shouldLockBasketLayering: flat basket (no open trades) does not lock', () => {
  const out = shouldLockBasketLayering({
    direction: 'sell',
    openTps: [],
    openCount: 0,
    closedCount: 12,
    bid: 4094.5,
    ask: 4094.8,
  })
  assert.equal(out.lock, false)
})

test('VirtualPendingMonitor: auto path excludes broker_pending status', () => {
  assert.deepEqual(VirtualPendingMonitor.AUTO_LAYER_STATUSES, ['pending'])
  assert.ok(!VirtualPendingMonitor.AUTO_LAYER_STATUSES.includes('broker_pending' as never))
})

test('SELL retrace scenario: shallow rungs do not cross on pullback', () => {
  assert.equal(isAdverselyCrossed(false, 4089.5, 4090, 4090.1, 4089.5, 4089.6), false)
  assert.equal(isAdverselyCrossed(false, 4090.2, 4091, 4091.1, 4090.5, 4090.6), false)
  assert.equal(isAdverselyCrossed(false, 4090, 4089.8, 4089.9, 4090, 4090.1), true)
})

test('SELL catch-up: deeper rung eligible while holding after gap, not on retrace', () => {
  assert.equal(isOutwardCatchUp(false, 4089.6, 4092, 4092.1, 4092, 4092.1), true)
  assert.equal(isOutwardCatchUp(false, 4089.6, 4092, 4092.1, 4089.5, 4089.6), false)
})

test('isBlockedByShallowerStep: blocks deeper rung when shallower still pending', () => {
  const active = new Map<string, Set<number>>([['sig|broker', new Set([1])]])
  assert.equal(
    isBlockedByShallowerStep({ signal_id: 'sig', broker_account_id: 'broker', step_idx: 2 }, active),
    true,
  )
  assert.equal(
    isBlockedByShallowerStep({ signal_id: 'sig', broker_account_id: 'broker', step_idx: 1 }, active),
    false,
  )
})

test('distance burst: 3-pip step at -6 pips selects steps 1-2 from all pending', () => {
  const pending = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 - step_idx * 0.03,
    is_buy: true,
  }))
  const budget = computeLayerFireBudget({
    isBuy: true,
    anchor: 4080,
    bid: 4079.94,
    ask: 4079.96,
    stepPriceOffset: 0.03,
  })
  assert.equal(budget, 2)
  const selected = selectPendingLegsForDistanceBurst({ pendingLegs: pending, budget })
  assert.deepEqual(selected.map(l => l.step_idx), [1, 2])
})

test('distance burst: -9 pips total selects step 3 only when steps 1-2 already fired', () => {
  const pending = [3, 4, 5, 6].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 - step_idx * 0.03,
    is_buy: true,
  }))
  const budget = computeLayerFireBudget({
    isBuy: true,
    anchor: 4080,
    bid: 4079.91,
    ask: 4079.93,
    stepPriceOffset: 0.03,
  })
  assert.equal(budget, 3)
  const selected = selectPendingLegsForDistanceBurst({ pendingLegs: pending, budget })
  assert.deepEqual(selected.map(l => l.step_idx), [3])
})

test('distance burst: -18 pips selects steps 4-6 when 1-3 already fired', () => {
  const pending = [4, 5, 6, 7].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 - step_idx * 0.03,
    is_buy: true,
  }))
  const budget = computeLayerFireBudget({
    isBuy: true,
    anchor: 4080,
    bid: 4079.82,
    ask: 4079.84,
    stepPriceOffset: 0.03,
  })
  assert.equal(budget, 6)
  assert.deepEqual(newLayersForTick(budget, 3), [4, 5, 6])
  const selected = selectPendingLegsForDistanceBurst({ pendingLegs: pending, budget })
  assert.deepEqual(selected.map(l => l.step_idx), [4, 5, 6])
})

test('distance burst: eligibility does not require trigger cross (prevQuote null)', () => {
  assert.equal(isLegEligibleByDistance(true, 4080, 4079.94, 4079.96, 2, 0.03), true)
  assert.equal(isLegEligibleByDistance(true, 4080, 4079.97, 4079.99, 2, 0.03), false)
})

test('distance burst: sell side selects multiple rungs when price gaps up', () => {
  const pending = [1, 2, 3].map(step_idx => ({
    id: `leg-${step_idx}`,
    step_idx,
    anchor_price: 4080,
    trigger_price: 4080 + step_idx * 0.02,
    is_buy: false,
  }))
  const budget = computeLayerFireBudget({
    isBuy: false,
    anchor: 4080,
    bid: 4080.04,
    ask: 4080.06,
    stepPriceOffset: 0.02,
  })
  assert.equal(budget, 3)
  const selected = selectPendingLegsForDistanceBurst({ pendingLegs: pending, budget })
  assert.deepEqual(selected.map(l => l.step_idx), [1, 2, 3])
})
