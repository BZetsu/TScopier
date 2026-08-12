import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isReservedReferralPathSegment,
  referralCodeLooksValid,
} from './referralCapture'

describe('referralCodeLooksValid', () => {
  it('accepts normal referral codes', () => {
    assert.equal(referralCodeLooksValid('ABC123'), true)
    assert.equal(referralCodeLooksValid('partner-one'), true)
  })

  it('rejects reserved app path segments like verify-email', () => {
    assert.equal(isReservedReferralPathSegment('verify-email'), true)
    assert.equal(referralCodeLooksValid('verify-email'), false)
    assert.equal(referralCodeLooksValid('pricing'), false)
    assert.equal(referralCodeLooksValid('login'), false)
    assert.equal(referralCodeLooksValid('signup'), false)
  })

  it('rejects too-short or whitespace codes', () => {
    assert.equal(referralCodeLooksValid('ab'), false)
    assert.equal(referralCodeLooksValid('a b'), false)
  })
})
