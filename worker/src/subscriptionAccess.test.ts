import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { invalidateCopierPauseCache, setUserCopierPausedCached } from './copierPause'
import { userMayRunCopierListener } from './subscriptionAccess'

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
      throw new Error(`unexpected table ${table}`)
    },
    auth: { admin: { getUserById: async () => ({ data: null, error: null }) } },
  }

  const allowed = await userMayRunCopierListener(supabase as never, 'user-inactive')
  assert.equal(allowed, false)
})
