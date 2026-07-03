import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { aggregateEntryFailureReason } from './dispatch'
import { SKIP_REASON_ENTRY_NOT_OPENED } from '../manualPlanner'

test('aggregateEntryFailureReason prefers broker failureReason', () => {
  const reason = aggregateEntryFailureReason([
    { openedOrMerged: false, failureReason: 'broker_session_not_connected' },
    { openedOrMerged: false },
  ])
  assert.equal(reason, 'broker_session_not_connected')
})

test('aggregateEntryFailureReason defaults to entry_not_opened', () => {
  const reason = aggregateEntryFailureReason([{ openedOrMerged: false }])
  assert.equal(reason, SKIP_REASON_ENTRY_NOT_OPENED)
})
