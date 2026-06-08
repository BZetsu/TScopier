import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  consumedStepIndices,
  maxConsumedStepIndex,
  pendingLegStopsForBasketRefresh,
} from './rangePendingLadderSync'

describe('consumedStepIndices', () => {
  it('includes fired and expired, not pending', () => {
    const s = consumedStepIndices([
      { id: '1', step_idx: 1, status: 'fired', stoploss: null, takeprofit: null },
      { id: '2', step_idx: 2, status: 'pending', stoploss: null, takeprofit: null },
      { id: '3', step_idx: 3, status: 'expired', stoploss: null, takeprofit: null },
    ])
    assert.deepEqual([...s].sort(), [1, 3])
  })
})

describe('maxConsumedStepIndex', () => {
  it('returns highest consumed step', () => {
    assert.equal(maxConsumedStepIndex(new Set([1, 4, 2])), 4)
    assert.equal(maxConsumedStepIndex(new Set()), 0)
  })
})

describe('pendingLegStopsForBasketRefresh', () => {
  it('applies channel SL to pending row without matching plan leg', () => {
    const result = pendingLegStopsForBasketRefresh({
      row: {
        id: 'leg-1',
        step_idx: 25,
        status: 'pending',
        stoploss: 4306,
        takeprofit: 4288,
      },
      planLeg: undefined,
      channelParams: { symbol: 'XAUUSD', stoploss: 4308, tpLevels: [] },
      plannedRangeLegs: 11,
      activeRowCount: 11,
    })
    assert.equal(result?.stoploss, 4308)
    assert.equal(result?.takeprofit, 4288)
  })

  it('returns null when no plan leg and no channel stops', () => {
    const result = pendingLegStopsForBasketRefresh({
      row: {
        id: 'leg-1',
        step_idx: 25,
        status: 'pending',
        stoploss: 4306,
        takeprofit: 4288,
      },
      planLeg: undefined,
      channelParams: null,
      plannedRangeLegs: 11,
      activeRowCount: 11,
    })
    assert.equal(result, null)
  })

  it('prefers plan leg stops with channel overlay', () => {
    const result = pendingLegStopsForBasketRefresh({
      row: {
        id: 'leg-1',
        step_idx: 3,
        status: 'pending',
        stoploss: 4306,
        takeprofit: 4288,
      },
      planLeg: {
        stepIdx: 3,
        isBuy: false,
        volume: 0.01,
        stoploss: 4306,
        takeprofit: 4285,
        slippage: 20,
        comment: 'test',
        stepPriceOffset: 0,
      },
      channelParams: { symbol: 'XAUUSD', stoploss: 4308, tpLevels: [] },
      plannedRangeLegs: 11,
      activeRowCount: 11,
    })
    assert.equal(result?.stoploss, 4308)
    assert.equal(result?.takeprofit, 4285)
  })
})
