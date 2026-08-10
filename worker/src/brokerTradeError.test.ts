import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFxHttpFailureMessage,
  humanizeOrderSendError,
  parseFxErrorEnvelope,
} from './brokerTradeError.ts'

describe('parseFxErrorEnvelope', () => {
  it('reads message + MRPC code from FxSocket body', () => {
    const env = parseFxErrorEnvelope({
      error: 'MRPC',
      message: 'SymbolSelect failed',
      command_id: 9831,
    })
    assert.equal(env.message, 'SymbolSelect failed')
    assert.equal(env.code, 'MRPC')
  })
})

describe('formatFxHttpFailureMessage', () => {
  it('maps SymbolSelect failed + OrderSend symbol to Symbol not found', () => {
    const msg = formatFxHttpFailureMessage({
      status: 500,
      body: { error: 'MRPC', message: 'SymbolSelect failed', command_id: 1 },
      requestBody: { symbol: 'XAUUSD', operation: 'Sell', volume: 0.01 },
    })
    assert.equal(msg, 'Symbol not found: XAUUSD')
  })

  it('maps SymbolSelect failed from getQuote URL symbol', () => {
    const msg = formatFxHttpFailureMessage({
      status: 500,
      body: { error: 'MRPC', message: 'SymbolSelect failed' },
      url: 'https://api.fxsocket.com/mt5/acct/getQuote?symbol=XAUUSD',
    })
    assert.equal(msg, 'Symbol not found: XAUUSD')
  })

  it('does not leave bare HTTP 500 when body is empty', () => {
    const msg = formatFxHttpFailureMessage({ status: 500, body: null })
    assert.match(msg, /Broker rejected this order/i)
    assert.doesNotMatch(msg, /^HTTP 500$/)
  })
})

describe('humanizeOrderSendError', () => {
  it('upgrades historical HTTP 500 with symbol', () => {
    assert.equal(
      humanizeOrderSendError('HTTP 500', 'XAUUSD'),
      'Broker rejected the order for XAUUSD. Check symbol mapping and try again.',
    )
  })

  it('normalizes SymbolSelect failed', () => {
    assert.equal(humanizeOrderSendError('SymbolSelect failed', 'gold#'), 'Symbol not found: GOLD#')
  })
})
