import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isCopierSignalRetryEligible } from './retrySignalDisplay'
import type { Signal } from '../types/database'

function signal(overrides: Partial<Signal>): Signal {
  return {
    id: 'sig-1',
    user_id: 'user-1',
    channel_id: 'channel-1',
    raw_message: 'GOLD BUY',
    raw_image_url: null,
    parsed_data: { action: 'buy' },
    status: 'failed',
    skip_reason: null,
    telegram_message_id: null,
    is_modification: false,
    parent_signal_id: null,
    created_at: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

test('structured non-retryable skip reasons hide copier retry action', () => {
  assert.equal(isCopierSignalRetryEligible(signal({
    status: 'skipped',
    skip_reason: 'SIGNAL_MISSING_REQUIRED_SL',
  })), false)
  assert.equal(isCopierSignalRetryEligible(signal({
    status: 'skipped',
    skip_reason: 'BROKER_SYMBOL_NOT_FOUND',
  })), false)
})

test('structured failure display can override failed status retry action', () => {
  assert.equal(isCopierSignalRetryEligible(signal({ status: 'failed' }), {
    retryable: false,
  }), false)
})

test('historical failed signals without structured metadata keep legacy retry action', () => {
  assert.equal(isCopierSignalRetryEligible(signal({ status: 'failed' })), true)
})

