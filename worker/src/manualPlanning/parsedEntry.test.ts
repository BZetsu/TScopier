import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeSignalEntryPrefer,
  resolvePreferredSignalEntryPrice,
} from './parsedEntry'
import type { ParsedSignal } from './types'

function base(partial: Partial<ParsedSignal>): ParsedSignal {
  return {
    action: 'buy',
    symbol: 'XAUUSD',
    entry_price: null,
    entry_zone_low: null,
    entry_zone_high: null,
    sl: null,
    tp: null,
    lot_size: null,
    ...partial,
  }
}

describe('resolvePreferredSignalEntryPrice', () => {
  it('uses text order first/last when ordered pair is present', () => {
    const parsed = base({
      entry_zone_low: 3878,
      entry_zone_high: 3879,
      entry_zone_first: 3879,
      entry_zone_last: 3878,
    })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price'), 3879)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3878)
  })

  it('prefers ordered pair over scalar entry_price', () => {
    const parsed = base({
      entry_price: 3879,
      entry_zone_low: 3878,
      entry_zone_high: 3879,
      entry_zone_first: 3879,
      entry_zone_last: 3878,
    })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3878)
  })

  it('falls back to zone lo/hi when order was not preserved', () => {
    const parsed = base({
      entry_zone_low: 3878,
      entry_zone_high: 3879,
    })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price'), 3878)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3879)
  })

  it('falls back to scalar entry_price', () => {
    const parsed = base({ entry_price: 2650 })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price'), 2650)
  })
})

describe('normalizeSignalEntryPrefer', () => {
  it('defaults to first_price', () => {
    assert.equal(normalizeSignalEntryPrefer(undefined), 'first_price')
    assert.equal(normalizeSignalEntryPrefer('LAST_PRICE'), 'last_price')
  })
})
