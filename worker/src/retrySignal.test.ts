import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  AI_REVIEW_MAX_AGE_MS,
  AI_REVIEW_EXPIRED_REASON,
  RETRYABLE_SIGNAL_SKIP_REASONS,
  SIGNAL_RETRY_DISPATCH_SOURCE,
  isRetryableSignal,
  structuredRetryabilityFromPayload,
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

test('structured non-retryable trade failures override failed status retry', () => {
  const base = {
    status: 'failed',
    skip_reason: null,
    parsed_data: { action: 'buy' },
  }
  assert.equal(isRetryableSignal({
    ...base,
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'SIGNAL_MISSING_REQUIRED_SL',
    }),
  }), false)
  assert.equal(isRetryableSignal({
    ...base,
    structuredRetryability: structuredRetryabilityFromPayload({
      trade_failure: { retryable: false },
    }),
  }), false)
  assert.equal(isRetryableSignal({
    ...base,
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'BROKER_SYMBOL_NOT_FOUND',
    }),
  }), false)
  assert.equal(isRetryableSignal({
    ...base,
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'INVALID_LOT',
    }),
  }), false)
  assert.equal(isRetryableSignal({
    ...base,
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'BROKER_TIMEOUT',
    }),
  }), false)
})

test('structured retryable failures still pass through existing retry checks', () => {
  assert.equal(isRetryableSignal({
    status: 'failed',
    skip_reason: null,
    parsed_data: { action: 'buy' },
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'BROKER_ACCOUNT_UNAVAILABLE',
    }),
  }), true)
  assert.equal(isRetryableSignal({
    status: 'failed',
    skip_reason: null,
    parsed_data: { action: 'buy' },
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'MARKET_CLOSED',
    }),
  }), true)
  assert.equal(isRetryableSignal({
    status: 'failed',
    skip_reason: null,
    parsed_data: { action: 'close' },
    structuredRetryability: structuredRetryabilityFromPayload({
      reason_code: 'MARKET_CLOSED',
    }),
  }), false)
})

test('historical and malformed retry metadata preserve legacy failed retry behavior', () => {
  const base = {
    status: 'failed',
    skip_reason: null,
    parsed_data: { action: 'sell' },
  }
  assert.equal(structuredRetryabilityFromPayload(null), null)
  assert.equal(structuredRetryabilityFromPayload({ reason_code: 'UNKNOWN_REASON' }), null)
  assert.equal(structuredRetryabilityFromPayload({ trade_failure: { retryable: 'no' } }), null)
  assert.equal(isRetryableSignal(base), true)
  assert.equal(isRetryableSignal({
    ...base,
    structuredRetryability: structuredRetryabilityFromPayload({ reason_code: 'UNKNOWN_REASON' }),
  }), true)
})
