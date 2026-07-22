import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPhoneCodeFatalAuthError,
  isRecoverableTelegramAuthError,
  noPendingPhoneAuthMessage,
} from './telegramAuthRecovery'

describe('isRecoverableTelegramAuthError', () => {
  it('treats wrong 2FA password as recoverable', () => {
    assert.equal(isRecoverableTelegramAuthError('PASSWORD_HASH_INVALID'), true)
    assert.equal(isRecoverableTelegramAuthError(new Error('PASSWORD_HASH_INVALID (caused by CheckPassword)')), true)
    assert.equal(isRecoverableTelegramAuthError('Two-step verification password is required'), true)
  })

  it('treats network timeouts as recoverable', () => {
    assert.equal(isRecoverableTelegramAuthError('Timeout while waiting'), true)
  })

  it('does not treat phone-code expiry as recoverable', () => {
    assert.equal(isRecoverableTelegramAuthError('PHONE_CODE_EXPIRED'), false)
  })
})

describe('isPhoneCodeFatalAuthError', () => {
  it('detects expired / invalid codes', () => {
    assert.equal(isPhoneCodeFatalAuthError('PHONE_CODE_EXPIRED'), true)
    assert.equal(isPhoneCodeFatalAuthError('PHONE_CODE_INVALID'), true)
  })
})

describe('noPendingPhoneAuthMessage', () => {
  it('returns a restart-friendly message', () => {
    assert.match(noPendingPhoneAuthMessage(), /new verification code/i)
  })
})
