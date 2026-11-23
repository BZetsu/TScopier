import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { entityCacheMissRetryDelayMs } from './userListener'

/**
 * An entity cache miss ("Could not find the input entity") means the Telegram
 * session has not learned a channel yet — normally right after a re-link. The
 * retry schedule must be fast enough that a resolvable channel recovers within
 * seconds, while still bounding the request rate for a channel that can never
 * resolve, so it cannot recreate the 2026-08-24 flood-wait incident.
 */
describe('entityCacheMissRetryDelayMs', () => {
  it('retries the first miss immediately', () => {
    assert.equal(entityCacheMissRetryDelayMs(1), 0)
  })

  it('escalates on each consecutive miss', () => {
    assert.equal(entityCacheMissRetryDelayMs(2), 5_000)
    assert.equal(entityCacheMissRetryDelayMs(3), 15_000)
    assert.equal(entityCacheMissRetryDelayMs(4), 60_000)
    assert.equal(entityCacheMissRetryDelayMs(5), 300_000)
  })

  it('caps at the final delay so a permanently stuck channel stays bounded', () => {
    for (const attempts of [6, 10, 100, 1_000]) {
      assert.equal(entityCacheMissRetryDelayMs(attempts), 300_000)
    }
  })

  it('treats a non-positive attempt count as the first attempt', () => {
    assert.equal(entityCacheMissRetryDelayMs(0), 0)
    assert.equal(entityCacheMissRetryDelayMs(-3), 0)
  })

  it('never delays a fresh channel more than the cap', () => {
    for (let attempts = 1; attempts <= 50; attempts++) {
      const delay = entityCacheMissRetryDelayMs(attempts)
      assert.ok(delay >= 0, `delay must not be negative at attempt ${attempts}`)
      assert.ok(delay <= 300_000, `delay must not exceed the cap at attempt ${attempts}`)
    }
  })

  it('is monotonic while escalating (later attempts never retry sooner)', () => {
    let previous = -1
    for (let attempts = 1; attempts <= 5; attempts++) {
      const delay = entityCacheMissRetryDelayMs(attempts)
      assert.ok(delay >= previous, `delay must not shrink at attempt ${attempts}`)
      previous = delay
    }
  })
})
