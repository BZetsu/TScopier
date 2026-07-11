import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { triggerPriceFor } from './helpers'
import {
  brokerRangeStepIdxForLeg,
  resolveBrokerRangeLadderPricing,
  snapPriceToSymbolGrid,
} from './brokerRangeLadderPricing'

test('resolveBrokerRangeLadderPricing: BTCUSDm uses configured step not broker stop expansion', () => {
  const ladder = resolveBrokerRangeLadderPricing({
    symbol: 'BTCUSDm',
    rangeLayering: {
      rangeStepPips: 3,
      rangeDistancePips: 30,
      effectiveStepPips: 22,
      stepPriceOffset: 2.2,
      maxStepIdx: 1,
      reservedPendingLegs: 10,
      activePendingLegs: 10,
      rangeLayeringType: 'pending_order',
    },
    params: {
      point: 0.01,
      digits: 2,
      minLot: 0.01,
      lotStep: 0.01,
      maxLot: 100,
      contractSize: 1,
      stopsLevel: 216,
      freezeLevel: 0,
      loadedAt: 0,
    },
  })
  assert.ok(ladder)
  assert.equal(ladder.stepPips, 3)
  assert.equal(ladder.distPips, 30)
  assert.equal(ladder.maxStepIdx, 10)
  assert.ok(Math.abs(ladder.pip - 0.1) < 1e-9)
  assert.ok(Math.abs(ladder.stepPriceOffset - 0.3) < 1e-9)
})

test('broker range ladder: BTC sell fill spreads limits across rungs', () => {
  const ladder = resolveBrokerRangeLadderPricing({
    symbol: 'BTCUSDm',
    rangeLayering: {
      rangeStepPips: 3,
      rangeDistancePips: 30,
      effectiveStepPips: 22,
      stepPriceOffset: 2.2,
      maxStepIdx: 1,
      reservedPendingLegs: 11,
      activePendingLegs: 11,
      rangeLayeringType: 'pending_order',
    },
    params: {
      point: 0.01,
      digits: 2,
      minLot: 0.01,
      lotStep: 0.01,
      maxLot: 100,
      contractSize: 1,
      stopsLevel: 216,
      freezeLevel: 0,
      loadedAt: 0,
    },
  })!
  const anchor = 64055.21
  const reservedLegs = 11
  const prices: number[] = []
  for (let i = 0; i < reservedLegs; i++) {
    const stepIdx = brokerRangeStepIdxForLeg(i, ladder.maxStepIdx)
    const trigger = triggerPriceFor(
      {
        stepIdx,
        stepPriceOffset: ladder.stepPriceOffset,
        isBuy: false,
        volume: 0.08,
        stoploss: 0,
        takeprofit: 0,
        slippage: 20,
        comment: '',
      },
      anchor,
      ladder.digits,
    )
    prices.push(snapPriceToSymbolGrid(trigger, ladder.point, ladder.digits))
  }
  const distinct = new Set(prices)
  assert.ok(distinct.size >= 3, `expected spread prices, got ${[...distinct].join(', ')}`)
  assert.ok(!distinct.has(64057.39), 'should not collapse to broker min-stop only rung')
  assert.equal(prices[0], 64055.51)
  assert.equal(prices[1], 64055.81)
  assert.equal(prices[2], 64056.11)
})
