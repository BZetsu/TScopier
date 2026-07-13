import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { getUniversalParseMode, isUniversalParseEnabled } from './parseConfig'

describe('parseConfig', () => {
  const prevMode = process.env.UNIVERSAL_PARSE_MODE
  const prevEnabled = process.env.UNIVERSAL_PARSE_ENABLED

  after(() => {
    if (prevMode != null) process.env.UNIVERSAL_PARSE_MODE = prevMode
    else delete process.env.UNIVERSAL_PARSE_MODE
    if (prevEnabled != null) process.env.UNIVERSAL_PARSE_ENABLED = prevEnabled
    else delete process.env.UNIVERSAL_PARSE_ENABLED
  })

  it('defaults to shadow mode when UNIVERSAL_PARSE_MODE is unset', () => {
    delete process.env.UNIVERSAL_PARSE_MODE
    assert.equal(getUniversalParseMode(), 'shadow')
  })

  it('respects fastpath mode from env', () => {
    process.env.UNIVERSAL_PARSE_MODE = 'fastpath'
    assert.equal(getUniversalParseMode(), 'fastpath')
  })

  it('is enabled by default', () => {
    delete process.env.UNIVERSAL_PARSE_ENABLED
    delete process.env.UNIVERSAL_PARSE_MODE
    assert.equal(isUniversalParseEnabled(), true)
  })
})
