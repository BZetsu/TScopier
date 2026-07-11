import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { triggerPriceFor } from './helpers'
import type { VirtualPendingLeg } from '../manualPlanner'

test('materializeBrokerRangePendingLegs: BuyLimit trigger below anchor for buy ladder', () => {
  const leg: VirtualPendingLeg = {
    stepIdx: 2,
    isBuy: true,
    volume: 0.01,
    stepPriceOffset: 0.1,
    stoploss: 0,
    takeprofit: 0,
    slippage: 20,
    comment: 'test',
  }
  const trigger = triggerPriceFor(leg, 1850, 2)
  assert.equal(trigger, 1849.8)
  assert.ok(trigger < 1850)
})

test('materializeBrokerRangePendingLegs: SellLimit trigger above anchor for sell ladder', () => {
  const leg: VirtualPendingLeg = {
    stepIdx: 1,
    isBuy: false,
    volume: 0.01,
    stepPriceOffset: 0.5,
    stoploss: 0,
    takeprofit: 0,
    slippage: 20,
    comment: 'test',
  }
  const trigger = triggerPriceFor(leg, 2000, 2)
  assert.equal(trigger, 2000.5)
  assert.ok(trigger > 2000)
})
