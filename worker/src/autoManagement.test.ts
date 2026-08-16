import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  autoManagementTradeSnapshot,
  breakevenStopLossForSymbol,
  clampBreakevenModifyStops,
  computeBreakevenStopLoss,
  isAutoBeTriggerMet,
  isAutoManagementEnabled,
  isSlAtOrBeyondBreakeven,
  resolveBreakevenOffsetPips,
  resolveSlForBreakevenCheck,
} from './autoManagement'

test('resolveBreakevenOffsetPips defaults to 3 when unset', () => {
  assert.equal(resolveBreakevenOffsetPips({}), 3)
  assert.equal(resolveBreakevenOffsetPips({ breakeven_offset_pips: 8 }), 8)
})

test('breakevenStopLossForSymbol: buy XAUUSD entry + 3 pips', () => {
  assert.equal(
    breakevenStopLossForSymbol({
      isBuy: true,
      entryPrice: 4330,
      manual: { breakeven_offset_pips: 3 },
      symbol: 'XAUUSD',
    }),
    4330.3,
  )
})

test('breakevenStopLossForSymbol: offset uses signal pip size across precisions', () => {
  const cases = [
    {
      name: '2-digit metal',
      symbol: 'XAUUSD',
      digits: 2,
      entryPrice: 4330,
      isBuy: true,
      expected: 4330.5,
    },
    {
      name: '3-digit JPY FX',
      symbol: 'USDJPY',
      digits: 3,
      entryPrice: 145.123,
      isBuy: false,
      expected: 145.073,
    },
    {
      name: '4-digit major FX',
      symbol: 'EURUSD',
      digits: 4,
      entryPrice: 1.2345,
      isBuy: true,
      expected: 1.235,
    },
    {
      name: '5-digit major FX',
      symbol: 'EURUSD',
      digits: 5,
      entryPrice: 1.23456,
      isBuy: false,
      expected: 1.23406,
    },
  ] as const

  for (const c of cases) {
    assert.equal(
      breakevenStopLossForSymbol({
        isBuy: c.isBuy,
        entryPrice: c.entryPrice,
        manual: { breakeven_offset_pips: 5 },
        symbol: c.symbol,
        digits: c.digits,
      }),
      c.expected,
      c.name,
    )
  }
})

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

