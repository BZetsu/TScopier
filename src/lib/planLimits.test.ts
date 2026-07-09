import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  isSubscriptionActive,
  isTrialEnded,
  normalizeManualSettingsForPlan,
} from './planLimits.ts'
import { hasTrialExpired } from './subscriptionCta.ts'

test('basic plan normalization forces single trade style', () => {
  const normalized = normalizeManualSettingsForPlan('basic', 'active', {
    trade_style: 'multi',
    range_trading: true,
  })
  assert.equal(normalized.trade_style, 'single')
  assert.equal(normalized.range_trading, false)
})

test('advanced plan preserves multi trade style', () => {
  const normalized = normalizeManualSettingsForPlan('advanced', 'active', {
    trade_style: 'multi',
    range_trading: true,
  })
  assert.equal(normalized.trade_style, 'multi')
  assert.equal(normalized.range_trading, true)
})

test('trialing is active before trial_ends_at', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  assert.equal(isSubscriptionActive('trialing', future), true)
  assert.equal(isTrialEnded(future), false)
})

test('trialing is inactive after trial_ends_at', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  assert.equal(isSubscriptionActive('trialing', past), false)
  assert.equal(isTrialEnded(past), true)
  assert.equal(hasTrialExpired(past), true)
})

test('active status ignores trial_ends_at', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  assert.equal(isSubscriptionActive('active', past), true)
})

test('trialing without trial_ends_at stays active (legacy)', () => {
  assert.equal(isSubscriptionActive('trialing', null), true)
  assert.equal(hasTrialExpired(null), false)
})

test('hasTrialExpired requires a past date, not merely a non-empty string', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  assert.equal(hasTrialExpired(future), false)
  assert.equal(hasTrialExpired(''), false)
})
