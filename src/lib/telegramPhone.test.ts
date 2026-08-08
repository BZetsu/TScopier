import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractTelegramPhoneFromText,
  looksLikeTelegramOtp,
  normalizeTelegramPhoneInput,
  redactTelegramPhones,
} from './telegramPhone'

describe('telegramPhone', () => {
  it('normalizes and validates phones', () => {
    assert.equal(normalizeTelegramPhoneInput('00 234 905 453 8604'), '+2349054538604')
    assert.equal(extractTelegramPhoneFromText('+2349054538604'), '+2349054538604')
    assert.equal(extractTelegramPhoneFromText('my number is +234 905 453 8604 thanks'), '+2349054538604')
    assert.equal(extractTelegramPhoneFromText('hello'), null)
  })

  it('detects OTP-looking messages', () => {
    assert.equal(looksLikeTelegramOtp('12345'), true)
    assert.equal(looksLikeTelegramOtp('12 345'), true)
    assert.equal(looksLikeTelegramOtp('please use 12345'), false)
  })

  it('redacts phones in history text', () => {
    assert.equal(redactTelegramPhones('call +2349054538604 now'), 'call [phone] now')
  })
})
