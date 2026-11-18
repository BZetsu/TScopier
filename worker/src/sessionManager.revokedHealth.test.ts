import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UserSessionManager } from './sessionManager'
import { UserListener } from './userListener'
import type { SupabaseClient } from '@supabase/supabase-js'

type RpcCall = { name: string; args: Record<string, unknown> }

/**
 * Minimal supabase double: records every `rpc` call (health writes) and every
 * table touch, and answers reads with a null/empty payload. `disconnectListener`
 * and `renewOneListenerLease` are the paths under test — both are pure writes
 * plus lease bookkeeping, so nothing here needs real data beyond "no pending
 * auth" and "the lease op finished".
 */
function makeSupabase() {
  const calls: Array<{ table: string; op: string }> = []
  const rpcCalls: RpcCall[] = []
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      insert: () => b,
      upsert: () => b,
      update: () => b,
      delete: () => b,
      eq: () => b,
      neq: () => b,
      gt: () => b,
      lt: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: () => {
        calls.push({ table, op: 'maybeSingle' })
        return Promise.resolve({ data: null, error: null })
      },
      single: () => {
        calls.push({ table, op: 'single' })
        return Promise.resolve({ data: null, error: null })
      },
      then: (resolve: (v: unknown) => void) => {
        calls.push({ table, op: 'await' })
        resolve({ data: null, error: null })
      },
    }
    return b
  }
  return {
    calls,
    rpcCalls,
    from: (table: string) => {
      return new Proxy(builder(table), {
        get: (target, prop, receiver) => {
          if (typeof prop === 'string') {
            calls.push({ table, op: prop })
          }
          return Reflect.get(target, prop, receiver)
        },
      })
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return { data: true, error: null }
    },
    removeChannel: async () => {},
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  }
}

type Internal = {
  listeners: Map<string, UserListener>
  disconnectedRenewTicks: Map<string, number>
  stalledRenewTicks: Map<string, number>
  stalledHealBudget: Map<string, { count: number; windowStartMs: number }>
  stalledHealsThisCycle: number
  disconnectListener(userId: string): Promise<void>
  renewOneListenerLease(
    userId: string,
    listener: UserListener,
    opts: { staleMs: number; perUserTimeoutMs: number },
  ): Promise<void>
}

function makeListener(opts: {
  revoked: boolean
  userId: string
  connected?: boolean
  stalled?: boolean
  pollBackoff?: boolean
  stopThrows?: boolean
}) {
  const state = {
    stopped: 0,
    reconnectKicked: [] as string[],
    stalled: () => opts.stalled ?? false,
    pollBackoff: () => opts.pollBackoff ?? false,
    stopThrows: () => opts.stopThrows ?? false,
  }
  const listener = {
    isSessionRevoked: () => opts.revoked,
    isTelegramConnected: () => opts.connected ?? false,
    isListenerHealthy: () => !state.stalled(),
    isPollLoopStalled: () => state.stalled(),
    isPollBackoffActive: () => state.pollBackoff(),
    requestReconnectIfDisconnected: (reason: string) => { state.reconnectKicked.push(reason) },
    stop: async () => {
      state.stopped += 1
      if (state.stopThrows()) throw new Error('stop failed')
    },
    getHealthOwnershipEpoch: () => 'epoch-1',
    getHealthLeaseAcquiredAt: () => '2026-09-30T00:00:00.000Z',
  }
  return { listener: listener as unknown as UserListener, state }
}

function healthWrites(supabase: ReturnType<typeof makeSupabase>) {
  return supabase.rpcCalls.filter(c => c.name === 'upsert_copier_listener_health')
}

