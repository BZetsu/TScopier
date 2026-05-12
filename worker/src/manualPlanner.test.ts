import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  applyCloseWorseEntries,
  planRangeSplit,
  type PlannerRangeMeta,
  type PlannerCloseWorseEntries,
} from './manualPlanner'
import type { OrderSendArgs } from './metatraderapi'

const baseSplit = {
  totalLegs: 20,
  baseIsPendingSignal: false,
  rangeOn: true,
  rangePct: 50,
  stepPips: 10,
  distPips: 100,
  pip: 0.1,
  minStepPriceUnits: 0,
  hasSignalAnchor: true,
}

test('planRangeSplit: range off → all immediates', () => {
  const r = planRangeSplit({ ...baseSplit, rangeOn: false })
  assert.equal(r.immediateLegs, 20)
  assert.equal(r.pendingLegs, 0)
})

test('planRangeSplit: pending signal disables range', () => {
  const r = planRangeSplit({ ...baseSplit, baseIsPendingSignal: true })
  assert.equal(r.pendingLegs, 0)
  assert.equal(r.immediateLegs, 20)
  assert.equal(r.fallbackReason, 'range_trading_skip_pending_signal')
})

test('planRangeSplit: invalid step/distance → fallback', () => {
  const r = planRangeSplit({ ...baseSplit, stepPips: 0 })
  assert.equal(r.fallbackReason, 'range_trading_invalid')
  assert.equal(r.pendingLegs, 0)
})

test('planRangeSplit: 50% × 20 legs → 10 pendings @ 10 pip step', () => {
  const r = planRangeSplit(baseSplit)
  assert.equal(r.immediateLegs, 10)
  assert.equal(r.pendingLegs, 10)
  assert.equal(r.effectiveStepPips, 10)
  assert.ok(Math.abs(r.stepPriceOffset - 1.0) < 1e-9) // 10 × 0.1
  assert.equal(r.fallbackReason, undefined)
})

test('planRangeSplit: distance caps pending count', () => {
  const r = planRangeSplit({ ...baseSplit, distPips: 30 }) // 30 / 10 = 3
  assert.equal(r.pendingLegs, 3)
  assert.equal(r.immediateLegs, 10)
})

test('planRangeSplit: auto-expands step when below broker minimum', () => {
  // pip = 0.1, configured step = 2 pips = 0.2 price units, but broker requires 1.02.
  // ceil(1.02 / 0.1) = 11 pips.
  const r = planRangeSplit({ ...baseSplit, stepPips: 2, minStepPriceUnits: 1.02 })
  assert.equal(r.effectiveStepPips, 11)
  assert.equal(r.fallbackReason, 'range_trading_step_auto_expanded')
})

test('planRangeSplit: no signal anchor + no immediates → runtime-only fallback', () => {
  // 100% range = 0 immediates; without a signal anchor the executor must resolve via /Quote.
  const r = planRangeSplit({ ...baseSplit, rangePct: 100, hasSignalAnchor: false })
  assert.equal(r.immediateLegs, 0)
  assert.equal(r.pendingLegs, 10)
  assert.equal(r.fallbackReason, 'range_trading_anchor_runtime_only')
})

function mkOrder(price: number | null, comment: string): OrderSendArgs {
  return {
    symbol: 'XAUUSD',
    operation: price == null ? 'BuyLimit' : 'Buy',
    volume: 0.01,
    price,
    stoploss: 1840,
    takeprofit: 1900,
    comment,
  }
}

test('applyCloseWorseEntries: single trigger TP shared across CWE legs', () => {
  const orders: OrderSendArgs[] = [
    mkOrder(0, 'imm1'), mkOrder(0, 'imm2'),       // immediates
    mkOrder(null, 'pend1'), mkOrder(null, 'pend2'), mkOrder(null, 'pend3'), // pendings
  ]
  const policy: PlannerCloseWorseEntries = { immediates: 2, extraPendings: 1, pipsFromAnchor: 30 }
  const out = applyCloseWorseEntries({
    orders,
    policy,
    anchor: 1850,
    isBuy: true,
    pip: 0.1,
    digits: 2,
    minStopDistance: 1.02,
  })
  // Expected override: 1850 + 30 × 0.1 = 1853 (outside the 1.02 floor).
  assert.equal(out[0]!.takeprofit, 1853)
  assert.equal(out[1]!.takeprofit, 1853)
  assert.equal(out[2]!.takeprofit, 1853) // shallowest pending also overridden
  assert.equal(out[3]!.takeprofit, 1900) // deeper pending keeps original TP
  assert.equal(out[4]!.takeprofit, 1900)
  assert.ok(out[0]!.comment!.endsWith('.cw'))
  assert.ok(!out[3]!.comment!.endsWith('.cw'))
})

test('applyCloseWorseEntries: respects stops/freeze floor', () => {
  // 30 pip override on EURUSD 5-digit: pip = 0.0001 → 30 × 0.0001 = 0.003.
  // If broker minStopDistance is 0.005, the override should snap out to 0.005.
  const orders: OrderSendArgs[] = [mkOrder(0, 'imm1')]
  const policy: PlannerCloseWorseEntries = { immediates: 1, extraPendings: 0, pipsFromAnchor: 30 }
  const out = applyCloseWorseEntries({
    orders,
    policy,
    anchor: 1.10000,
    isBuy: true,
    pip: 0.0001,
    digits: 5,
    minStopDistance: 0.005,
  })
  assert.equal(out[0]!.takeprofit, 1.105) // 1.10 + max(0.003, 0.005) = 1.105
})

test('applyCloseWorseEntries: sell direction inverts override', () => {
  const orders: OrderSendArgs[] = [mkOrder(0, 'imm1')]
  const policy: PlannerCloseWorseEntries = { immediates: 1, extraPendings: 0, pipsFromAnchor: 30 }
  const out = applyCloseWorseEntries({
    orders,
    policy,
    anchor: 1850,
    isBuy: false,
    pip: 0.1,
    digits: 2,
    minStopDistance: 0,
  })
  assert.equal(out[0]!.takeprofit, 1847) // 1850 - 30 × 0.1
})

test('applyCloseWorseEntries: zero anchor returns input unchanged', () => {
  const orders: OrderSendArgs[] = [mkOrder(0, 'imm1')]
  const policy: PlannerCloseWorseEntries = { immediates: 1, extraPendings: 0, pipsFromAnchor: 30 }
  const out = applyCloseWorseEntries({
    orders, policy, anchor: 0, isBuy: true, pip: 0.1, digits: 2, minStopDistance: 0,
  })
  assert.equal(out[0]!.takeprofit, 1900) // unchanged
})

// Silence "unused" lint on the imported PlannerRangeMeta type — the assertion
// keeps the import live without actually using it at runtime.
const _meta: PlannerRangeMeta | undefined = undefined
void _meta
