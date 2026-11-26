import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  advancedOnlySettingsInUse,
  isSubscriptionActive,
  isTrialEnded,
  manualSettingsUseAdvancedFeatures,
  maxTradingViewWebhooks,
  normalizeManualSettingsForPlan,
} from './planLimits.ts'
import { hasTrialExpired } from './subscriptionCta.ts'

test('TradingView webhook limits by plan', () => {
  assert.equal(maxTradingViewWebhooks('basic'), 2)
  assert.equal(maxTradingViewWebhooks('advanced'), null)
  assert.equal(maxTradingViewWebhooks(null), 0)
})

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

test('advancedOnlySettingsInUse names each blocking setting', () => {
  assert.deepEqual(advancedOnlySettingsInUse({ trade_style: 'single' }), [])
  assert.deepEqual(advancedOnlySettingsInUse({ trade_style: 'multi' }), ['multi_trade'])
  assert.deepEqual(advancedOnlySettingsInUse({ range_trading: true }), ['range_trading'])
  assert.deepEqual(advancedOnlySettingsInUse({ reverse_signal: true }), ['reverse_signal'])
  assert.deepEqual(advancedOnlySettingsInUse({ close_worse_entries: true }), ['close_worse_entries'])
  assert.deepEqual(
    advancedOnlySettingsInUse({ move_sl_to_entry_after_mode: 'tp_hit' }),
    ['move_sl_to_entry'],
  )
  // 'none' and the empty string mean "off".
  assert.deepEqual(advancedOnlySettingsInUse({ move_sl_to_entry_after_mode: 'none' }), [])
  assert.deepEqual(advancedOnlySettingsInUse({ move_sl_to_entry_after_mode: '' }), [])
  assert.deepEqual(advancedOnlySettingsInUse({ rr_for_sl_enabled: true }), ['risk_reward'])
  assert.deepEqual(advancedOnlySettingsInUse({ rr_for_tps_enabled: true }), ['risk_reward'])
})

test('every advanced-only setting keeps manualSettingsUseAdvancedFeatures true', () => {
  const cases: Array<Record<string, unknown>> = [
    { trade_style: 'multi' },
    { range_trading: true },
    { reverse_signal: true },
    { close_worse_entries: true },
    { move_sl_to_entry_after_mode: 'pips' },
    { rr_for_sl_enabled: true },
    { rr_for_tps_enabled: true },
  ]
  for (const settings of cases) {
    assert.ok(advancedOnlySettingsInUse(settings).length > 0)
    assert.equal(manualSettingsUseAdvancedFeatures(settings), true)
  }
  // The two must agree on "nothing advanced in use" as well.
  const plain = { trade_style: 'single', range_trading: false, move_sl_to_entry_after_mode: 'none' }
  assert.deepEqual(advancedOnlySettingsInUse(plain), [])
  assert.equal(manualSettingsUseAdvancedFeatures(plain), false)
})
