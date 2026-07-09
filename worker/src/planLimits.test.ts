import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isSubscriptionActive, isTrialEnded } from './planLimits'

test('trialing is inactive after trial_ends_at', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  assert.equal(isSubscriptionActive('trialing', past), false)
  assert.equal(isTrialEnded(past), true)
})

test('trialing is active before trial_ends_at', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  assert.equal(isSubscriptionActive('trialing', future), true)
})

test('active ignores past trial_ends_at', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString()
  assert.equal(isSubscriptionActive('active', past), true)
})
