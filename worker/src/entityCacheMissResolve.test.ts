import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UserListener } from './userListener'

/**
 * The escalation lives in UserListener.setEntityCacheMissCooldown: it reads the
 * previous attempt count off the cooldown entry it rewrites. These tests drive
 * resolveChannelPeer itself so the wiring (not just the delay table) is covered.
 */
const ENTITY_MISS = new Error(
  'Could not find the input entity for {"channelId":"3546335047","className":"PeerChannel"}.',
)

type CooldownEntry = { until: number; lastError?: Error; resolveAttempts?: number }

function makeListener(supabase: unknown = {}) {
  let getInputEntityCalls = 0
  let resolveSucceeds = false
  const client = {
    connected: true,
    connect: async () => {},
    disconnect: async () => {},
    addEventHandler: () => {},
    removeEventHandler: () => {},
    getInputEntity: async () => {
      getInputEntityCalls += 1
      if (resolveSucceeds) return { peer: 'resolved' }
      throw ENTITY_MISS
    },
    getDialogs: async () => [],
    session: { save: () => 'saved-session' },
  }
  const listener = new UserListener('user-a', 'saved-session', supabase as never, client as never)
  const anyListener = listener as unknown as {
    channelResolveCooldownUntil: Map<string, CooldownEntry>
    resolveChannelPeer: (row: ChannelRow) => Promise<unknown>
    resetChannelInvalidFailure: (row: ChannelRow, source: string) => boolean
    onChannelsChanged: () => Promise<void>
  }
  return {
    anyListener,
    getInputEntityCalls: () => getInputEntityCalls,
    setResolveSucceeds: (value: boolean) => { resolveSucceeds = value },
  }
}

/**
 * Minimal Supabase stub for onChannelsChanged: every `telegram_channels` select
 * returns the supplied rows, every other table returns nothing, and writes are
 * no-ops. Enough to exercise the channel-subscription path without a database.
 */
function makeChannelSupabase(rows: ChannelRow[]) {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = chain
    builder.eq = chain
    builder.neq = chain
    builder.not = chain
    builder.in = chain
    builder.or = chain
    builder.filter = chain
    builder.insert = () => Promise.resolve({ data: null, error: null })
    builder.update = () => Promise.resolve({ data: null, error: null })
    builder.upsert = () => Promise.resolve({ data: null, error: null })
    builder.delete = () => Promise.resolve({ data: null, error: null })
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
    builder.single = () => Promise.resolve({ data: null, error: null })
    builder.limit = chain
    builder.order = chain
    builder.then = (
      resolve: (value: { data: unknown; error: null }) => void,
      reject?: (reason: unknown) => void,
    ) => {
      try {
        resolve({ data: table === 'telegram_channels' ? rows : [], error: null })
      } catch (err) {
        reject?.(err)
      }
    }
    return builder
  }
  return { from }
}

type ChannelRow = {
  id: string
  channel_id: string
  channel_username: string
  signal_channel_id?: string | null
}

const channelRow: ChannelRow = {
  id: 'row-1',
  channel_id: '-1003546335047',
  channel_username: '',
}

/** Make an armed cooldown expire so the next resolve actually reaches Telegram. */
function expireCooldown(anyListener: ReturnType<typeof makeListener>['anyListener']): void {
  const entry = anyListener.channelResolveCooldownUntil.get(channelRow.id)
  if (entry) entry.until = Date.now() - 1
}

async function failResolve(
  anyListener: ReturnType<typeof makeListener>['anyListener'],
): Promise<void> {
  await assert.rejects(
    () => anyListener.resolveChannelPeer(channelRow),
    /Could not find the input entity/,
  )
}

