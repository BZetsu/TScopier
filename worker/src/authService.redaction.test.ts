import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { redactAuthLogValue, sentCodeDelivery, sentCodeStatus } from './authService'

describe('redactAuthLogValue', () => {
  it('redacts phone numbers with a stable non-reversible identifier', () => {
    const first = redactAuthLogValue('normalizedPhone', '+15551234567')
    const second = redactAuthLogValue('rawPhone', '+15551234567')

    assert.match(first, /^\[phone:[a-f0-9]{12}\]$/)
    assert.equal(first, second)
    assert.doesNotMatch(first, /5551234567/)
  })

  it('fully redacts auth secrets and code hashes', () => {
    assert.equal(redactAuthLogValue('phoneCodeHash', 'hash-secret'), '[redacted]')
    assert.equal(redactAuthLogValue('auth_session_string', 'session-secret'), '[redacted]')
    assert.equal(redactAuthLogValue('password', 'cloud-password'), '[redacted]')
    assert.equal(redactAuthLogValue('code', '12345'), '[redacted]')
  })
})

describe('sentCodeDelivery', () => {
  function sentCode(className: string) {
    return { type: { className } }
  }

  it('maps Telegram app delivery separately from phone delivery', () => {
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeApp')), 'app')
  })

  it('maps SMS-style Telegram delivery variants to sms', () => {
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeSms')), 'sms')
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeFirebaseSms')), 'sms')
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeFragmentSms')), 'sms')
  })

  it('maps call-style Telegram delivery variants to call', () => {
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeCall')), 'call')
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeFlashCall')), 'call')
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeMissedCall')), 'call')
  })

  it('keeps unknown Telegram delivery variants generic', () => {
    assert.equal(sentCodeDelivery(sentCode('auth.SentCodeTypeEmailCode')), 'other')
  })
})

describe('sentCodeStatus', () => {
  it('keeps Telegram next_type and timeout for resend UX without exposing phoneCodeHash', () => {
    const status = sentCodeStatus({
      type: { className: 'auth.SentCodeTypeApp', length: 5 },
      nextType: { className: 'auth.CodeTypeSms' },
      timeout: 42,
    }, 1_000)

    assert.deepEqual(status, {
      delivery: 'app',
      next_delivery: 'sms',
      timeoutSeconds: 42,
      resendAvailableAt: 43_000,
      can_resend: true,
      canResend: true,
      code_length: 5,
    })
    assert.equal(Object.prototype.hasOwnProperty.call(status, 'phoneCodeHash'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(status, 'phone_code_hash'), false)
  })

  it('does not fabricate resend availability when Telegram omits next_type and timeout', () => {
    const status = sentCodeStatus({
      type: { className: 'auth.SentCodeTypeApp', length: 5 },
      nextType: undefined,
      timeout: undefined,
    }, 10_000)

    assert.equal(status.delivery, 'app')
    assert.equal(status.next_delivery, null)
    assert.equal(status.timeoutSeconds, null)
    assert.equal(status.resendAvailableAt, null)
    assert.equal(status.canResend, false)
    assert.equal(status.can_resend, false)
    assert.equal(status.code_length, 5)
  })
})
