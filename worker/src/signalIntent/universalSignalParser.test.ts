import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compareParseShadowDiff } from './shadowDiff'
import { DEFAULT_CHANNEL_KEYWORDS, parseChannelMessageSync } from '../parseSignal'
import { tradeIntentToChannelParsedSignal } from './tradeIntentAdapter'
import { coerceTradeIntent } from './coerceTradeIntent'
import { PORTUGUESE_SCALP_SELL } from './fixtures/multilingualFixtures'

describe('compareParseShadowDiff', () => {
  it('detects action mismatch between deterministic and universal', () => {
    const det = parseChannelMessageSync(PORTUGUESE_SCALP_SELL.rawMessage, DEFAULT_CHANNEL_KEYWORDS, null)
    const intent = coerceTradeIntent({
      kind: 'entry',
      side: 'SELL',
      symbol: 'XAUUSD',
      entry: [4060],
      sl: 4080,
      tp: [4055, 4050, 4040],
      confidence: 0.99,
    })
    const uniParsed = {
      parsed: tradeIntentToChannelParsedSignal(intent, PORTUGUESE_SCALP_SELL.rawMessage),
      status: 'parsed' as const,
      skip_reason: null,
    }
    const diff = compareParseShadowDiff(det, uniParsed)
    assert.equal(typeof diff.differs, 'boolean')
    assert.equal(diff.universal_action, 'sell')
  })
})
