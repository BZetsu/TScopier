import { describe, expect, it } from 'vitest'
import { draftNumberError, parseDraftNumber } from './draftNumberField'

const messages = {
  required: 'Enter a value',
  invalid: 'Enter a valid number',
  min: 'Must be at least {min}',
  max: 'Must be at most {max}',
  positive: 'Must be greater than 0',
}

const format = (t: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), t)

describe('parseDraftNumber', () => {
  it('allows empty as null without coercing to min', () => {
    expect(parseDraftNumber('', { min: 1 })).toBeNull()
    expect(parseDraftNumber('  ', { min: 1 })).toBeNull()
  })

  it('parses valid values and rejects below min', () => {
    expect(parseDraftNumber('3', { min: 1 })).toBe(3)
    expect(parseDraftNumber('0', { min: 1 })).toBeNull()
    expect(parseDraftNumber('0.01', { positive: true, min: 0.01 })).toBe(0.01)
  })
})

describe('draftNumberError', () => {
  it('reports required for empty', () => {
    expect(draftNumberError('', { min: 1 }, messages, format)).toBe('Enter a value')
  })

  it('reports min without rewriting the input', () => {
    expect(draftNumberError('0', { min: 1 }, messages, format)).toBe('Must be at least 1')
  })

  it('accepts in-range values', () => {
    expect(draftNumberError('50', { min: 0, max: 100 }, messages, format)).toBeNull()
  })
})
