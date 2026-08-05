import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  AI_REVIEW_MAX_AGE_MS,
  AI_REVIEW_EXPIRED_REASON,
  RETRYABLE_SIGNAL_SKIP_REASONS,
  SIGNAL_RETRY_DISPATCH_SOURCE,
} from './retrySignal'
import { SKIP_REASON_ENTRY_NOT_OPENED } from './manualPlanner'

test('SIGNAL_RETRY_DISPATCH_SOURCE is signal_retry', () => {
  assert.equal(SIGNAL_RETRY_DISPATCH_SOURCE, 'signal_retry')
})

test('RETRYABLE_SIGNAL_SKIP_REASONS includes entry_not_opened', () => {
  assert.equal(RETRYABLE_SIGNAL_SKIP_REASONS.has(SKIP_REASON_ENTRY_NOT_OPENED), true)
})

test('AI uncertain reviews have a bounded approval window', () => {
  assert.equal(AI_REVIEW_MAX_AGE_MS, 120_000)
  assert.equal(AI_REVIEW_EXPIRED_REASON, 'ai_review_expired')
  assert.equal(RETRYABLE_SIGNAL_SKIP_REASONS.has('ai classified as uncertain; human review required'), true)
})
