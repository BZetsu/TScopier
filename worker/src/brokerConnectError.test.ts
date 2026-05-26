import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyBrokerConnectError,
  isMtBridgeGlitchMessage,
  isSessionDropMessage,
} from './brokerConnectError'

describe('brokerConnectError', () => {
  it('treats MetatraderAPI null reference as session drop, not wrong login', () => {
    const raw = 'Object reference not set to an instance of an object. (:52886408)'
    assert.equal(isMtBridgeGlitchMessage(raw), true)
    assert.equal(classifyBrokerConnectError(raw), 'session_expired')
    assert.equal(isSessionDropMessage(raw), true)
  })

  it('still classifies invalid login as wrong_login', () => {
    assert.equal(classifyBrokerConnectError('invalid login'), 'wrong_login')
  })

  it('classifies not connected with login suffix as session_expired', () => {
    assert.equal(classifyBrokerConnectError('Not connected (:52886408)'), 'session_expired')
  })
})
