import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bestEntryPrice,
  normalizeSignalEntryPrefer,
  resolvePreferredSignalEntryPrice,
  worseEntryPrice,
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

describe('worse/best entry helpers', () => {
  it('buy: worse is higher, best is lower', () => {
    assert.equal(worseEntryPrice('buy', 3879, 3878), 3879)
    assert.equal(bestEntryPrice('buy', 3879, 3878), 3878)
  })

  it('sell: worse is lower, best is higher', () => {
    assert.equal(worseEntryPrice('sell', 3885, 3887), 3885)
    assert.equal(bestEntryPrice('sell', 3885, 3887), 3887)
  })
})

describe('resolvePreferredSignalEntryPrice', () => {
  it('First Price = worse, Last Price = best for buy dual quotes', () => {
    const parsed = base({
      action: 'buy',
      entry_zone_low: 3878,
      entry_zone_high: 3879,
      entry_zone_first: 3879,
      entry_zone_last: 3878,
    })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price'), 3879)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3878)
  })

  it('First Price = worse, Last Price = best for sell dual quotes', () => {
    const parsed = base({
      action: 'sell',
      entry_zone_low: 3885,
      entry_zone_high: 3887,
      entry_zone_first: 3885,
      entry_zone_last: 3887,
    })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price'), 3885)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3887)
  })

  it('zone-only fallback does not flip buy first/last (was min→first)', () => {
    const parsed = base({
      action: 'buy',
      entry_zone_low: 3878,
      entry_zone_high: 3879,
    })
    // Previously first_price → lo (3878) which felt like Last/Best.
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price'), 3879)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3878)
  })

  it('prefers dual zone over scalar entry_price', () => {
    const parsed = base({
      action: 'buy',
      entry_price: 3879,
      entry_zone_low: 3878,
      entry_zone_high: 3879,
      entry_zone_first: 3879,
      entry_zone_last: 3878,
    })
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price'), 3878)
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
