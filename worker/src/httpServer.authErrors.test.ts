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

  it('surfaces flood waits with the Telegram wait duration', () => {
    assert.deepEqual(clientErrorPayload(new Error('FLOOD_WAIT_183'), 'Failed to send code'), {
      error: 'Telegram has temporarily limited new login-code requests for this number. Please wait about 183 seconds before requesting another code.',
      message: 'Telegram has temporarily limited new login-code requests for this number. Please wait about 183 seconds before requesting another code.',
    })
  })

  it('maps deterministic Telegram phone auth failures to user-facing messages', () => {
    assert.match(clientErrorPayload(new Error('PHONE_NUMBER_INVALID'), 'Failed to send code').message, /full number with country code/i)
    assert.match(clientErrorPayload(new Error('PHONE_NUMBER_BANNED'), 'Failed to send code').message, /banned or restricted/i)
    assert.match(clientErrorPayload(new Error('SEND_CODE_UNAVAILABLE'), 'Failed to send code').message, /exhausted the available login-code delivery methods/i)
    assert.match(clientErrorPayload(new Error('PHONE_CODE_EXPIRED'), 'Verification failed').message, /expired/i)
    assert.match(clientErrorPayload(new Error('PHONE_CODE_INVALID'), 'Verification failed').message, /incorrect/i)
  })

  it('maps resend waits and Telegram resend failures to clear messages', () => {
    assert.match(clientErrorPayload(new Error('RESEND_WAIT_42'), 'Failed to resend code').message, /42 seconds/i)
    assert.match(clientErrorPayload(new Error('PHONE_CODE_HASH_EMPTY'), 'Failed to resend code').message, /login state expired/i)
    assert.match(clientErrorPayload(new Error('SMS_CODE_CREATE_FAILED'), 'Failed to resend code').message, /could not create an SMS/i)
    assert.match(clientErrorPayload(new Error('AUTH_RESTART'), 'Failed to resend code').message, /request a new verification code/i)
  })

  it('maps Telegram auth-rate and app-version failures to clear messages', () => {
    assert.match(clientErrorPayload(new Error('PHONE_NUMBER_FLOOD'), 'Failed to send code').message, /temporarily limited/i)
    assert.match(clientErrorPayload(new Error('PHONE_PASSWORD_FLOOD'), 'Verification failed').message, /password attempts/i)
    assert.match(clientErrorPayload(new Error('UPDATE_APP_TO_LOGIN'), 'Failed to send code').message, /updated Telegram app/i)
  })
})
