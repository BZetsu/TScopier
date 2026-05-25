import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CHANNEL_KEYWORDS,
  parseChannelMessageSync,
  type ChannelLexiconRow,
} from './parseSignal'

describe('parseChannelMessageSync', () => {
  const lexicon: ChannelLexiconRow | null = null

  it('parses minimal Gold buy now (SIGNALS 2 channel format)', () => {
    const msg = 'Gold buy now'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'buy')
    assert.equal(result.parsed.symbol, 'XAUUSD')
  })

  it('parses Close all now management (SIGNALS 2 channel format)', () => {
    const msg = 'Close all now'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'close')
  })

  it('parses standard market entry (SIGNALS PRO / SIGNALS 2 style)', () => {
    const msg = 'BUY XAUUSD NOW SL 2650 TP 2700 TP 2750'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'buy')
    assert.equal(result.parsed.symbol, 'XAUUSD')
    assert.equal(result.parsed.sl, 2650)
  })

  it('parses sell with explicit entry anchor (Signal Tester style)', () => {
    const msg = 'SELL GOLD 2655\nSL 2665\nTP 2640'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'sell')
    assert.equal(result.parsed.symbol, 'XAUUSD')
  })

  it('skips non-trade chat with no keyword match', () => {
    const msg = 'Good morning traders, market outlook for the week ahead.'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'skipped')
    assert.equal(result.parsed.action, 'ignore')
    assert.match(result.skip_reason ?? '', /No matching channel keywords/i)
  })

  it('respects ignore_keyword on channel', () => {
    const keywords = {
      ...DEFAULT_CHANNEL_KEYWORDS,
      additional: {
        ...DEFAULT_CHANNEL_KEYWORDS.additional,
        ignore_keyword: 'OUTLOOK',
      },
    }
    const msg = 'WEEKLY OUTLOOK — stay flat today'
    const result = parseChannelMessageSync(msg, keywords, lexicon)
    assert.equal(result.status, 'skipped')
    assert.equal(result.skip_reason, 'Non-trade message')
  })

  it('parses management breakeven reply', () => {
    const msg = 'Move SL to breakeven on XAUUSD'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'breakeven')
    assert.equal(result.parsed.symbol, 'XAUUSD')
  })

  it('parses entry without NOW when SL/TP present (parseEntryFromKeywords path)', () => {
    const msg = 'BUY EURUSD\nEntry 1.0850\nSL 1.0820\nTP 1.0900'
    const result = parseChannelMessageSync(msg, DEFAULT_CHANNEL_KEYWORDS, lexicon)
    assert.equal(result.status, 'parsed')
    assert.equal(result.parsed.action, 'buy')
    assert.equal(result.parsed.symbol, 'EURUSD')
  })
})
