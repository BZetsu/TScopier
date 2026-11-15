import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeConfigureAiPatch, summarizeConfigureAiPatch } from './configureWithAiPatch'

describe('configureWithAiPatch', () => {
  it('keeps allowlisted keys and drops unknown ones', () => {
    const patch = sanitizeConfigureAiPatch({
      fixed_lot: 0.02,
      trade_style: 'multi',
      trailing_enabled: true,
      evil: 'nope',
      password: 'x',
    })
    assert.deepEqual(patch, {
      fixed_lot: 0.02,
      trade_style: 'multi',
      trailing_enabled: true,
    })
  })

  it('summarizes common risk fields', () => {
    const summary = summarizeConfigureAiPatch({
      fixed_lot: 0.05,
      trade_style: 'single',
      range_trading: true,
    })
    assert.match(summary, /lot 0\.05/)
    assert.match(summary, /style single/)
    assert.match(summary, /range on/)
  })

  it('allows breakeven / move-SL keys used by the product UI', () => {
    const patch = sanitizeConfigureAiPatch({
      move_sl_to_entry_after_mode: 'tp_hit',
      move_sl_to_entry_tp_index: 2,
      move_sl_to_entry_type: 'sl_only',
      breakeven_offset_pips: 3,
      move_sl_to_entry_after_value: 10,
    })
    assert.equal(patch.move_sl_to_entry_after_mode, 'tp_hit')
    assert.equal(patch.move_sl_to_entry_tp_index, 2)
    assert.equal(patch.move_sl_to_entry_type, 'sl_only')
    assert.equal(patch.breakeven_offset_pips, 3)
    assert.equal(patch.move_sl_to_entry_after_value, 10)
  })
})
