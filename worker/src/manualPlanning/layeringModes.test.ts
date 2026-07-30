import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  assertLayeringModeExecutionSupported,
  changeLayeringPlanMode,
  isDynamicLayeringMode,
  isLegacyLayeringMode,
  isStaticLayeringMode,
  parseLayeringPlanSnapshot,
  serializeLayeringPlanSnapshot,
} from './layeringModes'
import { planManualOrders } from '../manualPlanner'

test('layering mode helpers resolve expected modes', () => {
  assert.equal(isLegacyLayeringMode({}), true)
  assert.equal(isLegacyLayeringMode({ layering_mode: 'legacy' }), true)
  assert.equal(isStaticLayeringMode({ layering_mode: 'static' }), true)
  assert.equal(isDynamicLayeringMode({ layering_mode: 'dynamic' }), true)
  assert.equal(isLegacyLayeringMode({ layering_mode: 'bad' } as never), true)
})

test('feature gate allows legacy and rejects static/dynamic by default', () => {
  const prior = process.env.LAYERING_MODES_EXECUTION_ENABLED
  delete process.env.LAYERING_MODES_EXECUTION_ENABLED
  try {
    assert.deepEqual(assertLayeringModeExecutionSupported({ layering_mode: 'legacy' }), { ok: true })
    assert.deepEqual(assertLayeringModeExecutionSupported({ layering_mode: 'static' }), {
      ok: false,
      reason: 'layering_mode_static_execution_disabled',
    })
    assert.deepEqual(assertLayeringModeExecutionSupported({ layering_mode: 'dynamic' }), {
      ok: false,
      reason: 'layering_mode_dynamic_execution_disabled',
    })
  } finally {
    if (prior == null) delete process.env.LAYERING_MODES_EXECUTION_ENABLED
    else process.env.LAYERING_MODES_EXECUTION_ENABLED = prior
  }
})

test('feature gate flag is reserved until static/dynamic execution exists', () => {
  const prior = process.env.LAYERING_MODES_EXECUTION_ENABLED
  process.env.LAYERING_MODES_EXECUTION_ENABLED = 'true'
  try {
    assert.deepEqual(assertLayeringModeExecutionSupported({ layering_mode: 'legacy' }), { ok: true })
    assert.deepEqual(assertLayeringModeExecutionSupported({ layering_mode: 'static' }), {
      ok: false,
      reason: 'layering_mode_static_not_implemented',
    })
    assert.deepEqual(assertLayeringModeExecutionSupported({ layering_mode: 'dynamic' }), {
      ok: false,
      reason: 'layering_mode_dynamic_not_implemented',
    })
  } finally {
    if (prior == null) delete process.env.LAYERING_MODES_EXECUTION_ENABLED
    else process.env.LAYERING_MODES_EXECUTION_ENABLED = prior
  }
})

test('planner blocks static/dynamic range execution when feature gate is off', () => {
  const prior = process.env.LAYERING_MODES_EXECUTION_ENABLED
  delete process.env.LAYERING_MODES_EXECUTION_ENABLED
  try {
    const plan = planManualOrders({
      parsed: {
        action: 'buy',
        symbol: 'XAUUSD',
        entry_price: 2400,
        entry_zone_low: null,
        entry_zone_high: null,
        sl: 2390,
        tp: [2410],
        lot_size: null,
      },
      resolvedSymbol: 'XAUUSD',
      baseOperation: 'Buy',
      manual: {
        trade_style: 'multi',
        range_trading: true,
        layering_mode: 'static',
        static_layer_count: 5,
        fixed_lot: 0.1,
        multi_trade_leg_percent: 20,
        range_percent: 50,
        range_step_pips: 3,
        range_distance_pips: 30,
      },
      ctx: {
        point: 0.01,
        digits: 2,
        minLot: 0.01,
        lotStep: 0.01,
        defaultLot: 0.01,
        lastBalance: null,
      },
      channelKeywords: null,
      manualLot: 0.1,
      commentPrefix: 'test',
    })
    assert.equal(plan.orders.length, 0)
    assert.equal(plan.skip_reason, 'layering_mode_static_execution_disabled')
  } finally {
    if (prior == null) delete process.env.LAYERING_MODES_EXECUTION_ENABLED
    else process.env.LAYERING_MODES_EXECUTION_ENABLED = prior
  }
})

test('legacy row without plan metadata deserializes as legacy', () => {
  const plan = parseLayeringPlanSnapshot(null)
  assert.equal(plan.mode, 'legacy')
  assert.equal(plan.planId, 'legacy')
  assert.equal(plan.lockedAt, null)
})

test('static snapshot requires static count', () => {
  assert.throws(() => parseLayeringPlanSnapshot({ mode: 'static', planId: 'p1' }), /static layer count/)
  const plan = parseLayeringPlanSnapshot({
    mode: 'static',
    planId: 'p1',
    configuredStaticLayerCount: 5,
    plannedLayerCount: 5,
  })
  assert.equal(plan.mode, 'static')
  assert.equal(plan.configuredStaticLayerCount, 5)
})

test('dynamic snapshot requires step and max count', () => {
  assert.throws(() => parseLayeringPlanSnapshot({ mode: 'dynamic', planId: 'p1' }), /dynamic layering/)
  const plan = parseLayeringPlanSnapshot({
    mode: 'dynamic',
    planId: 'p1',
    configuredDynamicStepPips: 3,
    configuredDynamicMaxLayers: 5,
    plannedLayerCount: 4,
  })
  assert.equal(plan.mode, 'dynamic')
  assert.equal(plan.configuredDynamicStepPips, 3)
})

test('locked plan cannot change mode', () => {
  const plan = parseLayeringPlanSnapshot({
    mode: 'static',
    planId: 'p1',
    configuredStaticLayerCount: 5,
    lockedAt: '2026-07-30T00:00:00.000Z',
  })
  assert.throws(() => changeLayeringPlanMode(plan, 'dynamic'), /cannot change/)
})

test('snapshot round-trip preserves independent configuration values', () => {
  const plan = parseLayeringPlanSnapshot({
    planId: 'plan-123',
    mode: 'dynamic',
    signalId: 'sig',
    brokerAccountId: 'broker',
    symbol: 'XAUUSD',
    side: 'sell',
    originalRangeLow: 3340,
    originalRangeHigh: 3360,
    anchorPrice: 3350,
    anchorSource: 'fill',
    configuredDynamicStepPips: 5,
    configuredDynamicMaxLayers: 8,
    plannedLayerCount: 6,
    plannedTotalLot: 0.13,
    createdAt: '2026-07-30T00:00:00.000Z',
    lockedAt: null,
  })
  const roundTrip = parseLayeringPlanSnapshot(serializeLayeringPlanSnapshot(plan))
  assert.deepEqual(roundTrip, plan)
})

test('invalid anchor source and planned count fail safely', () => {
  assert.equal(parseLayeringPlanSnapshot({ anchorSource: 'account' }).anchorSource, 'unknown')
  assert.throws(() => parseLayeringPlanSnapshot({ plannedLayerCount: 99 }), /invalid planned/)
})

test('migration is additive and leaves old rows nullable legacy', () => {
  const sql = readFileSync('../supabase/migrations/20260730120000_layering_modes_foundation.sql', 'utf8')
  assert.match(sql, /add column if not exists layer_plan_id text/i)
  assert.match(sql, /add column if not exists layer_plan_metadata jsonb/i)
  assert.match(sql, /where layer_plan_id is not null/i)
  assert.doesNotMatch(sql, /\bdelete\b|\bdrop column\b|\bupdate public\.range_pending_legs\b/i)
})
