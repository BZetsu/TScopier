import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { missingRequiredSlFailure } from './entryPrepare'
import type { ManualSettings, ParsedSignal } from '../manualPlanner'

function parsed(overrides: Partial<ParsedSignal>): ParsedSignal {
  return {
    action: 'buy',
    symbol: 'XAUUSD',
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl: null,
    tp: [2400],
    lot_size: null,
    raw_instruction: 'GOLD BUY TP 2400',
    ...overrides,
  }
}

describe('missingRequiredSlFailure', () => {
  it('detects provider-withheld SL when required stops have no configured fallback', () => {
    const result = missingRequiredSlFailure(parsed({
      tp: null,
      raw_instruction: 'GOLD BUY SL premium',
    }), { add_new_trades_to_existing: false })
    assert.deepEqual(result, { withheldByProvider: true })
  })

  it('detects SL for premium members when required stops have no fallback', () => {
    const result = missingRequiredSlFailure(parsed({
      tp: null,
      raw_instruction: 'GOLD BUY SL for premium members',
    }), { add_new_trades_to_existing: false })
    assert.deepEqual(result, { withheldByProvider: true })
  })

  it('detects subscribe-for-SL wording when required stops have no fallback', () => {
    const result = missingRequiredSlFailure(parsed({
      tp: null,
      raw_instruction: 'GOLD BUY subscribe for SL',
    }), { add_new_trades_to_existing: false })
    assert.deepEqual(result, { withheldByProvider: true })
  })

  it('detects VIP SL wording when required stops have no fallback', () => {
    const result = missingRequiredSlFailure(parsed({
      tp: null,
      raw_instruction: 'GOLD BUY SL available to VIP',
    }), { add_new_trades_to_existing: false })
    assert.deepEqual(result, { withheldByProvider: true })
  })

  it('does not make SL globally mandatory when TP satisfies the existing explicit-stops rule', () => {
    const result = missingRequiredSlFailure(parsed({
      raw_instruction: 'GOLD BUY TP 2400 SL premium',
    }), { add_new_trades_to_existing: false })
    assert.equal(result, null)
  })

  it('preserves numeric SL as executable', () => {
    const result = missingRequiredSlFailure(parsed({
      sl: 2290,
      raw_instruction: 'GOLD BUY SL 2290 TP 2400',
    }), {})
    assert.equal(result, null)
  })

  it('does not treat generic premium wording away from SL as withheld SL', () => {
    const result = missingRequiredSlFailure(parsed({
      raw_instruction: 'Premium signal GOLD BUY TP 2400',
    }), {})
    assert.equal(result, null)
  })

  it('does not treat VIP entry wording as withheld SL', () => {
    const result = missingRequiredSlFailure(parsed({
      raw_instruction: 'VIP entry GOLD BUY TP 2400',
    }), {})
    assert.equal(result, null)
  })

  it('does not treat premium channel marketing as withheld SL', () => {
    const result = missingRequiredSlFailure(parsed({
      raw_instruction: 'GOLD BUY TP 2400 - Join premium for more signals',
    }), {})
    assert.equal(result, null)
  })

  it('distinguishes a required missing stop from provider-withheld wording', () => {
    const result = missingRequiredSlFailure(parsed({
      tp: null,
      raw_instruction: 'GOLD BUY NOW',
    }), { add_new_trades_to_existing: false })
    assert.deepEqual(result, { withheldByProvider: false })
  })

  it('preserves SL-optional behavior when config does not require a stop', () => {
    const result = missingRequiredSlFailure(parsed({
      tp: null,
      raw_instruction: 'GOLD BUY NOW',
    }), {})
    assert.equal(result, null)
  })

  it('preserves SL-optional behavior when provider withheld SL but config does not require one', () => {
    const result = missingRequiredSlFailure(parsed({
      raw_instruction: 'GOLD BUY TP 2400 SL premium',
    }), {})
    assert.equal(result, null)
  })

  it('does not fail premium-SL signals when a configured fallback stop can be derived', () => {
    const manual: ManualSettings = {
      use_predefined_sl_pips: true,
      predefined_sl_pips: 30,
    }
    const result = missingRequiredSlFailure(parsed({
      entry_price: 2320,
      raw_instruction: 'GOLD BUY 2320 TP 2400 SL premium',
    }), manual)
    assert.equal(result, null)
  })
})
