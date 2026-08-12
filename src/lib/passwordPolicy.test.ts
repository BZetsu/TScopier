import { describe, expect, it } from 'vitest'
import { evaluatePassword } from './passwordPolicy'

describe('evaluatePassword', () => {
  it('accepts a strong password', () => {
    expect(evaluatePassword('Tr@de2026!')).toEqual({ ok: true })
  })

  it('rejects short passwords', () => {
    const result = evaluatePassword('Ab1!')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failures).toContain('too_short')
    }
  })

  it('rejects missing character classes', () => {
    const result = evaluatePassword('alllowercase1!')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failures).toContain('missing_uppercase')
    }
  })

  it('rejects common passwords', () => {
    const result = evaluatePassword('password1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failures).toContain('common_password')
    }
  })
})
