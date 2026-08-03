import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { normalizeManualSettingsForExecution } from './normalizeManualSettings'

test('normalizeManualSettingsForExecution: range_layering_type defaults to auto', () => {
  const out = normalizeManualSettingsForExecution({ trade_style: 'multi', range_trading: true })
  assert.equal(out.range_layering_type, 'auto')
})

test('normalizeManualSettingsForExecution: pending_order preserved', () => {
  const out = normalizeManualSettingsForExecution({
    trade_style: 'multi',
    range_trading: true,
    range_layering_type: 'pending_order',
  })
  assert.equal(out.range_layering_type, 'pending_order')
})

test('normalizeManualSettingsForExecution: unknown layering type falls back to auto', () => {
  const out = normalizeManualSettingsForExecution({
    trade_style: 'multi',
    range_layering_type: 'broker',
  })
  assert.equal(out.range_layering_type, 'auto')
})

test('normalizeManualSettingsForExecution: layering_mode defaults to legacy', () => {
  const out = normalizeManualSettingsForExecution({ trade_style: 'multi', range_trading: true })
  assert.equal(out.layering_mode, 'legacy')
})

test('normalizeManualSettingsForExecution: valid layering modes are preserved', () => {
  assert.equal(normalizeManualSettingsForExecution({ layering_mode: 'legacy' }).layering_mode, 'legacy')
  assert.equal(normalizeManualSettingsForExecution({ layering_mode: 'static' }).layering_mode, 'static')
  assert.equal(normalizeManualSettingsForExecution({ layering_mode: 'dynamic' }).layering_mode, 'dynamic')
})

test('normalizeManualSettingsForExecution: invalid layering_mode falls back to legacy', () => {
  const out = normalizeManualSettingsForExecution({ layering_mode: 'auto' })
  assert.equal(out.layering_mode, 'legacy')
})

test('normalizeManualSettingsForExecution: layer counts are integer-clamped', () => {
  assert.equal(normalizeManualSettingsForExecution({ static_layer_count: 0 }).static_layer_count, 1)
  assert.equal(normalizeManualSettingsForExecution({ static_layer_count: 21 }).static_layer_count, 20)
  assert.equal(normalizeManualSettingsForExecution({ static_layer_count: 5.8 }).static_layer_count, 5)
  assert.equal(normalizeManualSettingsForExecution({ dynamic_max_layers: -4 }).dynamic_max_layers, 1)
  assert.equal(normalizeManualSettingsForExecution({ dynamic_max_layers: 99 }).dynamic_max_layers, 20)
})

test('normalizeManualSettingsForExecution: range_step_pips 0 (Auto) is preserved', () => {
  const out = normalizeManualSettingsForExecution({ range_step_pips: 0, range_trading: true })
  assert.equal(out.range_step_pips, 0)
  // dynamic_step still gets a positive fallback when range step is Auto
  assert.equal(out.dynamic_step_pips, 3)
})

test('normalizeManualSettingsForExecution: range_layering_type remains independent from layering_mode', () => {
  const out = normalizeManualSettingsForExecution({
    layering_mode: 'dynamic',
    range_layering_type: 'pending_order',
    range_trading: true,
  })
  assert.equal(out.layering_mode, 'dynamic')
  assert.equal(out.range_layering_type, 'pending_order')
  assert.equal(out.range_trading, true)
})
