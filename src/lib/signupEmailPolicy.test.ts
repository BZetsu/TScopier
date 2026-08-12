import { describe, expect, it } from 'vitest'
import { evaluateSignupEmail, signupErrorPolicyCode } from './signupEmailPolicy'

describe('evaluateSignupEmail', () => {
  it('allows normal addresses', () => {
    expect(evaluateSignupEmail('user@example.com')).toEqual({
      allowed: true,
      normalizedEmail: 'user@example.com',
    })
  })

  it('blocks pornhub pattern', () => {
    expect(evaluateSignupEmail('pornhub38969@hotmail.com').allowed).toBe(false)
  })

  it('blocks porhub typo variant', () => {
    expect(evaluateSignupEmail('porhub94274@hotmail.com').allowed).toBe(false)
  })

  it('blocks disposable domains', () => {
    const result = evaluateSignupEmail('test@mailinator.com')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.code).toBe('disposable_domain')
  })

  it('blocks adult brand domains', () => {
    expect(evaluateSignupEmail('gaylord297426@pornhub.com').allowed).toBe(false)
  })

  it('blocks keyword locals like gay*', () => {
    expect(evaluateSignupEmail('gaylord297426@hotmail.com').allowed).toBe(false)
    expect(evaluateSignupEmail('user@something-porn.example').allowed).toBe(false)
  })
})

describe('signupErrorPolicyCode', () => {
  it('maps database error from spam trigger', () => {
    expect(signupErrorPolicyCode('Database error saving new user')).toBe('blocked_email')
  })
})
