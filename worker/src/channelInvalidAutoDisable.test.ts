import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UserListener } from './userListener'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

type ChannelRow = {
  id: string
  channel_id: string
  channel_username: string
  signal_channel_id?: string | null
  last_seen_message_id?: number | string | null
  last_seen_at?: string | null
  last_live_at?: string | null
}

function row(id: string, overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id,
    channel_id: `-100${id.replace(/\D/g, '') || '1'}`,
    channel_username: `channel_${id.replace(/\W/g, '')}`,
    signal_channel_id: `signal-${id}`,
    last_seen_message_id: 1,
    ...overrides,
  }
}

function makeSupabase(rows: ChannelRow[], opts: { updateError?: Error } = {}) {
  const updates: Array<{ table: string; value: Record<string, unknown>; filters: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = []
  const channelsRemoved: unknown[] = []

  const builder = (table: string) => {
    const state: {
      op?: 'select' | 'update' | 'insert'
      updateValue?: Record<string, unknown>
      filters: Record<string, unknown>
      selectValue?: string
    } = { filters: {} }
    const b: Record<string, unknown> = {
      select: (value?: string) => {
        state.op = 'select'
        state.selectValue = value
        return b
      },
      update: (value: Record<string, unknown>) => {
        state.op = 'update'
        state.updateValue = value
        return b
      },
      insert: (value: Record<string, unknown>) => {
        inserts.push({ table, value })
        return Promise.resolve({ data: null, error: null })
      },
      eq: (field: string, value: unknown) => {
        state.filters[field] = value
        return b
      },
      or: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: { data: unknown; error: Error | null }) => void) => {
        if (state.op === 'update') {
          updates.push({ table, value: state.updateValue ?? {}, filters: state.filters })
          if (table === 'telegram_channels' && state.filters.id) {
            const target = rows.find(r => r.id === state.filters.id)
            if (target && !opts.updateError) Object.assign(target, state.updateValue)
          }
          resolve({ data: null, error: opts.updateError ?? null })
          return
        }
        let data: unknown = null
        if (table === 'telegram_channels') {
          data = rows.filter(r => {
            if (state.filters.is_active === true && (r as { is_active?: boolean }).is_active === false) return false
            if (state.filters.id && r.id !== state.filters.id) return false
            return true
          })
        }
        resolve({ data, error: null })
      },
    }
    return b
  }

  return {
    updates,
    inserts,
    channelsRemoved,
    from: builder,
    removeChannel: async (ch: unknown) => { channelsRemoved.push(ch) },
  }
}

function makeListener(
  rows: ChannelRow[],
  clientOverrides: Partial<{
    getInputEntity: (key: unknown) => Promise<unknown>
    getMessages: (peer: unknown, opts: unknown) => Promise<unknown[]>
    getDialogs: () => Promise<unknown[]>
  }> = {},
  supabaseOpts: { updateError?: Error } = {},
) {
  const supabase = makeSupabase(rows, supabaseOpts)
  const client = {
    connected: true,
    onError: undefined as undefined | ((err: Error) => Promise<void>),
    connect: async () => {},
    disconnect: async () => {},
    addEventHandler: () => {},
    removeEventHandler: () => {},
    getInputEntity: clientOverrides.getInputEntity ?? (async (key: unknown) => ({ key })),
    getDialogs: clientOverrides.getDialogs ?? (async () => []),
    getMessages: clientOverrides.getMessages ?? (async () => []),
    session: { save: () => 'saved-session' },
  }
  const listener = new UserListener('user-a', 'saved-session', supabase as never, client as never)
  const anyListener = listener as unknown as {
    isConnected: boolean
    monitoredChannels: Set<string>
    channelInvalidFailures: Map<string, { consecutiveCount: number }>
    autoDisabledChannelRows: Set<string>
    channelResolveCooldownUntil: Map<string, { until: number; lastError?: Error }>
    pollBackoffUntil: number
    floodBackoffMs: number
    consecutiveCleanCycles: number
    pollChannelNewMessages: (r: ChannelRow) => Promise<void>
    pollMonitoredChannelsForMessages: () => Promise<void>
    runFastPoll: () => Promise<void>
    resetChannelInvalidFailure: (r: ChannelRow, source: string) => boolean
    resolveChannelPeer: (r: ChannelRow) => Promise<unknown>
    ensureJoinedPublicChannel: (r: ChannelRow) => Promise<void>
    runSignalTelegramReconcile: () => Promise<unknown>
  }
  anyListener.isConnected = true
  anyListener.runSignalTelegramReconcile = async () => ({ checked: 0, mismatches: 0, revised: 0, errors: 0 })
  return { listener, anyListener, supabase, client }
}