describe('sessionManager revoked-session health writes', () => {
  it('writes reconnect_required and recovery_exhausted when stopping a revoked listener', async () => {
    const supabase = makeSupabase()
    const manager = new UserSessionManager(supabase as unknown as SupabaseClient)
    const internal = manager as unknown as Internal
    const { listener } = makeListener({ revoked: true, userId: 'user-revoked-stop' })
    internal.listeners.set('user-revoked-stop', listener)

    await internal.disconnectListener('user-revoked-stop')

    // Pre-fix behaviour: both writes hard-coded telegram_account_status
    // 'linked' and left recovery_exhausted unset, so the re-link banner written
    // by the listener a moment earlier was overwritten on the very next stop
    // (the two columns are overwritten on every upsert).
    const writes = healthWrites(supabase)
    assert.equal(writes.length, 2, 'stop must write health before and after the lease release')
    assert.equal(writes[0].args.p_telegram_account_status, 'reconnect_required')
    assert.equal(writes[0].args.p_recovery_exhausted, true)
    assert.equal(writes[0].args.p_allow_without_lease, true)
    assert.equal(writes[0].args.p_require_lease, false)
    assert.equal(writes[0].args.p_shutdown_in_progress, true)
    assert.equal(writes[1].args.p_telegram_account_status, 'reconnect_required')
    assert.equal(writes[1].args.p_recovery_exhausted, true)
    assert.equal(writes[1].args.p_worker_ownership_status, 'unowned')
    assert.equal(writes[1].args.p_shutdown_in_progress, false)
    assert.equal(internal.listeners.size, 0, 'the listener must still be removed from the map')
  })

  it('keeps a healthy listener linked and not exhausted on stop', async () => {
    const supabase = makeSupabase()
    const manager = new UserSessionManager(supabase as unknown as SupabaseClient)
    const internal = manager as unknown as Internal
    const { listener } = makeListener({ revoked: false, userId: 'user-healthy-stop' })
    internal.listeners.set('user-healthy-stop', listener)

    await internal.disconnectListener('user-healthy-stop')

    const writes = healthWrites(supabase)
    assert.equal(writes.length, 2)
    assert.equal(writes[0].args.p_telegram_account_status, 'linked')
    assert.equal(writes[0].args.p_recovery_exhausted, false)
    // A healthy stop still goes through the lease check.
    assert.equal(writes[0].args.p_require_lease, true)
    assert.equal(writes[0].args.p_allow_without_lease, false)
    assert.equal(writes[1].args.p_telegram_account_status, 'linked')
    assert.equal(writes[1].args.p_recovery_exhausted, false)
  })

  it('parks a revoked listener on lease renew instead of stopping or reconnecting it', async () => {
    const adminUserId = 'user-revoked-renew'
    // userMayRunCopierListener short-circuits on this env list, so the renew
    // path never needs a subscriptions row to reach the parked branch.
    process.env.TSCOPIER_ADMIN_USER_IDS = adminUserId
    try {
      const supabase = makeSupabase()
      const manager = new UserSessionManager(supabase as unknown as SupabaseClient)
      const internal = manager as unknown as Internal
      const { listener, state } = makeListener({ revoked: true, userId: adminUserId })
      internal.listeners.set(adminUserId, listener)
      internal.disconnectedRenewTicks.set(adminUserId, 3)

      await internal.renewOneListenerLease(adminUserId, listener, {
        staleMs: 120_000,
        perUserTimeoutMs: 1_000,
      })

      assert.equal(state.stopped, 0, 'a revoked listener must not be stopped (that restarted the heal cycle)')
      assert.deepEqual(state.reconnectKicked, [], 'a revoked listener must not be reconnected')
      assert.equal(
        internal.disconnectedRenewTicks.has(adminUserId),
        false,
        'the disconnect counter must be cleared so it never reaches the hard-reset threshold',
      )
      assert.equal(
        internal.listeners.has(adminUserId),
        true,
        'the listener must stay parked in the map until the user re-links',
      )
    } finally {
      delete process.env.TSCOPIER_ADMIN_USER_IDS
    }
  })
})

/**
 * Outage 2026-11-18 (user d5027e0c): a listener reported `connected` and held
 * its lease while polling nothing at all, so no signal was ever recorded and
 * nothing repaired it — the only self-heal covered the *disconnected* case.
 * These tests pin the second heal: silent-but-connected must be reset.
 */
