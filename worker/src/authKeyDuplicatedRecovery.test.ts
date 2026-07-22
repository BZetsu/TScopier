import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  authKeyDupReconnectDelaysMs,
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
  it('starts with cooldown then auth-dup delay then longer waits', () => {
    assert.deepEqual(authKeyDupReconnectDelaysMs(3500, 10_000), [3500, 10_000, 15_000, 30_000])
  })

  it('clamps extreme inputs', () => {
    const delays = authKeyDupReconnectDelaysMs(1, 1)
    assert.equal(delays[0], 500)
    assert.equal(delays[1], 2000)
    assert.equal(delays.length, 4)
  })
})
