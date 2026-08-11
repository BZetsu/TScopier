import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildTradeFailureAssistantPrompt,
  resolveTradeFailureDisplay,
} from './tradeFailureDisplay'

describe('resolveTradeFailureDisplay', () => {
  it('maps structured missing-SL payload to friendly copy', () => {
    const display = resolveTradeFailureDisplay({
      payload: {
        reason_code: 'SIGNAL_MISSING_REQUIRED_SL',
        withheldByProvider: true,
        missingField: 'stop_loss',
      },
      safeContext: { withheldByProvider: true, missingField: 'stop_loss' },
    })
    assert.equal(display?.reasonCode, 'SIGNAL_MISSING_REQUIRED_SL')
    assert.match(display?.title ?? '', /Stop Loss missing/)
    assert.match(display?.explanation ?? '', /premium\/VIP subscribers/)
    assert.equal(display?.retryable, false)
  })

  it('maps broker symbol failures and legacy SYMBOL_UNSUPPORTED to one code', () => {
    const fromCanonical = resolveTradeFailureDisplay({
      reasonCode: 'BROKER_SYMBOL_NOT_FOUND',
      safeContext: { requestedSymbol: 'XAUUSD' },
    })
    const fromLegacy = resolveTradeFailureDisplay({
      reasonCode: 'SYMBOL_UNSUPPORTED',
      safeContext: { requestedSymbol: 'XAUUSD' },
    })
    assert.equal(fromCanonical?.reasonCode, 'BROKER_SYMBOL_NOT_FOUND')
    assert.equal(fromLegacy?.reasonCode, 'BROKER_SYMBOL_NOT_FOUND')
    assert.match(fromCanonical?.explanation ?? '', /GOLD\/XAUUSD/)
  })

  it('keeps historical message-only logs readable', () => {
    const display = resolveTradeFailureDisplay({
      legacyMessage: 'Symbol not found: XAUUSDm',
    })
    assert.equal(display?.reasonCode, 'BROKER_SYMBOL_NOT_FOUND')
    assert.match(display?.explanation ?? '', /XAUUSDM/)
  })
})

describe('buildTradeFailureAssistantPrompt', () => {
  it('passes safe structured context and excludes sensitive fields', () => {
    const display = resolveTradeFailureDisplay({
      reasonCode: 'BROKER_SYMBOL_NOT_FOUND',
      safeContext: {
        requestedSymbol: 'XAUUSD',
        token: 'secret',
        rawSignalText: 'GOLD BUY',
        brokerPassword: 'pw',
      },
    })
    assert.ok(display)
    const prompt = buildTradeFailureAssistantPrompt(display!)
    assert.match(prompt, /Reason code: BROKER_SYMBOL_NOT_FOUND/)
    assert.match(prompt, /Do not override the reason code/)
    assert.match(prompt, /XAUUSD/)
    assert.doesNotMatch(prompt, /secret|rawSignalText|brokerPassword|GOLD BUY/)
  })
})