describe('sessionManager stalled-listener heal', () => {
  const renew = { staleMs: 180_000, perUserTimeoutMs: 1_000 }

  async function withAdminUser(userId: string, fn: () => Promise<void>) {
    process.env.TSCOPIER_ADMIN_USER_IDS = userId
    try {
      await fn()
    } finally {
      delete process.env.TSCOPIER_ADMIN_USER_IDS
    }
  }

  it('hard-resets a connected listener whose poll loop stopped, after the tick threshold', async () => {
    const userId = 'user-stalled-heal'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      const { listener, state } = makeListener({ revoked: false, userId, connected: true, stalled: true })
      internal.listeners.set(userId, listener)

      await internal.renewOneListenerLease(userId, listener, renew)
      assert.equal(state.stopped, 0, 'one stalled tick must not tear the listener down')
      assert.equal(internal.stalledRenewTicks.get(userId), 1)

      await internal.renewOneListenerLease(userId, listener, renew)
      assert.equal(state.stopped, 1, 'the second stalled tick must reset the listener')
      assert.equal(internal.listeners.has(userId), false, 'the reset must drop the Map entry so syncSessions restarts it')
    })
  })

  it('never resets a listener that is paused by a flood wait', async () => {
    const userId = 'user-stalled-backoff'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      const { listener, state } = makeListener({
        revoked: false, userId, connected: true, stalled: true, pollBackoff: true,
      })
      internal.listeners.set(userId, listener)

      for (let i = 0; i < 5; i++) {
        await internal.renewOneListenerLease(userId, listener, renew)
      }

      assert.equal(state.stopped, 0, 'a deliberate Telegram pause must never be reset')
      assert.equal(internal.stalledRenewTicks.has(userId), false, 'the stall counter must stay clear while paused')
    })
  })

  it('clears the stall counter as soon as a poll cycle completes again', async () => {
    const userId = 'user-stalled-recovers'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      const { listener, state } = makeListener({ revoked: false, userId, connected: true, stalled: true })
      internal.listeners.set(userId, listener)

      await internal.renewOneListenerLease(userId, listener, renew)
      assert.equal(internal.stalledRenewTicks.get(userId), 1)

      state.stalled = () => false
      await internal.renewOneListenerLease(userId, listener, renew)

      assert.equal(state.stopped, 0)
      assert.equal(internal.stalledRenewTicks.has(userId), false, 'a recovered tick must wipe the counter')
    })
  })

  it('spends at most two resets per listener per hour', async () => {
    const userId = 'user-stalled-budget'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal

      for (let attempt = 0; attempt < 3; attempt++) {
        const { listener, state } = makeListener({ revoked: false, userId, connected: true, stalled: true })
        internal.listeners.set(userId, listener)
        internal.stalledHealsThisCycle = 0
        await internal.renewOneListenerLease(userId, listener, renew)
        await internal.renewOneListenerLease(userId, listener, renew)
        assert.equal(state.stopped, attempt < 2 ? 1 : 0, `reset attempt ${attempt + 1} must respect the hourly budget`)
      }
    })
  })

  it('does not charge the budget when the reset itself fails, so the next tick retries', async () => {
    const userId = 'user-stalled-stop-fails'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      const failing = makeListener({ revoked: false, userId, connected: true, stalled: true, stopThrows: true })
      internal.listeners.set(userId, failing.listener)
      internal.stalledHealsThisCycle = 0

      await internal.renewOneListenerLease(userId, failing.listener, renew)
      await internal.renewOneListenerLease(userId, failing.listener, renew)

      assert.equal(failing.state.stopped, 1, 'the reset must be attempted')
      assert.equal(internal.stalledHealBudget.has(userId), false, 'a failed reset must not consume the budget')

      const healthyStop = makeListener({ revoked: false, userId, connected: true, stalled: true })
      internal.listeners.set(userId, healthyStop.listener)
      internal.stalledHealsThisCycle = 0
      await internal.renewOneListenerLease(userId, healthyStop.listener, renew)
      await internal.renewOneListenerLease(userId, healthyStop.listener, renew)

      assert.equal(healthyStop.state.stopped, 1, 'the retry after a failed stop must still be allowed')
      assert.equal(internal.stalledHealBudget.get(userId)?.count, 1, 'the successful reset is what gets charged')
    })
  })

  it('releases the budget once the one-hour window has passed', async () => {
    const userId = 'user-stalled-window'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      internal.stalledHealBudget.set(userId, { count: 99, windowStartMs: Date.now() - 61 * 60_000 })

      const { listener, state } = makeListener({ revoked: false, userId, connected: true, stalled: true })
      internal.listeners.set(userId, listener)
      internal.stalledHealsThisCycle = 0
      await internal.renewOneListenerLease(userId, listener, renew)
      await internal.renewOneListenerLease(userId, listener, renew)

      assert.equal(state.stopped, 1, 'an expired window must allow healing again')
      assert.equal(internal.stalledHealBudget.get(userId)?.count, 1, 'the window restarts at the first new reset')
    })
  })

  it('heals at most two listeners per renew cycle so a platform-wide stall cannot herd reconnects', async () => {
    await withAdminUser('user-a,user-b,user-c', async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      const stopped: string[] = []
      internal.stalledHealsThisCycle = 0

      for (const userId of ['user-a', 'user-b', 'user-c']) {
        const { listener } = makeListener({ revoked: false, userId, connected: true, stalled: true })
        const original = listener.stop.bind(listener)
        ;(listener as unknown as { stop: () => Promise<void> }).stop = async () => {
          await original()
          stopped.push(userId)
        }
        internal.listeners.set(userId, listener)
        await internal.renewOneListenerLease(userId, listener, renew)
        await internal.renewOneListenerLease(userId, listener, renew)
      }

      assert.deepEqual(stopped, ['user-a', 'user-b'], 'the third listener must wait for the next cycle')
    })
  })

  it('records a refused heal so an unhealed deaf listener is visible to ops', async () => {
    const userId = 'user-stalled-budget-spent'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      internal.stalledHealBudget.set(userId, { count: 2, windowStartMs: Date.now() })
      const { listener, state } = makeListener({ revoked: false, userId, connected: true, stalled: true })
      internal.listeners.set(userId, listener)
      internal.stalledHealsThisCycle = 0

      await internal.renewOneListenerLease(userId, listener, renew)
      await internal.renewOneListenerLease(userId, listener, renew)

      assert.equal(state.stopped, 0, 'a spent budget must not reset the listener')
      const eventWrite = supabase.calls.find(c => c.table === 'listener_events' && c.op === 'insert')
      assert.ok(eventWrite, 'the refused heal must be persisted, not only logged')
    })
  })

  it('does not charge the budget when the listener is no longer tracked', async () => {
    const userId = 'user-stalled-untracked'
    await withAdminUser(userId, async () => {
      const supabase = makeSupabase()
      const internal = new UserSessionManager(supabase as unknown as SupabaseClient) as unknown as Internal
      const { listener } = makeListener({ revoked: false, userId, connected: true, stalled: true })
      // Deliberately not added to internal.listeners: another path removed it
      // between the renew cycle's snapshot and this call.
      internal.stalledHealsThisCycle = 0

      await internal.renewOneListenerLease(userId, listener, renew)
      await internal.renewOneListenerLease(userId, listener, renew)

      assert.equal(
        internal.stalledHealBudget.has(userId),
        false,
        'a reset that stopped nothing must not consume the hourly budget',
      )
    })
  })
})

