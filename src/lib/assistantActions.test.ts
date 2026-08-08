import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isNavigatePathAllowed } from './assistantActions'

describe('assistantActions navigate allowlist', () => {
  it('allows known app paths', () => {
    for (const path of [
      '/dashboard',
      '/copier-engine',
      '/account-config',
      '/channels',
      '/billing',
      '/contact-support',
      '/pricing',
    ]) {
      assert.equal(isNavigatePathAllowed(path), true)
    }
  })

  it('rejects unknown paths', () => {
    assert.equal(isNavigatePathAllowed('/admin'), false)
    assert.equal(isNavigatePathAllowed('https://evil.example'), false)
    assert.equal(isNavigatePathAllowed('/dashboard/../admin'), false)
  })
})
