import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UserSessionManager } from './sessionManager'
import { UserListener } from './userListener'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function makeSupabase() {
  const calls: Array<{ table: string; op: string; field?: string; value?: unknown }> = []
  const channelsRemoved: unknown[] = []
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      delete: () => {
        calls.push({ table, op: 'delete' })
        return b
      },
      update: (value: unknown) => {
        calls.push({ table, op: 'update', value })
        return b
      },
      eq: (field: string, value: unknown) => {
        calls.push({ table, op: 'eq', field, value })
        return b
      },
      in: (field: string, value: unknown) => {
        calls.push({ table, op: 'in', field, value })
        return b
      },
      gt: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    }
    return b
  }
  return {
    calls,
    channelsRemoved,
    from: builder,
    removeChannel: async (ch: unknown) => { channelsRemoved.push(ch) },
  }
}

describe('UserSessionManager shutdown', () => {
  it('waits for all Telegram listeners to disconnect and clears ownership', async () => {
    const supabase = makeSupabase()
    const manager = new UserSessionManager(supabase as never)
    const stopped: string[] = []
    const listeners = new Map<string, unknown>([
      ['user-a', { stop: async () => { await delay(25); stopped.push('user-a') } }],
      ['user-b', { stop: async () => { await delay(5); stopped.push('user-b') } }],
    ])
    ;(manager as unknown as { listeners: Map<string, unknown> }).listeners = listeners

    await manager.disconnectAll()

    assert.deepEqual(stopped.sort(), ['user-a', 'user-b'])
    assert.equal((manager as unknown as { listeners: Map<string, unknown> }).listeners.size, 0)
  })

  it('releases every matching and orphaned owned lease during shutdown', async () => {
    const supabase = makeSupabase()
    const manager = new UserSessionManager(supabase as never)
    ;(manager as unknown as { listeners: Map<string, unknown> }).listeners = new Map([
      ['user-a', { stop: async () => {} }],
      ['user-b', { stop: async () => {} }],
    ])

    await manager.disconnectAll()

    const leaseDeletes = supabase.calls.filter(c => c.table === 'worker_session_leases' && c.op === 'delete')
    assert.equal(leaseDeletes.length >= 3, true)
    assert.equal(
      supabase.calls.some(c => c.table === 'worker_session_leases' && c.op === 'eq' && c.field === 'user_id' && c.value === 'user-a'),
      true,
    )
    assert.equal(
      supabase.calls.some(c => c.table === 'worker_session_leases' && c.op === 'eq' && c.field === 'user_id' && c.value === 'user-b'),
      true,
    )
    assert.equal(
      supabase.calls.some(c => c.table === 'worker_session_leases' && c.op === 'eq' && c.field === 'worker_id'),
      true,
    )
  })
})

