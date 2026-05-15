import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  autoManagementTradeSnapshot,
  computeBreakevenStopLoss,
  isAutoBeTriggerMet,
  isAutoManagementEnabled,
  isSlAtOrBeyondBreakeven,
} from './autoManagement'

test('isAutoManagementEnabled: off when mode is none', () => {
  assert.equal(isAutoManagementEnabled({ move_sl_to_entry_after_mode: 'none' }), false)
})

test('isAutoManagementEnabled: on for pips', () => {
  assert.equal(isAutoManagementEnabled({ move_sl_to_entry_after_mode: 'pips' }), true)
})

test('autoManagementTradeSnapshot: empty when disabled', () => {
  assert.deepEqual(autoManagementTradeSnapshot({ move_sl_to_entry_after_mode: 'none' }, 2000, 1990), {})
})

test('autoManagementTradeSnapshot: snapshots config', () => {
  const row = autoManagementTradeSnapshot(
    {
      move_sl_to_entry_after_mode: 'pips',
      move_sl_to_entry_after_value: 15,
      move_sl_to_entry_type: 'sl_and_close_half',
      breakeven_offset_pips: 5,
    },
    2000,
    1990,
  )
  assert.equal(row.auto_be_mode, 'pips')
  assert.equal(row.auto_be_trigger_value, 15)
  assert.equal(row.auto_be_type, 'sl_and_close_half')
  assert.equal(row.auto_be_offset_pips, 5)
  assert.equal(row.auto_be_risk_sl, 1990)
})

test('isAutoBeTriggerMet: pips', () => {
  assert.equal(
    isAutoBeTriggerMet({
      mode: 'pips',
      triggerValue: 20,
      tpIndex: 1,
      isBuy: true,
      entryPrice: 2000,
      riskSl: 1990,
      bid: 2021,
      ask: 2021.1,
      pipPrice: 0.1,
      pipValuePerLot: 10,
      partialTpFiredIndices: [],
      partialTpTriggers: [],
      brokerTp: null,
    }),
    true,
  )
  assert.equal(
    isAutoBeTriggerMet({
      mode: 'pips',
      triggerValue: 20,
      tpIndex: 1,
      isBuy: true,
      entryPrice: 2000,
      riskSl: 1990,
      bid: 2001,
      ask: 2001.1,
      pipPrice: 0.1,
      pipValuePerLot: 10,
      partialTpFiredIndices: [],
      partialTpTriggers: [],
      brokerTp: null,
    }),
    false,
  )
})

test('isAutoBeTriggerMet: rr', () => {
  assert.equal(
    isAutoBeTriggerMet({
      mode: 'rr',
      triggerValue: 1,
      tpIndex: 1,
      isBuy: true,
      entryPrice: 2000,
      riskSl: 1990,
      bid: 2010,
      ask: 2010.1,
      pipPrice: 0.1,
      pipValuePerLot: 10,
      partialTpFiredIndices: [],
      partialTpTriggers: [],
      brokerTp: null,
    }),
    true,
  )
})

test('computeBreakevenStopLoss and isSlAtOrBeyondBreakeven', () => {
  const be = computeBreakevenStopLoss(true, 2000, 10, 0.1, 2)
  assert.equal(be, 2001)
  assert.equal(isSlAtOrBeyondBreakeven(true, 2001, be, 0.1), true)
  assert.equal(isSlAtOrBeyondBreakeven(true, 1995, be, 0.1), false)
})
