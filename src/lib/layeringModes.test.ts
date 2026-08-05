import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DEFAULT_MANUAL_SETTINGS, ensurePersistedManualSettings } from './defaultManualSettings'
import { normalizeLayeringModeSettings } from './layeringModes'

test('frontend layering settings default to legacy', () => {
  const normalized = normalizeLayeringModeSettings({})
  assert.equal(normalized.layering_mode, 'legacy')
  assert.equal(normalized.static_layer_count, 5)
  assert.equal(normalized.dynamic_step_pips, 3)
  assert.equal(normalized.dynamic_max_layers, 5)
  assert.equal(normalized.layering_optimization_strategy, 'adjust_percent')
})

test('frontend layering settings always normalize sizing strategy to adjust_percent', () => {
  const normalized = normalizeLayeringModeSettings({
    layering_optimization_strategy: 'widen_step',
  })
  assert.equal(normalized.layering_optimization_strategy, 'adjust_percent')
})

test('frontend layering settings round-trip without converting legacy', () => {
  const saved = ensurePersistedManualSettings({
    ...DEFAULT_MANUAL_SETTINGS,
    layering_mode: 'dynamic',
    static_layer_count: 6,
    dynamic_step_pips: 4.5,
    dynamic_max_layers: 9,
    layering_optimization_strategy: 'widen_step',
    range_layering_type: 'pending_order',
  })
  assert.equal(saved.layering_mode, 'dynamic')
  assert.equal(saved.range_layering_type, 'pending_order')
  assert.equal(saved.dynamic_step_pips, 4.5)
  assert.equal(saved.layering_optimization_strategy, 'widen_step')
})

test('frontend layering validation clamps counts and rejects invalid step', () => {
  const normalized = normalizeLayeringModeSettings({
    layering_mode: 'unknown',
    static_layer_count: 30,
    dynamic_step_pips: 0,
    dynamic_max_layers: -2,
    layering_optimization_strategy: 'invalid',
    range_step_pips: 7,
  })
  assert.equal(normalized.layering_mode, 'legacy')
  assert.equal(normalized.static_layer_count, 20)
  assert.equal(normalized.dynamic_step_pips, 7)
  assert.equal(normalized.dynamic_max_layers, 1)
  assert.equal(normalized.layering_optimization_strategy, 'adjust_percent')
})
