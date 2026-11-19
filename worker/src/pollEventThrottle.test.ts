import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PollEventThrottle, POLL_EVENT_WINDOW_MS } from './pollEventThrottle'

describe('PollEventThrottle', () => {
  it('writes the first occurrence immediately', () => {
    const throttle = new PollEventThrottle()
    assert.deepEqual(throttle.shouldEmit('poll_error|disconnected', 1_000), { emit: true, repeats: 0, repeatSources: 0 })
  })

  it('suppresses repeats inside the window', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('poll_error|disconnected', 1_000)
    assert.deepEqual(throttle.shouldEmit('poll_error|disconnected', 2_000), { emit: false, repeats: 0, repeatSources: 0 })
    assert.deepEqual(throttle.shouldEmit('poll_error|disconnected', 30_000), { emit: false, repeats: 0, repeatSources: 0 })
  })

  it('writes again after the window and reports how many repeats and sources it skipped', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('poll_error|disconnected', 1_000, 'channel-a')
    throttle.shouldEmit('poll_error|disconnected', 4_000, 'channel-a')
    throttle.shouldEmit('poll_error|disconnected', 7_000, 'channel-b')
    throttle.shouldEmit('poll_error|disconnected', 10_000, 'channel-b')
    assert.deepEqual(
      throttle.shouldEmit('poll_error|disconnected', 1_000 + POLL_EVENT_WINDOW_MS, 'channel-c'),
      { emit: true, repeats: 3, repeatSources: 2 },
    )
    // The counters start again from zero after a written row.
    assert.deepEqual(
      throttle.shouldEmit('poll_error|disconnected', 1_000 + POLL_EVENT_WINDOW_MS + 3_000, 'channel-a'),
      { emit: false, repeats: 0, repeatSources: 0 },
    )
  })

  it('counts repeats without a source id but reports no sources', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('k', 0)
    throttle.shouldEmit('k', 1_000)
    throttle.shouldEmit('k', 2_000)
    assert.deepEqual(throttle.shouldEmit('k', 60_000), { emit: true, repeats: 2, repeatSources: 0 })
  })

  it('keeps separate counters per key', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('poll_error|cannot find entity', 1_000)
    throttle.shouldEmit('poll_error|cannot find entity', 2_000)
    assert.deepEqual(
      throttle.shouldEmit('poll_peer_resolve_failed|cannot find entity', 3_000),
      { emit: true, repeats: 0, repeatSources: 0 },
    )
    assert.deepEqual(throttle.shouldEmit('poll_error|cannot find entity', 4_000), { emit: false, repeats: 0, repeatSources: 0 })
  })

  it('honours a custom window', () => {
    const throttle = new PollEventThrottle(5_000)
    throttle.shouldEmit('k', 0)
    assert.equal(throttle.shouldEmit('k', 4_999).emit, false)
    assert.equal(throttle.shouldEmit('k', 5_000).emit, true)
  })

  it('clears so the first error after a reconnect writes immediately', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('poll_error|disconnected', 1_000)
    assert.equal(throttle.shouldEmit('poll_error|disconnected', 2_000).emit, false)
    throttle.clear()
    assert.equal(throttle.size(), 0)
    assert.deepEqual(throttle.shouldEmit('poll_error|disconnected', 3_000), { emit: true, repeats: 0, repeatSources: 0 })
  })

  it('prunes keys that have not been seen for a long time', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('stale', 0)
    // Enough new keys to force a prune pass regardless of insertion timing.
    for (let i = 0; i < 300; i++) throttle.shouldEmit(`key-${i}`, 20 * 60_000)
    assert.equal(throttle.size(), 300)
  })

  it('recovers from a backwards clock step instead of pinning the entry', () => {
    const throttle = new PollEventThrottle()
    throttle.shouldEmit('k', 100_000)
    // Wall clock jumps back 10 minutes. The entry re-anchors to the new "now",
    // so it suppresses once and then emits a window later — it never stays
    // pinned to the old, higher timestamp.
    assert.equal(throttle.shouldEmit('k', 40_000).emit, false)
    assert.equal(throttle.shouldEmit('k', 40_000 + POLL_EVENT_WINDOW_MS - 1).emit, false)
    assert.equal(throttle.shouldEmit('k', 40_000 + POLL_EVENT_WINDOW_MS).emit, true)
  })
})