describe('resolveChannelPeer entity cache miss escalation', () => {
  it('escalates the retry delay across consecutive misses', async () => {
    const { anyListener } = makeListener()

    const expected = [0, 5_000, 15_000, 60_000, 300_000]
    for (const [index, delay] of expected.entries()) {
      expireCooldown(anyListener)
      await failResolve(anyListener)

      const entry = anyListener.channelResolveCooldownUntil.get(channelRow.id)
      assert.ok(entry, 'a cooldown entry must be armed after a miss')
      assert.equal(entry.resolveAttempts, index + 1, 'attempt count must increment')

      const remaining = entry.until - Date.now()
      // Allow a little slack for the time the call itself took.
      assert.ok(
        remaining <= delay + 1_000,
        `attempt ${index + 1}: expected ~${delay}ms, got ${remaining}ms`,
      )
      assert.ok(remaining >= delay - 1_000, `attempt ${index + 1}: delay must not undershoot`)
    }
  })

  it('stops calling Telegram while the cooldown is still active', async () => {
    const { anyListener, getInputEntityCalls } = makeListener()

    await failResolve(anyListener)
    const callsAfterFirstFailure = getInputEntityCalls()
    assert.ok(callsAfterFirstFailure > 0, 'the first miss must reach Telegram')

    // Stretch the armed window to emulate a later escalation step; the first
    // step is 0ms, so without this the next call would legitimately retry.
    const entry = anyListener.channelResolveCooldownUntil.get(channelRow.id)
    assert.ok(entry)
    entry.until = Date.now() + 60_000

    // These must be served from the cached error — no RPC, which is the whole
    // point of escalating instead of retrying on every poll tick.
    await failResolve(anyListener)
    await failResolve(anyListener)
    assert.equal(getInputEntityCalls(), callsAfterFirstFailure)
  })

  it('keeps escalating up to the cap rather than growing without bound', async () => {
    const { anyListener } = makeListener()

    for (let i = 0; i < 8; i++) {
      expireCooldown(anyListener)
      await failResolve(anyListener)
    }

    const entry = anyListener.channelResolveCooldownUntil.get(channelRow.id)
    assert.ok(entry)
    assert.equal(entry.resolveAttempts, 8)
    const remaining = entry.until - Date.now()
    assert.ok(remaining <= 300_000 + 1_000, `delay must be capped, got ${remaining}ms`)
    assert.ok(remaining >= 299_000, `cap should be the final 300s step, got ${remaining}ms`)
  })

  it('forgets the escalation when the channel state is reset', async () => {
    const { anyListener } = makeListener()

    for (let i = 0; i < 3; i++) {
      expireCooldown(anyListener)
      await failResolve(anyListener)
    }
    assert.equal(
      anyListener.channelResolveCooldownUntil.get(channelRow.id)?.resolveAttempts,
      3,
      'escalation must be armed before the reset',
    )

    // Re-enabling a channel (or a successful poll) must clear it so the next
    // attempt is immediate instead of waiting out a stale escalation.
    anyListener.resetChannelInvalidFailure(channelRow, 'channel_config_changed')
    assert.equal(
      anyListener.channelResolveCooldownUntil.has(channelRow.id),
      false,
      'reset must clear the resolve cooldown even though the channel was never classified invalid',
    )
  })

  it('starts over after a successful resolve', async () => {
    const { anyListener, setResolveSucceeds } = makeListener()

    for (let i = 0; i < 4; i++) {
      expireCooldown(anyListener)
      await failResolve(anyListener)
    }
    assert.equal(anyListener.channelResolveCooldownUntil.get(channelRow.id)?.resolveAttempts, 4)

    // A real success deletes the whole entry, taking the counter with it.
    setResolveSucceeds(true)
    expireCooldown(anyListener)
    await anyListener.resolveChannelPeer(channelRow)
    assert.equal(
      anyListener.channelResolveCooldownUntil.has(channelRow.id),
      false,
      'a successful resolve must drop the cooldown entry',
    )

    // The next miss therefore starts the escalation from scratch.
    setResolveSucceeds(false)
    expireCooldown(anyListener)
    await failResolve(anyListener)
    assert.equal(
      anyListener.channelResolveCooldownUntil.get(channelRow.id)?.resolveAttempts,
      1,
      'a recovered channel must restart at the immediate retry',
    )
  })

  it('clears the escalation when a channel becomes newly monitored', async () => {
    const rows: ChannelRow[] = [
      { id: 'row-1', channel_id: '-1003546335047', channel_username: '', signal_channel_id: null },
    ]
    const { anyListener, getInputEntityCalls } = makeListener(makeChannelSupabase(rows))

    // Arm a real escalation, then stretch the window far enough that nothing
    // inside onChannelsChanged could expire it on its own.
    for (let i = 0; i < 3; i++) {
      expireCooldown(anyListener)
      await failResolve(anyListener)
    }
    const entry = anyListener.channelResolveCooldownUntil.get('row-1')
    assert.equal(entry?.resolveAttempts, 3, 'escalation must be armed before the channel is re-discovered')
    entry!.until = Date.now() + 600_000

    const callsBefore = getInputEntityCalls()

    // monitoredChannels starts empty, so this row counts as newly added — the
    // same path a re-enabled channel takes after is_active flips back on.
    await anyListener.onChannelsChanged()

    // Without the clear, every resolve inside onChannelsChanged would be served
    // from the cached error and the call count would not move. Any new call
    // proves the stale escalation was dropped and Telegram was retried at once.
    assert.ok(
      getInputEntityCalls() > callsBefore,
      `expected a fresh Telegram attempt after the channel was (re)discovered; `
      + `calls stayed at ${callsBefore} (escalation still blocking)`,
    )
  })
})
