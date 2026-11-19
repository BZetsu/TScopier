import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countFreshListenerLeasesForUsers,
  isLeaseRowLive,
  isTelegramListenerLiveForUser,
} from './sessionLease'

describe('sessionLease health helpers', () => {
  it('isLeaseRowLive accepts listener and all roles with future expiry', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    assert.equal(isLeaseRowLive({ expires_at: future, role: 'listener' }), true)
    assert.equal(isLeaseRowLive({ expires_at: future, role: 'all' }), true)
    assert.equal(isLeaseRowLive({ expires_at: future, role: 'channel_listener' }), true)
  })

  it('isLeaseRowLive rejects expired or wrong role', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    assert.equal(isLeaseRowLive({ expires_at: past, role: 'listener' }), false)
    assert.equal(isLeaseRowLive({ expires_at: past, role: 'trade' }), false)
    assert.equal(isLeaseRowLive(null), false)
  })

  it('countFreshListenerLeasesForUsers reports missing users', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const supabase = {
      from: () => ({
        select: () => ({
          in: async () => ({
            data: [{ user_id: 'user-a', expires_at: future, role: 'listener' }],
          }),
        }),
      }),
    }

    const result = await countFreshListenerLeasesForUsers(
      supabase as never,
      ['user-a', 'user-b'],
    )
    assert.equal(result.fresh, 1)
    assert.deepEqual(result.missingUserIds, ['user-b'])
  })

  it('isTelegramListenerLiveForUser requires lease + mtproto + fresh probe', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const freshProbe = new Date(Date.now() - 5_000).toISOString()
    const tables: Record<string, unknown> = {
      worker_session_leases: { expires_at: future, role: 'listener' },
      copier_listener_health: {
        mtproto_connected: true,
        last_successful_probe_at: freshProbe,
        freshness_threshold_ms: 90_000,
        shutdown_in_progress: false,
        recovery_exhausted: false,
      },
    }
    const supabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: tables[table] ?? null }),
          }),
        }),
      }),
    }

    assert.equal(await isTelegramListenerLiveForUser(supabase as never, 'user-live'), true)

    tables.copier_listener_health = {
      mtproto_connected: false,
      last_successful_probe_at: freshProbe,
      freshness_threshold_ms: 90_000,
      shutdown_in_progress: false,
      recovery_exhausted: false,
    }
    assert.equal(await isTelegramListenerLiveForUser(supabase as never, 'user-down'), false)
  })
})
