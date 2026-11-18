import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { invalidateCopierPauseCache, setUserCopierPausedCached } from './copierPause'
import {
  extensionAccessActive,
  loadCachedSubscriptionExtensionEnd,
  queuesUntilSubscriptionEnd,
  subscriptionBlocksSignalExecution,
  subscriptionEndMs,
  userMayRunCopierListener,
  type UserSubscriptionRow,
} from './subscriptionAccess'

test('userMayRunCopierListener: active subscription allows listener even when copier paused', async () => {
  setUserCopierPausedCached('user-active-paused', true)
  const supabase = {
    from(table: string) {
      if (table === 'user_profiles') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: { is_admin: false, admin_until: null }, error: null }) }
              },
            }
          },
        }
      }
      if (table === 'subscriptions') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { plan: 'basic', status: 'active', extra_accounts: 0, trial_ends_at: null },
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
  }

  const allowed = await userMayRunCopierListener(supabase as never, 'user-active-paused')
  assert.equal(allowed, true)
  invalidateCopierPauseCache('user-active-paused')
})

test('userMayRunCopierListener: inactive subscription blocks listener', async () => {
  const supabase = {
    from(table: string) {
      if (table === 'user_profiles') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: { is_admin: false, admin_until: null }, error: null }) }
              },
            }
          },
        }
      }
      if (table === 'subscriptions') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { plan: 'basic', status: 'canceled', extra_accounts: 0, trial_ends_at: null },
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'subscription_extensions') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return { limit: async () => ({ data: [], error: null }) }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
  }

  const allowed = await userMayRunCopierListener(supabase as never, 'user-inactive')
  assert.equal(allowed, false)
})

test('userMayRunCopierListener: a live admin extension allows the listener again', async () => {
  const supabase = {
    from(table: string) {
      if (table === 'user_profiles') {
        return {
          select() {
            return {
              eq() {
                return { maybeSingle: async () => ({ data: { is_admin: false, admin_until: null }, error: null }) }
              },
            }
          },
        }
      }
      if (table === 'subscriptions') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { plan: 'basic', status: 'canceled', extra_accounts: 0, trial_ends_at: null },
                    error: null,
                  }),
                }
              },
            }
          },
        }
      }
      if (table === 'subscription_extensions') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit: async () => ({
                        data: [{ days: 14, granted_at: new Date(Date.now() - 86_400_000).toISOString() }],
                        error: null,
                      }),
                    }
                  },
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
  }

  const allowed = await userMayRunCopierListener(supabase as never, 'user-granted')
  assert.equal(allowed, true)
})

const DAY = 86_400_000
const future = Date.now() + 7 * DAY
const past = Date.now() - DAY

const basic: UserSubscriptionRow = {
  plan: 'basic',
  status: 'trialing',
  extra_accounts: 0,
  trial_ends_at: new Date(Date.now() - DAY).toISOString(),
}
const advanced: UserSubscriptionRow = { ...basic, plan: 'advanced' }
const advancedSettings = { range_trading: true } as Record<string, unknown>
const basicSettings = {} as Record<string, unknown>

test('admin always passes', () => {
  assert.equal(subscriptionBlocksSignalExecution(null, advancedSettings, true, null), null)
})

test('expired trial with no extension is blocked', () => {
  assert.equal(
    subscriptionBlocksSignalExecution(basic, basicSettings, false, null),
    'subscription_inactive',
  )
  assert.equal(
    subscriptionBlocksSignalExecution(basic, basicSettings, false, past),
    'subscription_inactive',
  )
})

test('expired trial with a live extension keeps running', () => {
  assert.equal(subscriptionBlocksSignalExecution(basic, basicSettings, false, future), null)
})

test('a live extension grants advanced features regardless of the stored plan', () => {
  assert.equal(subscriptionBlocksSignalExecution(basic, advancedSettings, false, future), null)
})

test('a live extension keeps plan limits: advanced keeps advanced features', () => {
  assert.equal(
    subscriptionBlocksSignalExecution(advanced, advancedSettings, false, future),
    null,
  )
})

test('an active basic subscription still cannot use advanced features', () => {
  const liveBasic: UserSubscriptionRow = { ...basic, status: 'active' }
  assert.equal(
    subscriptionBlocksSignalExecution(liveBasic, advancedSettings, false, null),
    'plan_advanced_feature_required',
  )
})

test('a user with no subscription row passes only with a live extension', () => {
  assert.equal(subscriptionBlocksSignalExecution(null, basicSettings, false, future), null)
  assert.equal(subscriptionBlocksSignalExecution(null, advancedSettings, false, future), null)
  assert.equal(subscriptionBlocksSignalExecution(null, basicSettings, false, null), 'subscription_inactive')
})

test('extensionAccessActive treats the end moment as expired', () => {
  assert.equal(extensionAccessActive(null), false)
  assert.equal(extensionAccessActive(future), true)
  assert.equal(extensionAccessActive(past), false)
  assert.equal(extensionAccessActive(Date.now(), Date.now()), false)
})

const DAY_MS = 86_400_000

test('subscriptionEndMs reads the period end even after cancellation', () => {
  const now = Date.now()
  const ended = new Date(now - DAY_MS).toISOString()
  // Stripe flips to canceled and keeps current_period_end. Discarding it there made a
  // grant expire unused on the ordinary cancellation path.
  assert.equal(
    subscriptionEndMs({ plan: 'basic', status: 'canceled', extra_accounts: 0, trial_ends_at: null, current_period_end: ended }),
    Date.parse(ended),
  )
  assert.equal(
    subscriptionEndMs({ plan: 'basic', status: 'active', extra_accounts: 0, trial_ends_at: null, current_period_end: ended }),
    Date.parse(ended),
  )
  assert.equal(
    subscriptionEndMs({ plan: 'basic', status: 'incomplete', extra_accounts: 0, trial_ends_at: null }),
    null,
  )
})

test('queuesUntilSubscriptionEnd only queues behind a running period', () => {
  const now = Date.now()
  const later = now + 10 * DAY_MS
  assert.equal(
    queuesUntilSubscriptionEnd({ plan: 'basic', status: 'active', extra_accounts: 0, trial_ends_at: null }, later, now),
    true,
  )
  assert.equal(
    queuesUntilSubscriptionEnd({ plan: 'basic', status: 'canceled', extra_accounts: 0, trial_ends_at: null }, later, now),
    false,
  )
  assert.equal(
    queuesUntilSubscriptionEnd({ plan: 'basic', status: 'active', extra_accounts: 0, trial_ends_at: null }, now - DAY_MS, now),
    false,
  )
})

test('a grant anchored at the period end still pays out after cancellation', async () => {
  const now = Date.now()
  const grantedAt = new Date(now - 7 * DAY_MS).toISOString()
  const periodEnd = new Date(now - DAY_MS).toISOString()
  const supabase = {
    from(table: string) {
      if (table !== 'subscription_extensions') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return {
                    limit: async () => ({ data: [{ days: 7, granted_at: grantedAt }], error: null }),
                  }
                },
              }
            },
          }
        },
      }
    },
  }
  const sub: UserSubscriptionRow = {
    plan: 'basic',
    status: 'canceled',
    extra_accounts: 0,
    trial_ends_at: null,
    current_period_end: periodEnd,
  }
  const end = await loadCachedSubscriptionExtensionEnd(supabase as never, 'user-grant-after-cancel', sub)
  // Anchored at the period end, not the grant date: -1 day + 7 days = +6 days.
  assert.equal(end, Date.parse(periodEnd) + 7 * DAY_MS)
  assert.equal(extensionAccessActive(end), true)
})
