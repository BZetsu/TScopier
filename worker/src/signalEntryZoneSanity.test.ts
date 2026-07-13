import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { entryZoneFarFromQuote } from './signalEntryZoneSanity'

describe('entryZoneFarFromQuote', () => {
  it('flags typo zone far from live gold quote', () => {
    assert.equal(
      entryZoneFarFromQuote({
        parsed: { symbol: 'XAUUSD', entry_zone_low: 4513, entry_zone_high: 4516 },
        quoteBid: 4216,
        quoteAsk: 4216.5,
        direction: 'buy',
      }),
      true,
    )
  })

  it('allows zone near live gold quote', () => {
    assert.equal(
      entryZoneFarFromQuote({
        parsed: { symbol: 'XAUUSD', entry_zone_low: 4213, entry_zone_high: 4216 },
        quoteBid: 4215,
        quoteAsk: 4216,
        direction: 'buy',
      }),
      false,
    )
  })

  it('allows shorthand entry zone near market after parse fix', () => {
    assert.equal(
      entryZoneFarFromQuote({
        parsed: { symbol: 'XAUUSD', entry_zone_low: 4059, entry_zone_high: 4061 },
        quoteBid: 4060,
        quoteAsk: 4060.5,
        direction: 'buy',
      }),
      false,
    )
  })
})