/**
 * The stall trigger must read poll progress, never the watchdog's timestamp:
 * the watchdog refreshes that timestamp every 30 s, so a listener whose socket
 * answers probes while its poll loops are wedged still looks healthy there —
 * the exact blind spot behind the 2026-11-18 outage.
 */
describe('UserListener.isPollLoopStalled', () => {
  // A view of the private fields the predicate reads. Casting through this
  // shape (not through `UserListener`) keeps the private members out of an
  // intersection, which TypeScript collapses to `never`.
  type StallView = {
    isConnected: boolean
    lastSuccessfulPollAt: number
    lastPollCycleCompletedAt: number
    isPollLoopStalled(staleMs: number): boolean
  }

  function makeRawListener(): StallView {
    const client = {} as never
    const supabase = makeSupabase() as unknown as SupabaseClient
    return new UserListener('stall-user', 'session', supabase, client) as unknown as StallView
  }

  it('is stalled when probes are fresh but no poll cycle has completed', () => {
    const listener = makeRawListener()
    listener.isConnected = true
    listener.lastSuccessfulPollAt = Date.now()          // watchdog just probed fine
    listener.lastPollCycleCompletedAt = Date.now() - 10 * 60_000 // polls stopped 10 minutes ago
    assert.equal(listener.isPollLoopStalled(180_000), true)
  })

  it('is not stalled once a poll cycle completes again', () => {
    const listener = makeRawListener()
    listener.isConnected = true
    listener.lastPollCycleCompletedAt = Date.now()
    assert.equal(listener.isPollLoopStalled(180_000), false)
  })

  it('is not stalled before the first cycle has ever run', () => {
    const listener = makeRawListener()
    listener.isConnected = true
    listener.lastPollCycleCompletedAt = 0
    assert.equal(listener.isPollLoopStalled(180_000), false)
  })

  it('leaves the disconnected case to the existing disconnected heal', () => {
    const listener = makeRawListener()
    listener.isConnected = false
    listener.lastPollCycleCompletedAt = Date.now() - 10 * 60_000
    assert.equal(listener.isPollLoopStalled(180_000), false)
  })
})
