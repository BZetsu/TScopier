import { describe, expect, it } from 'vitest'
import { joinOrigin, withQuery } from './site'

describe('withQuery', () => {
  it('keeps an absolute app URL absolute when adding a query param', () => {
    expect(withQuery('https://app.tscopier.ai/login', { ref: 'ABC' })).toBe(
      'https://app.tscopier.ai/login?ref=ABC',
    )
  })

  it('does not turn an absolute URL into a relative path', () => {
    expect(withQuery('https://app.tscopier.ai/login', { ref: null })).toBe(
      'https://app.tscopier.ai/login',
    )
    expect(withQuery('https://app.tscopier.ai/login', { ref: null })).not.toMatch(
      /^\/https?:\/\//,
    )
  })

  it('still merges query params onto relative paths', () => {
    expect(withQuery('/signup', { ref: 'ABC' })).toBe('/signup?ref=ABC')
    expect(withQuery('/pricing?site=marketing', { ref: 'x' })).toBe(
      '/pricing?site=marketing&ref=x',
    )
  })
})

describe('joinOrigin', () => {
  it('does not prefix origin onto an already-absolute URL', () => {
    expect(joinOrigin('https://tscopier.ai', 'https://app.tscopier.ai/login')).toBe(
      'https://app.tscopier.ai/login',
    )
  })

  it('joins a relative path onto the origin', () => {
    expect(joinOrigin('https://app.tscopier.ai', '/login')).toBe(
      'https://app.tscopier.ai/login',
    )
  })
})
