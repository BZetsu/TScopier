import { describe, expect, it } from 'vitest'
import { evaluateSignupEmail, signupErrorPolicyCode } from './signupEmailPolicy'

describe('evaluateSignupEmail', () => {
  it('allows normal addresses', () => {
    expect(evaluateSignupEmail('user@gmail.com')).toEqual({
      allowed: true,
      normalizedEmail: 'user@gmail.com',
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

  it('blocks MS consumer name+digits bots', () => {
    expect(evaluateSignupEmail('mamadou429302@live.com').allowed).toBe(false)
    expect(evaluateSignupEmail('john.smith@live.com').allowed).toBe(true)
  })

  it('blocks hotmail/outlook/proton signup domains', () => {
    expect(evaluateSignupEmail('john.smith@hotmail.com').allowed).toBe(false)
    expect(evaluateSignupEmail('user@outlook.com').allowed).toBe(false)
    expect(evaluateSignupEmail('user@outlook.co.uk').allowed).toBe(false)
    expect(evaluateSignupEmail('user@proton.me').allowed).toBe(false)
  })

  it('blocks RFC example domains', () => {
    const result = evaluateSignupEmail('bot@example.com')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.code).toBe('disposable_domain')
  })
})

describe('signupErrorPolicyCode', () => {
  it('maps database error from spam trigger', () => {
    expect(signupErrorPolicyCode('Database error saving new user')).toBe('blocked_email')
    expect(signupErrorPolicyCode('This email is not allowed.')).toBe('blocked_email')
  })
})
