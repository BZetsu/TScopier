import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
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
