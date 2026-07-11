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