test('isAutoBeTriggerMet: tp_hit uses absolute trigger price (predefined override)', () => {
  assert.equal(
    isAutoBeTriggerMet({
      mode: 'tp_hit',
      triggerValue: 2030, // absolute TP snapped at open
      tpIndex: 1,
      isBuy: true,
      entryPrice: 2000,
      riskSl: 1990,
      bid: 2030,
      ask: 2030.1,
      pipPrice: 0.1,
      pipValuePerLot: 10,
      partialTpFiredIndices: [],
      partialTpTriggers: [],
      brokerTp: null, // omitted so trade is not closed at trigger
    }),
    true,
  )
  assert.equal(
    isAutoBeTriggerMet({
      mode: 'tp_hit',
      triggerValue: 2030,
      tpIndex: 1,
      isBuy: true,
      entryPrice: 2000,
      riskSl: 1990,
      bid: 2020,
      ask: 2020.1,
      pipPrice: 0.1,
      pipValuePerLot: 10,
      partialTpFiredIndices: [],
      partialTpTriggers: [],
      brokerTp: null,
    }),
    false,
  )
  // Legacy unused pips default (10) must not look like a price trigger
  assert.equal(
    isAutoBeTriggerMet({
      mode: 'tp_hit',
      triggerValue: 10,
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
    false,
  )
})

test('autoManagementTradeSnapshot: tp_hit stores absolute trigger price', () => {
  const row = autoManagementTradeSnapshot(
    {
      move_sl_to_entry_after_mode: 'tp_hit',
      move_sl_to_entry_tp_index: 1,
      breakeven_offset_pips: 3,
    },
    2000,
    1990,
    { tpHitTriggerPrice: 2030 },
  )
  assert.equal(row.auto_be_mode, 'tp_hit')
  assert.equal(row.auto_be_trigger_value, 2030)
})

test('resolveAutoBeTpHitTriggerPrice + shouldOmitBrokerTpForAutoBeTpHit for single override TP', async () => {
  const {
    resolveAutoBeTpHitTriggerPrice,
    shouldOmitBrokerTpForAutoBeTpHit,
  } = await import('./autoManagement')
  const finalTps = [2030]
  const trigger = resolveAutoBeTpHitTriggerPrice({
    tpIndex: 1,
    finalTps,
    brokerTp: 2030,
  })
  assert.equal(trigger, 2030)
  assert.equal(
    shouldOmitBrokerTpForAutoBeTpHit({
      manual: {
        move_sl_to_entry_after_mode: 'tp_hit',
        move_sl_to_entry_tp_index: 1,
        trade_style: 'single',
      },
      brokerTp: 2030,
      finalTps,
      partialTps: [],
    }),
    true,
  )
  assert.equal(
    shouldOmitBrokerTpForAutoBeTpHit({
      manual: {
        move_sl_to_entry_after_mode: 'tp_hit',
        move_sl_to_entry_tp_index: 1,
        trade_style: 'multi',
      },
      brokerTp: 2030,
      finalTps,
      partialTps: [],
    }),
    false,
  )
  // Multi-TP with farther broker TP must keep broker TP
  assert.equal(
    shouldOmitBrokerTpForAutoBeTpHit({
      manual: {
        move_sl_to_entry_after_mode: 'tp_hit',
        move_sl_to_entry_tp_index: 1,
        trade_style: 'single',
      },
      brokerTp: 2060,
      finalTps: [2030, 2060],
      partialTps: [{ tpIdx: 1, triggerPrice: 2030 }],
    }),
    false,
  )
})

test('computeBreakevenStopLoss and isSlAtOrBeyondBreakeven', () => {
  const be = computeBreakevenStopLoss(true, 2000, 10, 0.1, 2)
  assert.equal(be, 2001)
  assert.equal(isSlAtOrBeyondBreakeven(true, 2001, be, 0.1), true)
  assert.equal(isSlAtOrBeyondBreakeven(true, 1995, be, 0.1), false)
})

test('resolveSlForBreakevenCheck prefers live broker SL over shared basket DB SL', () => {
  const dbSl = 2005
  const brokerSl = 1985
  const beSl = 2000
  const effective = resolveSlForBreakevenCheck(dbSl, brokerSl)
  assert.equal(effective, brokerSl)
  assert.equal(isSlAtOrBeyondBreakeven(true, effective, beSl, 0.1), false)
  assert.equal(isSlAtOrBeyondBreakeven(true, dbSl, beSl, 0.1), true)
})

test('autoManagementTradeSnapshot empty when entry missing', () => {
  assert.deepEqual(
    autoManagementTradeSnapshot({ move_sl_to_entry_after_mode: 'pips' }, null, 1990),
    {},
  )
})

test('clampBreakevenModifyStops nudges SL to broker min distance', () => {
  const out = clampBreakevenModifyStops({
    isBuy: true,
    stoploss: 2004.95,
    takeprofit: 2010,
    referencePrice: 2005,
    point: 0.01,
    digits: 2,
    stopsLevel: 10,
    freezeLevel: 0,
  })
  assert.equal(out.stoploss, 2004.88)
})

test('range leg trade payload includes auto_be when enabled', () => {
  const manual = {
    move_sl_to_entry_after_mode: 'pips',
    move_sl_to_entry_after_value: 15,
    breakeven_offset_pips: 5,
  }
  const autoBeCols = autoManagementTradeSnapshot(manual, 1990, 1980)
  const payload: Record<string, unknown> = {
    user_id: 'user-1',
    signal_id: 'sig-1',
    entry_price: 1990,
    sl: 1980,
    status: 'open',
    ...autoBeCols,
  }
  assert.equal(payload.auto_be_mode, 'pips')
  assert.equal(payload.auto_be_trigger_value, 15)
  assert.equal(payload.auto_be_risk_sl, 1980)
})
