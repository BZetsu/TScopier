import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  cerebrasParseMaxTokens,
  cerebrasParseModel,
  cerebrasParseRetries,
  getUniversalParseMode,
  isUniversalParseEnabled,
  universalParseReconcileModel,
  universalParseReconcileTimeoutMs,
} from './parseConfig'

describe('parseConfig', () => {
  const prevMode = process.env.UNIVERSAL_PARSE_MODE
  const prevEnabled = process.env.UNIVERSAL_PARSE_ENABLED
  const prevCerebrasModel = process.env.CEREBRAS_PARSE_MODEL
  const prevReconcileModel = process.env.UNIVERSAL_PARSE_RECONCILE_MODEL
  const prevReconcileTimeout = process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS
  const prevCerebrasMaxTokens = process.env.CEREBRAS_PARSE_MAX_TOKENS
  const prevCerebrasRetries = process.env.CEREBRAS_PARSE_RETRIES

  after(() => {
    if (prevMode != null) process.env.UNIVERSAL_PARSE_MODE = prevMode
    else delete process.env.UNIVERSAL_PARSE_MODE
    if (prevEnabled != null) process.env.UNIVERSAL_PARSE_ENABLED = prevEnabled
    else delete process.env.UNIVERSAL_PARSE_ENABLED
    if (prevCerebrasModel != null) process.env.CEREBRAS_PARSE_MODEL = prevCerebrasModel
    else delete process.env.CEREBRAS_PARSE_MODEL
    if (prevReconcileModel != null) process.env.UNIVERSAL_PARSE_RECONCILE_MODEL = prevReconcileModel
    else delete process.env.UNIVERSAL_PARSE_RECONCILE_MODEL
    if (prevReconcileTimeout != null) {
      process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS = prevReconcileTimeout
    } else {
      delete process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS
    }
    if (prevCerebrasMaxTokens != null) {
      process.env.CEREBRAS_PARSE_MAX_TOKENS = prevCerebrasMaxTokens
    } else {
      delete process.env.CEREBRAS_PARSE_MAX_TOKENS
    }
    if (prevCerebrasRetries != null) {
      process.env.CEREBRAS_PARSE_RETRIES = prevCerebrasRetries
    } else {
      delete process.env.CEREBRAS_PARSE_RETRIES
    }
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

  it('defaults the stage 2 Cerebras model to gpt-oss-120b', () => {
    delete process.env.CEREBRAS_PARSE_MODEL
    assert.equal(cerebrasParseModel(), 'gpt-oss-120b')
  })

  it('respects CEREBRAS_PARSE_MODEL from env', () => {
    process.env.CEREBRAS_PARSE_MODEL = 'gpt-oss-20b'
    assert.equal(cerebrasParseModel(), 'gpt-oss-20b')
  })

  it('defaults the stage 3 reconcile model to gpt-4o', () => {
    delete process.env.UNIVERSAL_PARSE_RECONCILE_MODEL
    assert.equal(universalParseReconcileModel(), 'gpt-4o')
  })

  it('bounds the reconcile timeout', () => {
    delete process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS
    assert.equal(universalParseReconcileTimeoutMs(), 8000)
    process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS = '99'
    assert.equal(universalParseReconcileTimeoutMs(), 1000)
    process.env.UNIVERSAL_PARSE_RECONCILE_TIMEOUT_MS = '99999'
    assert.equal(universalParseReconcileTimeoutMs(), 30000)
  })

  it('defaults Cerebras max tokens to 2000 so the reasoning model finishes', () => {
    delete process.env.CEREBRAS_PARSE_MAX_TOKENS
    assert.equal(cerebrasParseMaxTokens(), 2000)
    process.env.CEREBRAS_PARSE_MAX_TOKENS = '5000'
    assert.equal(cerebrasParseMaxTokens(), 5000)
    process.env.CEREBRAS_PARSE_MAX_TOKENS = 'not-a-number'
    assert.equal(cerebrasParseMaxTokens(), 2000)
  })

  it('defaults Cerebras retries to 2 and bounds them', () => {
    delete process.env.CEREBRAS_PARSE_RETRIES
    assert.equal(cerebrasParseRetries(), 2)
    process.env.CEREBRAS_PARSE_RETRIES = '9'
    assert.equal(cerebrasParseRetries(), 5)
    process.env.CEREBRAS_PARSE_RETRIES = '0'
    assert.equal(cerebrasParseRetries(), 0)
  })
})
