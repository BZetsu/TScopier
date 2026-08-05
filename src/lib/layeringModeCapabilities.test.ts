import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  layeringMechanismIsSelectable,
  layeringMechanismIsExecutable,
  layeringModeIsSelectable,
  LEGACY_ONLY_LAYERING_CAPABILITIES,
  normalizeLayeringModeCapabilities,
} from './layeringModeCapabilities'

test('layering capabilities fail closed for Static and Dynamic by default', () => {
  assert.equal(layeringModeIsSelectable(LEGACY_ONLY_LAYERING_CAPABILITIES, 'legacy'), true)
  assert.equal(layeringModeIsSelectable(LEGACY_ONLY_LAYERING_CAPABILITIES, 'static'), false)
  assert.equal(layeringModeIsSelectable(LEGACY_ONLY_LAYERING_CAPABILITIES, 'dynamic'), false)
  assert.equal(layeringMechanismIsSelectable(LEGACY_ONLY_LAYERING_CAPABILITIES, 'static', 'auto'), false)
  assert.equal(layeringMechanismIsSelectable(LEGACY_ONLY_LAYERING_CAPABILITIES, 'dynamic', 'pending_order'), false)
})

test('normalizes server capability response without exposing env-derived internals', () => {
  const caps = normalizeLayeringModeCapabilities({
    layeringModes: {
      legacy: { available: true },
      static: {
        available: true,
        configurable: true,
        preparationAvailable: true,
        executionAvailable: false,
        reasons: ['prepare_only'],
        executionMechanisms: {
          auto: { configurable: true, executable: false },
          pending_order: { configurable: false, executable: false },
        },
      },
      dynamic: {
        available: false,
        reasons: ['mode_disabled'],
        executionMechanisms: { auto: false, pending_order: false },
      },
    },
    limits: {
      staticLayerCount: { min: 1, max: 20 },
      dynamicStepPips: { minExclusive: 0 },
      dynamicMaxLayers: { min: 1, max: 20 },
    },
    rollout: { prepareOnly: true },
  })
  assert.equal(layeringModeIsSelectable(caps, 'static'), true)
  assert.equal(layeringModeIsSelectable(caps, 'dynamic'), false)
  assert.equal(layeringMechanismIsSelectable(caps, 'static', 'auto'), true)
  assert.equal(layeringMechanismIsExecutable(caps, 'static', 'auto'), false)
  assert.equal(layeringMechanismIsSelectable(caps, 'static', 'pending_order'), false)
  assert.deepEqual(caps.layeringModes.static.reasons, ['prepare_only'])
})

test('keeps Static and Dynamic selectable when configuration is allowed but execution is disabled', () => {
  const caps = normalizeLayeringModeCapabilities({
    layeringModes: {
      legacy: { available: true },
      static: {
        available: true,
        configurable: true,
        preparationAvailable: true,
        executionAvailable: false,
        reasons: ['global_disabled', 'prepare_only'],
        executionMechanisms: {
          auto: { configurable: true, executable: false },
          pending_order: { configurable: true, executable: false },
        },
      },
      dynamic: {
        available: true,
        configurable: true,
        preparationAvailable: true,
        executionAvailable: false,
        reasons: ['global_disabled', 'prepare_only'],
        executionMechanisms: {
          auto: { configurable: true, executable: false },
          pending_order: { configurable: false, executable: false },
        },
      },
    },
    rollout: { prepareOnly: true },
  })

  assert.equal(layeringModeIsSelectable(caps, 'static'), true)
  assert.equal(layeringModeIsSelectable(caps, 'dynamic'), true)
  assert.equal(layeringMechanismIsSelectable(caps, 'static', 'auto'), true)
  assert.equal(layeringMechanismIsExecutable(caps, 'static', 'auto'), false)
  assert.equal(layeringMechanismIsSelectable(caps, 'dynamic', 'auto'), true)
  assert.equal(layeringMechanismIsExecutable(caps, 'dynamic', 'auto'), false)
})

test('malformed capability response remains Legacy-only', () => {
  const caps = normalizeLayeringModeCapabilities({ layeringModes: { static: { available: 'true' } } })
  assert.equal(layeringModeIsSelectable(caps, 'legacy'), true)
  assert.equal(layeringModeIsSelectable(caps, 'static'), false)
  assert.equal(layeringModeIsSelectable(caps, 'dynamic'), false)
  assert.deepEqual(caps.limits.staticLayerCount, { min: 1, max: 20 })
})
