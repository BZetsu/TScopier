import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseChannelMessageSync, DEFAULT_CHANNEL_KEYWORDS } from './parseSignal'
import { resolvePreferredSignalEntryPrice } from './manualPlanning/parsedEntry'

describe('dual entry price parse (first/last)', () => {
  it('parses BUY NOW paren dual prices as ordered zone', () => {
    const msg = `XAUUSD BUY NOW:  (3879) 3878)

TAKE PROFIT: 1   (3881)
STOP LOSS:          (3840)`
    const { parsed, status } = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(status, 'parsed')
    assert.equal(parsed.action, 'buy')
    assert.equal(parsed.entry_zone_first, 3879)
    assert.equal(parsed.entry_zone_last, 3878)
    assert.equal(parsed.entry_zone_low, 3878)
    assert.equal(parsed.entry_zone_high, 3879)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'first_price', 'buy'), 3879)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price', 'buy'), 3878)
  })

  it('parses BUY NOW slash dual prices as ordered zone', () => {
    const msg = 'XAUUSD BUY NOW 3879 / 3878 SL 3840 TP 3881'
    const { parsed, status } = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, null)
    assert.equal(status, 'parsed')
    assert.equal(parsed.entry_zone_first, 3879)
    assert.equal(parsed.entry_zone_last, 3878)
    assert.equal(resolvePreferredSignalEntryPrice(parsed, 'last_price', 'buy'), 3878)
  })
})