describe('UserListener channel invalid auto-disable', () => {
  it('increments one CHANNEL_INVALID without disabling the channel', async () => {
    const channels = [row('row-1')]
    const { anyListener, supabase } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('CHANNEL_INVALID') },
    })

    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(anyListener.channelInvalidFailures.get('row-1')?.consecutiveCount, 1)
    assert.equal(supabase.updates.some(u => u.table === 'telegram_channels' && u.value.is_active === false), false)
  })

  it('resets CHANNEL_INVALID state after a successful poll', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('CHANNEL_INVALID') },
    })
    await anyListener.pollChannelNewMessages(channels[0]!)

    const ok = makeListener(channels)
    ok.anyListener.channelInvalidFailures = anyListener.channelInvalidFailures
    await ok.anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(ok.anyListener.channelInvalidFailures.has('row-1'), false)
  })

  it('disables the fifth consecutive confirmed CHANNEL_INVALID and removes monitoring', async () => {
    const channels = [row('row-1')]
    const { anyListener, supabase } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('CHANNEL_INVALID') },
    })
    anyListener.monitoredChannels.add('-1001')
    anyListener.monitoredChannels.add('channel_row1')

    for (let i = 0; i < 5; i += 1) await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(supabase.updates.some(u => u.table === 'telegram_channels' && u.value.is_active === false), true)
    assert.equal(anyListener.monitoredChannels.has('-1001'), false)
    assert.equal(anyListener.monitoredChannels.has('channel_row1'), false)
    assert.equal(anyListener.autoDisabledChannelRows.has('row-1'), true)
  })

  it('does not poll again after local auto-disable', async () => {
    const channels = [row('row-1')]
    let calls = 0
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => {
        calls += 1
        throw new Error('CHANNEL_INVALID')
      },
    })

    for (let i = 0; i < 6; i += 1) await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(calls, 1)
  })

  it('reactivation clears local failure state', () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels)
    anyListener.channelInvalidFailures.set('row-1', { consecutiveCount: 4 })
    anyListener.autoDisabledChannelRows.add('row-1')

    const changed = anyListener.resetChannelInvalidFailure(channels[0]!, 'channel_config_changed')

    assert.equal(changed, true)
    assert.equal(anyListener.channelInvalidFailures.has('row-1'), false)
    assert.equal(anyListener.autoDisabledChannelRows.has('row-1'), false)
  })

  it('does not count transient timeout errors as CHANNEL_INVALID', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('TIMEOUT') },
    })

    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(anyListener.channelInvalidFailures.has('row-1'), false)
  })

  it('arms a session-wide poll backoff on getMessages retry exhaustion', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getMessages: async () => { throw new Error('Request was unsuccessful 5 time(s)') },
    })

    anyListener.pollBackoffUntil = 0
    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.ok(anyListener.pollBackoffUntil > Date.now())
  })

  it('skips fast polls while in flood-wait backoff and resumes after', async () => {
    const channels = [row('row-1')]
    let polled = false
    const { anyListener } = makeListener(channels, {
      getMessages: async () => {
        polled = true
        return []
      },
    })

    anyListener.pollBackoffUntil = Date.now() + 60_000
    await anyListener.runFastPoll()

    assert.equal(polled, false)

    anyListener.pollBackoffUntil = 0
    await anyListener.runFastPoll()

    assert.equal(polled, true)
  })

  it('keeps backoff armed across a cycle that still saw flood errors', async () => {
    const channels = [row('row-1'), row('row-2')]
    const { anyListener } = makeListener(channels, {
      getMessages: async (peer: unknown) => {
        const key = String((peer as { key?: string } | null)?.key ?? '')
        if (key.includes('row1')) throw new Error('Request was unsuccessful 5 time(s)')
        return []
      },
    })

    // row-1 floods and arms backoff; row-2 succeeds — cycle must NOT clear it.
    await anyListener.pollChannelNewMessages(channels[0]!)
    await anyListener.pollChannelNewMessages(channels[1]!)
    await anyListener.runFastPoll()

    assert.ok(anyListener.pollBackoffUntil > Date.now())
  })

  it('keeps backoff armed after a single clean cycle (requires consecutive calm)', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getMessages: async () => [],
    })

    // Expired-but-armed backoff; one clean cycle must NOT clear it yet.
    anyListener.pollBackoffUntil = Date.now() - 1
    await anyListener.runFastPoll()

    assert.ok(anyListener.pollBackoffUntil > 0, 'backoff not cleared after one clean cycle')
    assert.equal(anyListener.consecutiveCleanCycles, 1)
  })

  it('clears backoff only after several consecutive flood-free cycles', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getMessages: async () => [],
    })

    anyListener.pollBackoffUntil = Date.now() - 1
    anyListener.floodBackoffMs = 4 * 60_000

    for (let i = 0; i < 3; i += 1) await anyListener.runFastPoll()

    assert.equal(anyListener.pollBackoffUntil, 0)
    // The adaptive window resets to base after sustained calm.
    assert.equal(anyListener.floodBackoffMs, 2 * 60_000)
  })

  it('escalates the backoff window when a flood recurs after the pause expires', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getMessages: async () => { throw new Error('Request was unsuccessful 5 time(s)') },
    })

    // First flood arms base backoff.
    await anyListener.pollChannelNewMessages(channels[0]!)
    const first = anyListener.floodBackoffMs
    assert.equal(first, 2 * 60_000)
    assert.ok(anyListener.pollBackoffUntil > Date.now())

    // Let the pause expire, then a new flood escalates to double.
    anyListener.pollBackoffUntil = Date.now() - 1
    await anyListener.pollChannelNewMessages(channels[0]!)
    assert.equal(anyListener.floodBackoffMs, 4 * 60_000)
    assert.ok(anyListener.pollBackoffUntil > Date.now())

    // A flood while still paused does NOT escalate.
    anyListener.floodBackoffMs = first
    await anyListener.pollChannelNewMessages(channels[0]!)
    assert.equal(anyListener.floodBackoffMs, first)
  })

  it('arms session backoff when channel peer resolution is throttled', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('Request was unsuccessful 5 time(s)') },
    })

    anyListener.pollBackoffUntil = 0
    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.ok(anyListener.pollBackoffUntil > Date.now())
  })

  it('does not cache flood errors in the resolve cooldown', async () => {
    const channels = [row('row-1')]
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('RPC_CALL_FAIL') },
      getDialogs: async () => { throw new Error('Request was unsuccessful 5 time(s)') },
    })

    anyListener.pollBackoffUntil = 0
    await anyListener.pollChannelNewMessages(channels[0]!).catch(() => {})

    // Flood errors are transient (handled by the session backoff) — they must
    // NOT be cached in the 10-min resolve cooldown, or a stale cached flood
    // would keep re-arming the session backoff via throwChannelResolveCooldown.
    assert.equal(anyListener.channelResolveCooldownUntil.has('row-1'), false)
    assert.ok(anyListener.pollBackoffUntil > Date.now())
  })

  it('treats stale public usernames as confirmed invalid failures', async () => {
    const channels = [row('row-1', { channel_username: 'renamed_old_channel' })]
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('USERNAME_NOT_OCCUPIED') },
    })

    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(anyListener.channelInvalidFailures.get('row-1')?.consecutiveCount, 1)
  })

  it('treats gramjs "No user has X as username" rewrite as confirmed invalid', async () => {
    const channels = [row('row-1', { channel_username: 'renamed_old_channel' })]
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('No user has "renamed_old_channel" as username') },
    })

    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(anyListener.channelInvalidFailures.get('row-1')?.consecutiveCount, 1)
  })

  it('skips all resolve RPCs while a channel resolve is cooling down', async () => {
    const channels = [row('row-1', { channel_username: 'renamed_old_channel' })]
    let entityCalls = 0
    let dialogCalls = 0
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => {
        entityCalls += 1
        throw new Error('No user has "renamed_old_channel" as username')
      },
      getDialogs: async () => {
        dialogCalls += 1
        return []
      },
    })

    anyListener.channelResolveCooldownUntil.set('row-1', { until: Date.now() + 60_000 })

    await anyListener.resolveChannelPeer(channels[0]!).catch(() => {})
    await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(dialogCalls, 0)
    assert.equal(entityCalls, 0)
  })

  it('backs off join attempts for a channel in resolve cooldown', async () => {
    const channels = [row('row-1', { channel_username: 'renamed_old_channel' })]
    let entityCalls = 0
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => {
        entityCalls += 1
        return { id: 'some-entity' }
      },
    })

    anyListener.channelResolveCooldownUntil.set('row-1', { until: Date.now() + 60_000 })
    await anyListener.ensureJoinedPublicChannel(channels[0]!)

    assert.equal(entityCalls, 0)
  })

  it('clears resolve cooldown after a successful poll', async () => {
    const channels = [row('row-1', { channel_username: 'renamed_old_channel' })]
    let failFirst = true
    const { anyListener } = makeListener(channels, {
      getInputEntity: async () => {
        if (failFirst) {
          throw new Error('No user has "renamed_old_channel" as username')
        }
        return { key: 'resolved' }
      },
      getDialogs: async () => [],
    })

    await anyListener.pollChannelNewMessages(channels[0]!).catch(() => {})
    assert.equal(anyListener.channelResolveCooldownUntil.has('row-1'), true)

    // Within the cooldown window the stored confirmed-invalid error is
    // rethrown — getInputEntity is never called — so the cooldown persists.
    await anyListener.pollChannelNewMessages(channels[0]!).catch(() => {})
    assert.equal(anyListener.channelResolveCooldownUntil.has('row-1'), true)

    // After the window expires, a successful resolve clears the cooldown.
    anyListener.channelResolveCooldownUntil.set('row-1', { until: Date.now() - 1 })
    failFirst = false
    await anyListener.pollChannelNewMessages(channels[0]!)
    assert.equal(anyListener.channelResolveCooldownUntil.has('row-1'), false)
  })

  it('continues polling healthy channels while one channel is invalid', async () => {
    const channels = [row('row-1'), row('row-2')]
    let healthyPolled = false
    let releaseInvalid!: () => void
    const invalidStarted = new Promise<void>(resolve => {
      releaseInvalid = resolve
    })
    const { anyListener } = makeListener(channels, {
      getInputEntity: async (key: unknown) => {
        if (String(key).includes('row1')) {
          await invalidStarted
          throw new Error('CHANNEL_INVALID')
        }
        return { key }
      },
      getMessages: async () => {
        healthyPolled = true
        return []
      },
    })

    const poll = anyListener.pollMonitoredChannelsForMessages()
    await delay(10)
    assert.equal(healthyPolled, true)
    releaseInvalid()
    await poll
  })

  it('database failure during disable still blocks local retry loop', async () => {
    const channels = [row('row-1')]
    let calls = 0
    const { anyListener } = makeListener(
      channels,
      {
        getInputEntity: async () => {
          calls += 1
          throw new Error('CHANNEL_INVALID')
        },
      },
      { updateError: new Error('db unavailable') },
    )

    for (let i = 0; i < 6; i += 1) await anyListener.pollChannelNewMessages(channels[0]!)

    assert.equal(calls, 1)
    assert.equal(anyListener.autoDisabledChannelRows.has('row-1'), true)
  })

  it('stores a safe user-facing auto-disable message without credentials', async () => {
    const channels = [row('row-1')]
    const { anyListener, supabase } = makeListener(channels, {
      getInputEntity: async () => { throw new Error('CHANNEL_INVALID auth_key=abc session=secret-session') },
    })

    for (let i = 0; i < 5; i += 1) await anyListener.pollChannelNewMessages(channels[0]!)
    await delay(0)

    const disabledEvent = supabase.inserts.find(e =>
      e.table === 'listener_events'
      && e.value.event_type === 'channel_auto_disabled',
    )
    assert.equal((disabledEvent?.value.detail as { message?: string } | undefined)?.message,
      'Channel unavailable or access was removed. Reconnect or update the channel.')
    assert.equal(JSON.stringify(disabledEvent).includes('secret-session'), false)
    assert.equal(JSON.stringify(disabledEvent).includes('auth_key=abc'), false)
  })
})
