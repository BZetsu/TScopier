import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  authKeyDupDeferredRetryMs,
  authKeyDupMaxRecoveryAttempts,
  authKeyDupReconnectDelayMs,
  authKeyDupReconnectDelaysMs,
  redactTelegramConnectionLog,
  shouldEmitAuthKeyDupEvent,
} from './authKeyDuplicatedRecovery'

describe('shouldEmitAuthKeyDupEvent', () => {
  it('emits on first event', () => {
    assert.equal(shouldEmitAuthKeyDupEvent(0, 1_000), true)
  })

  it('suppresses within the interval', () => {
    assert.equal(shouldEmitAuthKeyDupEvent(1_000, 30_000, 60_000), false)
  })

  it('emits again after the interval', () => {
    assert.equal(shouldEmitAuthKeyDupEvent(1_000, 61_001, 60_000), true)
  })
})

describe('authKeyDupReconnectDelaysMs', () => {
  it('uses the cooldown once, then the named auth-dup delay', () => {
    assert.deepEqual(authKeyDupReconnectDelaysMs(3500, 30_000, 4), [3500, 30_000, 15_000, 30_000])
  })

  it('clamps extreme inputs', () => {
    const delays = authKeyDupReconnectDelaysMs(1, 1, 4)
    assert.equal(delays[0], 500)
    assert.equal(delays[1], 2000)
    assert.equal(delays.length, 4)
  })

  it('bounds retries to the configured maximum', () => {
    assert.equal(authKeyDupReconnectDelaysMs(3500, 30_000, 10).length, 10)
  })
})

describe('authKeyDupReconnectDelayMs', () => {
  it('defaults to about 30 seconds instead of the old 8 second path', () => {
    const prev = process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS
    delete process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS
    try {
      assert.equal(authKeyDupReconnectDelayMs(), 30_000)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS
      else process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS = prev
    }
  })

  it('reads the named environment override', () => {
    const prev = process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS
    process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS = '45000'
    try {
      assert.equal(authKeyDupReconnectDelayMs(), 45_000)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS
      else process.env.TELEGRAM_AUTH_DUP_RECONNECT_DELAY_MS = prev
    }
  })
})

describe('authKeyDupMaxRecoveryAttempts', () => {
  it('defaults to 4 cycles (down from 10 which caused death spiral)', () => {
    const prev = process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
    delete process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
    try {
      assert.equal(authKeyDupMaxRecoveryAttempts(), 4)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
      else process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = prev
    }
  })
})

describe('authKeyDupDeferredRetryMs', () => {
  it('defaults to about 60 seconds', () => {
    const prev = process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS
    delete process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS
    try {
      assert.equal(authKeyDupDeferredRetryMs(), 60_000)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS
      else process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS = prev
    }
  })

  it('reads the named environment override', () => {
    const prev = process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS
    process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS = '120000'
    try {
      assert.equal(authKeyDupDeferredRetryMs(), 120_000)
    } finally {
      if (prev == null) delete process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS
      else process.env.TELEGRAM_AUTH_DUP_DEFERRED_RETRY_MS = prev
    }
  })
})

describe('redactTelegramConnectionLog', () => {
  it('removes likely auth/session strings and phone-like numbers', () => {
    const msg = redactTelegramConnectionLog(
      'AUTH_KEY_DUPLICATED session=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ phone=12345678901',
    )
    assert.equal(msg.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), false)
    assert.equal(msg.includes('12345678901'), false)
    assert.match(msg, /\[redacted\]/)
  })
})
