import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withParseRetry } from './withParseRetry'

test('withParseRetry returns the value when the first attempt succeeds', async () => {
  let attempts = 0
  const result = await withParseRetry({
    maxAttempts: 3,
    backoffMs: () => 0,
    attempt: async () => {
      attempts += 1
      return { ok: true }
    },
  })
  assert.deepEqual(result, { ok: true })
  assert.equal(attempts, 1)
})

test('withParseRetry retries after failures and returns the success value', async () => {
  let attempts = 0
  const backoffs: number[] = []
  const retries: number[] = []
  const result = await withParseRetry({
    maxAttempts: 3,
    backoffMs: (i) => {
      backoffs.push(i)
      return 0
    },
    onRetry: (_err, i) => {
      retries.push(i)
    },
    attempt: async () => {
      attempts += 1
      if (attempts < 3) throw new Error(`transient ${attempts}`)
      return { ok: true, attempts }
    },
  })
  assert.deepEqual(result, { ok: true, attempts: 3 })
  assert.equal(attempts, 3)
  assert.deepEqual(backoffs, [0, 1])
  assert.deepEqual(retries, [0, 1])
})

test('withParseRetry throws the last error after all attempts fail', async () => {
  let attempts = 0
  const errors: string[] = []
  await assert.rejects(
    withParseRetry({
      maxAttempts: 3,
      backoffMs: () => 0,
      onRetry: (err, i) => {
        errors.push(`retry-after-${i}: ${err instanceof Error ? err.message : String(err)}`)
      },
      attempt: async (i) => {
        attempts += 1
        throw new Error(`fail-${i}`)
      },
    }),
    /fail-2/,
  )
  assert.equal(attempts, 3)
  assert.deepEqual(errors, ['retry-after-0: fail-0', 'retry-after-1: fail-1'])
})

test('withParseRetry honors the backoff delay between attempts', async () => {
  const start = Date.now()
  let attempts = 0
  await assert.rejects(
    withParseRetry({
      maxAttempts: 3,
      backoffMs: i => 25 * (i + 1),
      attempt: async () => {
        attempts += 1
        throw new Error('fail')
      },
    }),
  )
  const elapsed = Date.now() - start
  assert.equal(attempts, 3)
  assert.ok(elapsed >= 50, `expected at least 50ms of backoff, got ${elapsed}ms`)
})

test('withParseRetry with maxAttempts 1 never retries', async () => {
  let attempts = 0
  await assert.rejects(
    withParseRetry({
      maxAttempts: 1,
      backoffMs: () => {
        throw new Error('backoff must not be called')
      },
      attempt: async () => {
        attempts += 1
        throw new Error('fail-once')
      },
    }),
    /fail-once/,
  )
  assert.equal(attempts, 1)
})

test('withParseRetry normalizes invalid maxAttempts to at least 1', async () => {
  let attempts = 0
  await assert.rejects(
    withParseRetry({
      maxAttempts: 0,
      backoffMs: () => 0,
      attempt: async () => {
        attempts += 1
        throw new Error('x')
      },
    }),
  )
  assert.equal(attempts, 1)
})
