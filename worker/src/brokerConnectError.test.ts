import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyBrokerConnectError,
  friendlyBrokerConnectError,
  isDefinitiveCredentialError,
  isMtBridgeGlitchMessage,
  isSessionDropMessage,
} from './brokerConnectError'

describe('brokerConnectError', () => {
  it('treats FxSocket null reference as session drop, not wrong login', () => {
    const raw = 'Object reference not set to an instance of an object. (:52886408)'
    assert.equal(isMtBridgeGlitchMessage(raw), true)
    assert.equal(classifyBrokerConnectError(raw), 'session_expired')
    assert.equal(isSessionDropMessage(raw), true)
  })

  it('still classifies invalid login as wrong_login', () => {
    assert.equal(classifyBrokerConnectError('invalid login'), 'wrong_login')
    assert.equal(classifyBrokerConnectError('Invalid account'), 'wrong_login')
  })

  it('classifies not connected with login suffix as session_expired for existing sessions', () => {
    assert.equal(classifyBrokerConnectError('Not connected (:52886408)'), 'session_expired')
  })

  it('classifies not connected as terminal_not_ready during fresh credential connect (terminal still starting)', () => {
    assert.equal(
      classifyBrokerConnectError('Not connected (:52886408)', { credentialConnect: true }),
      'terminal_not_ready',
    )
    assert.match(
      friendlyBrokerConnectError('Not connected (:52886408)', { credentialConnect: true }),
      /could not load your account from the broker yet/i,
    )
  })

  it('still classifies genuine auth failures as credentials_rejected during fresh credential connect', () => {
    assert.equal(
      classifyBrokerConnectError('Could not authenticate', { credentialConnect: true }),
      'credentials_rejected',
    )
    assert.match(
      friendlyBrokerConnectError('Could not authenticate', { credentialConnect: true }),
      /account number, trading password/i,
    )
  })

  it('classifies account summary failures as terminal_not_ready', () => {
    assert.equal(
      classifyBrokerConnectError('Could not fetch account summary from the broker terminal'),
      'terminal_not_ready',
    )
    assert.match(
      friendlyBrokerConnectError('Could not fetch account summary from the broker terminal'),
      /could not load your account from the broker yet/i,
    )
  })

  it('only hard-fails on definitive credential errors mid-establishment', () => {
    assert.equal(isDefinitiveCredentialError('wrong_password'), true)
    assert.equal(isDefinitiveCredentialError('wrong_login'), true)
    assert.equal(isDefinitiveCredentialError('wrong_server'), true)
    assert.equal(isDefinitiveCredentialError('investor_password'), true)
    assert.equal(isDefinitiveCredentialError('account_disabled'), true)
    // Transient / ambiguous kinds must stay recoverable (pending), not hard-fail.
    assert.equal(isDefinitiveCredentialError('terminal_not_ready'), false)
    assert.equal(isDefinitiveCredentialError('credentials_rejected'), false)
    assert.equal(isDefinitiveCredentialError('session_expired'), false)
    assert.equal(isDefinitiveCredentialError('unknown'), false)
  })
})
