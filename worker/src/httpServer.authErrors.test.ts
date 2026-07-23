import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clientErrorPayload } from './httpServer'
import { NO_PENDING_PHONE_AUTH_ERROR } from './telegramAuthRecovery'

describe('clientErrorPayload', () => {
  it('preserves NO_PENDING_PHONE_AUTH as a stable code', () => {
    const err = new Error('Login session expired. Go back and request a new verification code.')
    err.name = NO_PENDING_PHONE_AUTH_ERROR

    assert.deepEqual(clientErrorPayload(err, 'Verification failed'), {
      error: 'Login session expired. Go back and request a new verification code.',
      message: 'Login session expired. Go back and request a new verification code.',
      code: NO_PENDING_PHONE_AUTH_ERROR,
    })
  })

  it('keeps old no-pending messages human-readable without a code', () => {
    assert.deepEqual(clientErrorPayload(new Error('No pending auth flow. Call send code first.'), 'Verification failed'), {
      error: 'Login session expired. Go back and request a new verification code.',
      message: 'Login session expired. Go back and request a new verification code.',
    })
  })
})
