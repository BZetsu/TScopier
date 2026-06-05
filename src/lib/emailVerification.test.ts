import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { User } from '@supabase/supabase-js'
import {
  isEmailVerified,
  isUnconfirmedEmailAuthError,
  verifyEmailPath,
} from './emailVerification'

function userWith(confirmedAt: string | null): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    email_confirmed_at: confirmedAt,
  } as User
}

describe('isEmailVerified', () => {
  it('returns false when email_confirmed_at is missing', () => {
    assert.equal(isEmailVerified(userWith(null)), false)
    assert.equal(isEmailVerified(null), false)
  })

  it('returns true when email_confirmed_at is set', () => {
    assert.equal(isEmailVerified(userWith('2026-01-01T00:00:00Z')), true)
  })
})

describe('verifyEmailPath', () => {
  it('builds query string when email is present', () => {
    assert.equal(
      verifyEmailPath('user@example.com'),
      '/verify-email?email=user%40example.com',
    )
  })

  it('omits query when email is empty', () => {
    assert.equal(verifyEmailPath(''), '/verify-email')
  })
})

describe('isUnconfirmedEmailAuthError', () => {
  it('detects Supabase unconfirmed email errors', () => {
    assert.equal(isUnconfirmedEmailAuthError({ code: 'email_not_confirmed' }), true)
    assert.equal(isUnconfirmedEmailAuthError({ message: 'Email not confirmed' }), true)
    assert.equal(isUnconfirmedEmailAuthError({ message: 'Invalid login credentials' }), false)
  })
})