describe('UserListener AUTH_KEY_DUPLICATED lifecycle', () => {
  function makeListener(connect: () => Promise<void>, exhausted?: (userId: string, reason: string) => void) {
    const supabase = makeSupabase()
    const events: string[] = []
    const client = {
      connected: true,
      onError: undefined as undefined | ((err: Error) => Promise<void>),
      connect: async () => {
        events.push('connect')
        await connect()
      },
      disconnect: async () => { events.push('disconnect') },
      session: { save: () => 'changed-session' },
    }
    const listener = new UserListener('user-a', 'saved-session', supabase as never, client as never, exhausted)
    const anyListener = listener as unknown as {
      isConnected: boolean
      requestReconnect: (reason: string) => Promise<void>
      stop: () => Promise<void>
      warmEntityCache: () => Promise<void>
      refreshChannelSubscription: () => Promise<void>
      runReplyChainSweep: () => Promise<void>
      runRecentCatchUp: () => Promise<void>
    }
    anyListener.isConnected = true
    anyListener.warmEntityCache = async () => {}
    anyListener.refreshChannelSubscription = async () => {}
    anyListener.runReplyChainSweep = async () => {}
    anyListener.runRecentCatchUp = async () => {}
    return { listener, anyListener, client, events }
  }

  it('repeated force reconnect calls cannot create overlapping clients', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = '1'
    let connectCalls = 0
    try {
      const { anyListener } = makeListener(async () => {
        connectCalls += 1
        await delay(20)
      })
      const a = anyListener.requestReconnect('test')
      const b = anyListener.requestReconnect('test')
      await Promise.all([a, b])
      assert.equal(connectCalls, 1)
      await anyListener.stop()
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
      else process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = prevMax
    }
  })

  it('shutdown while reconnecting does not start another client', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = '1'
    let connectCalls = 0
    try {
      const { anyListener } = makeListener(async () => { connectCalls += 1 })
      const reconnect = anyListener.requestReconnect('test')
      await anyListener.stop()
      await reconnect
      assert.equal(connectCalls, 0)
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
      else process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = prevMax
    }
  })

  it('successful recovery before the maximum keeps the session active', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = '1'
    try {
      const { listener, anyListener } = makeListener(async () => {})
      await anyListener.requestReconnect('test')
      assert.equal(listener.isTelegramConnected(), true)
      await anyListener.stop()
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
      else process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = prevMax
    }
  })

  it('maximum AUTH_KEY_DUPLICATED retries invalidate and stop retrying', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = '1'
    let connectCalls = 0
    const exhausted: Array<{ userId: string; reason: string }> = []
    try {
      const { listener, anyListener } = makeListener(async () => {
        connectCalls += 1
        throw new Error('AUTH_KEY_DUPLICATED')
      }, (userId, reason) => exhausted.push({ userId, reason }))

      await anyListener.requestReconnect('auth_key_duplicated:test')
      await delay(10)

      assert.equal(connectCalls, 1)
      assert.equal(listener.isTelegramConnected(), false)
      assert.deepEqual(exhausted, [{ userId: 'user-a', reason: 'auth_key_duplicated:test' }])
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS
      else process.env.TELEGRAM_AUTH_DUP_MAX_RECOVERY_ATTEMPTS = prevMax
    }
  })

  it('malformed RPC result triggers reconnect after closing the current client', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES = '10'
    try {
      let connectCalls = 0
      const { listener, anyListener, client, events } = makeListener(async () => { connectCalls += 1 })

      await client.onError?.(Object.assign(new Error('GRAMJS_MALFORMED_RPC_RESULT: invalid RPC result body'), {
        code: 'GRAMJS_MALFORMED_RPC_RESULT',
      }))

      assert.equal(connectCalls, 1)
      assert.deepEqual(events.slice(0, 2), ['disconnect', 'connect'])
      assert.equal(listener.isTelegramConnected(), true)
      await anyListener.stop()
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES
      else process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES = prevMax
    }
  })

  it('concurrent malformed RPC errors do not create duplicate Telegram clients', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES = '10'
    try {
      let connectCalls = 0
      const { anyListener, client } = makeListener(async () => {
        connectCalls += 1
        await delay(20)
      })
      const err = Object.assign(new Error('GRAMJS_MALFORMED_RPC_RESULT: invalid RPC result body'), {
        code: 'GRAMJS_MALFORMED_RPC_RESULT',
      })

      await Promise.all([client.onError?.(err), client.onError?.(err)])

      assert.equal(connectCalls, 1)
      await anyListener.stop()
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES
      else process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES = prevMax
    }
  })

  it('repeated malformed RPC responses use bounded recovery', async () => {
    const prevCooldown = process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
    const prevMax = process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES
    process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = '500'
    process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES = '1'
    const exhausted: Array<{ userId: string; reason: string }> = []
    try {
      let connectCalls = 0
      const { listener, client } = makeListener(
        async () => { connectCalls += 1 },
        (userId, reason) => exhausted.push({ userId, reason }),
      )
      const err = Object.assign(new Error('GRAMJS_MALFORMED_RPC_RESULT: invalid RPC result body'), {
        code: 'GRAMJS_MALFORMED_RPC_RESULT',
      })

      await client.onError?.(err)
      await client.onError?.(err)
      await delay(10)

      assert.equal(connectCalls, 1)
      assert.equal(listener.isTelegramConnected(), false)
      assert.deepEqual(exhausted, [{ userId: 'user-a', reason: 'malformed_rpc_result' }])
    } finally {
      if (prevCooldown == null) delete process.env.TELEGRAM_RECONNECT_COOLDOWN_MS
      else process.env.TELEGRAM_RECONNECT_COOLDOWN_MS = prevCooldown
      if (prevMax == null) delete process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES
      else process.env.TELEGRAM_MALFORMED_RPC_MAX_RECOVERIES = prevMax
    }
  })
})
