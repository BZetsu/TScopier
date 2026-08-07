import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchBrokerForChannelWithLightConfigCache,
  LightConfigCache,
  lightConfigCacheEnabled,
  lightConfigCacheKey,
  lightConfigCacheMaxEntries,
  lightConfigCacheTtlMs,
  type LightConfigCacheEntry,
} from './lightConfigCache'
import type { BrokerChannelTradingConfigRow } from './brokerChannelTradingConfigs'
import { getMetricsSnapshot, resetMetricsForTest } from './workerMetrics'

function row(
  brokerAccountId: string,
  channelId: string,
  fixedLot: number,
  extraManual: Record<string, unknown> = {},
): BrokerChannelTradingConfigRow {
  return {
    broker_account_id: brokerAccountId,
    channel_id: channelId,
    copier_mode: 'manual',
    manual_settings: {
      fixed_lot: fixedLot,
      trade_style: 'single',
      risk_mode: 'fixed_lot',
      ...extraManual,
    },
    ai_settings: {},
    copy_limit_state: { paused_period_keys: [], periods: {} },
    updated_at: `v-${fixedLot}`,
  }
}

function broker(id = 'broker-1', userId = 'user-1') {
  return {
    id,
    user_id: userId,
    channel_trading_configs: {},
  }
}

function fakeSupabase(rows: BrokerChannelTradingConfigRow[]) {
  const calls: string[] = []
  return {
    calls,
    client: {
      from(table: string) {
        calls.push(`from:${table}`)
        assert.equal(table, 'broker_channel_trading_configs')
        const filters: Record<string, string> = {}
        const chain = {
          select(selectClause: string) {
            void selectClause
            calls.push('select')
            return chain
          },
          eq(column: string, value: string) {
            calls.push(`eq:${column}:${value}`)
            filters[column] = value
            return chain
          },
          async maybeSingle() {
            calls.push('maybeSingle')
            const found = rows.find(r =>
              r.broker_account_id === filters.broker_account_id
              && r.channel_id === filters.channel_id
            )
            return { data: found ?? null, error: null }
          },
        }
        return chain
      },
    } as unknown as SupabaseClient,
  }
}

describe('LightConfigCache', () => {
  beforeEach(() => {
    resetMetricsForTest()
    delete process.env.LIGHT_CONFIG_CACHE_ENABLED
    delete process.env.LIGHT_CONFIG_CACHE_TTL_MS
    delete process.env.LIGHT_CONFIG_CACHE_MAX_ENTRIES
  })

  it('disabled flag preserves DB lookup behavior', async () => {
    const cache = new LightConfigCache({ enabled: false, ttlMs: 5_000 })
    const sb = fakeSupabase([row('broker-1', 'channel-1', 0.02)])
    await fetchBrokerForChannelWithLightConfigCache(cache, sb.client, broker(), 'channel-1')
    await fetchBrokerForChannelWithLightConfigCache(cache, sb.client, broker(), 'channel-1')
    assert.equal(sb.calls.filter(c => c === 'maybeSingle').length, 2)
  })

  it('first lookup reads DB and second lookup within TTL hits cache', async () => {
    let calls = 0
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        calls += 1
        return row('broker-1', 'channel-1', 0.03)
      },
    })
    const first = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    const second = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    assert.equal(first.kind, 'miss')
    assert.equal(second.kind, 'hit')
    assert.equal(calls, 1)
  })

  it('expired cache refetches DB and does not use changed broker config beyond TTL', async () => {
    let now = 1_000
    let fixedLot = 0.01
    let calls = 0
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5,
      now: () => now,
      fetchRow: async () => {
        calls += 1
        return row('broker-1', 'channel-1', fixedLot)
      },
    })
    const first = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    fixedLot = 0.05
    now += 6
    const second = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    assert.equal(first.row?.manual_settings.fixed_lot, 0.01)
    assert.equal(second.row?.manual_settings.fixed_lot, 0.05)
    assert.equal(calls, 2)
  })

  it('expired cache refetches changed risk config beyond TTL', async () => {
    let now = 1_000
    let riskMode = 'fixed_lot'
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5,
      now: () => now,
      fetchRow: async () => row('broker-1', 'channel-1', 0.01, { risk_mode: riskMode }),
    })
    const first = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    riskMode = 'dynamic_balance_percent'
    now += 6
    const second = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    assert.equal(first.row?.manual_settings.risk_mode, 'fixed_lot')
    assert.equal(second.row?.manual_settings.risk_mode, 'dynamic_balance_percent')
  })

  it('malformed cache refetches DB', async () => {
    let calls = 0
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        calls += 1
        return row('broker-1', 'channel-1', 0.04)
      },
    })
    cache.setRawForTest(lightConfigCacheKey({
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    }), { schemaVersion: 99 })
    const result = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    assert.equal(result.row?.manual_settings.fixed_lot, 0.04)
    assert.equal(calls, 1)
    assert.equal(getMetricsSnapshot().light_config_cache_malformed, 1)
  })

  it('cache fetch failure clears singleflight and preserves DB failure semantics', async () => {
    let calls = 0
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        calls += 1
        throw new Error('db down')
      },
    })
    await assert.rejects(
      () => cache.get({} as SupabaseClient, {
        userId: 'user-1',
        brokerAccountId: 'broker-1',
        channelId: 'channel-1',
      }),
      /db down/,
    )
    await assert.rejects(
      () => cache.get({} as SupabaseClient, {
        userId: 'user-1',
        brokerAccountId: 'broker-1',
        channelId: 'channel-1',
      }),
      /db down/,
    )
    assert.equal(calls, 2)
  })

  it('cache wrapper falls back to DB when cache subsystem fails', async () => {
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        throw new Error('cache read failed')
      },
    })
    const sb = fakeSupabase([row('broker-1', 'channel-1', 0.06)])
    const result = await fetchBrokerForChannelWithLightConfigCache(
      cache,
      sb.client,
      broker(),
      'channel-1',
    )
    const configs = result.channel_trading_configs as Record<string, { manual_settings: Record<string, unknown> }>
    assert.equal(configs['channel-1']?.manual_settings.fixed_lot, 0.06)
  })

  it('settings change invalidates only the affected entry', async () => {
    const cache = new LightConfigCache({ enabled: true, ttlMs: 5_000 })
    const affected = lightConfigCacheKey({
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    const unrelated = lightConfigCacheKey({
      userId: 'user-1',
      brokerAccountId: 'broker-2',
      channelId: 'channel-1',
    })
    const entry: LightConfigCacheEntry = {
      schemaVersion: 1,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 5_000,
      configVersionOrUpdatedAt: 'v1',
      data: row('broker-1', 'channel-1', 0.01),
    }
    cache.setRawForTest(affected, entry)
    cache.setRawForTest(unrelated, { ...entry, data: row('broker-2', 'channel-1', 0.02) })
    cache.invalidateByBrokerChannel('broker-1', 'channel-1')
    assert.equal(cache.size(), 1)
  })

  it('exact invalidation does not collide on similar ids', () => {
    const cache = new LightConfigCache({ enabled: true, ttlMs: 5_000 })
    const keyA = { userId: 'user-12', brokerAccountId: 'broker-4', channelId: 'channel-4' }
    const keyB = { userId: 'user-123', brokerAccountId: 'broker-45', channelId: 'channel-45' }
    const entry: LightConfigCacheEntry = {
      schemaVersion: 1,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 5_000,
      configVersionOrUpdatedAt: 'v1',
      data: row('broker-4', 'channel-4', 0.01),
    }
    cache.setRawForTest(lightConfigCacheKey(keyA), entry)
    cache.setRawForTest(lightConfigCacheKey(keyB), { ...entry, data: row('broker-45', 'channel-45', 0.02) })
    cache.invalidateExact(keyA)
    assert.equal(cache.size(), 1)
    cache.invalidateExact(keyA)
    assert.equal(cache.size(), 1)
  })

  it('update-style invalidation can remove old and new identities while unrelated account stays cached', () => {
    const cache = new LightConfigCache({ enabled: true, ttlMs: 5_000 })
    const oldKey = { userId: 'user-1', brokerAccountId: 'broker-a', channelId: 'channel-a' }
    const newBrokerKey = { userId: 'user-1', brokerAccountId: 'broker-b', channelId: 'channel-a' }
    const newChannelKey = { userId: 'user-1', brokerAccountId: 'broker-b', channelId: 'channel-b' }
    const unrelated = { userId: 'user-1', brokerAccountId: 'broker-c', channelId: 'channel-a' }
    const entry: LightConfigCacheEntry = {
      schemaVersion: 1,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 5_000,
      configVersionOrUpdatedAt: 'v1',
      data: row('broker-a', 'channel-a', 0.01),
    }
    for (const key of [oldKey, newBrokerKey, newChannelKey, unrelated]) {
      cache.setRawForTest(lightConfigCacheKey(key), entry)
    }
    cache.invalidateExact(oldKey)
    cache.invalidateExact(newBrokerKey)
    cache.invalidateExact(newChannelKey)
    assert.equal(cache.size(), 1)
  })

  it('scoped fallback invalidation uses structured broker/channel identity', () => {
    const cache = new LightConfigCache({ enabled: true, ttlMs: 5_000 })
    const affected = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    const similar = { userId: 'user-1', brokerAccountId: 'broker-10', channelId: 'channel-1' }
    const entry: LightConfigCacheEntry = {
      schemaVersion: 1,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 5_000,
      configVersionOrUpdatedAt: 'v1',
      data: row('broker-1', 'channel-1', 0.01),
    }
    cache.setRawForTest(lightConfigCacheKey(affected), entry)
    cache.setRawForTest(lightConfigCacheKey(similar), { ...entry, data: row('broker-10', 'channel-1', 0.02) })
    cache.invalidateByBrokerChannel('broker-1', 'channel-1')
    assert.equal(cache.size(), 1)
  })

  it('cache key separation covers user, broker account, and channel', () => {
    const keys = new Set([
      lightConfigCacheKey({ userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }),
      lightConfigCacheKey({ userId: 'user-2', brokerAccountId: 'broker-1', channelId: 'channel-1' }),
      lightConfigCacheKey({ userId: 'user-1', brokerAccountId: 'broker-2', channelId: 'channel-1' }),
      lightConfigCacheKey({ userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-2' }),
    ])
    assert.equal(keys.size, 4)
  })

  it('production env contract defaults off and parses enabled flag safely', () => {
    assert.equal(lightConfigCacheEnabled(), false)
    process.env.LIGHT_CONFIG_CACHE_ENABLED = 'TRUE'
    assert.equal(lightConfigCacheEnabled(), true)
    process.env.LIGHT_CONFIG_CACHE_ENABLED = ' true '
    assert.equal(lightConfigCacheEnabled(), true)
    for (const value of ['false', 'FALSE', '0', 'yes', 'enabled', '   ', 'tru']) {
      process.env.LIGHT_CONFIG_CACHE_ENABLED = value
      assert.equal(lightConfigCacheEnabled(), false)
    }
    process.env.LIGHT_CONFIG_CACHE_ENABLED = 'true'
    process.env.LIGHT_CONFIG_CACHE_TTL_MS = '0'
    assert.equal(lightConfigCacheEnabled(), false)
  })

  it('invalid identity falls back to DB without storing', async () => {
    let calls = 0
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        calls += 1
        return row('broker-1', 'channel-1', 0.01)
      },
    })
    const result = await cache.get({} as SupabaseClient, {
      userId: '',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    assert.equal(result.row?.manual_settings.fixed_lot, 0.01)
    assert.equal(cache.size(), 0)
    assert.equal(calls, 1)
  })

  it('concurrent identical lookups singleflight correctly', async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        calls += 1
        await gate
        return row('broker-1', 'channel-1', 0.07)
      },
    })
    const a = cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    const b = cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    release()
    await Promise.all([a, b])
    assert.equal(calls, 1)
    assert.equal(getMetricsSnapshot().light_config_cache_singleflight_join, 1)
    assert.equal(cache.inflightSize(), 0)
  })

  it('invalidation during inflight fetch discards stale fill and next lookup refetches', async () => {
    let release!: () => void
    let fixedLot = 0.01
    let calls = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        calls += 1
        const lotAtFetchStart = fixedLot
        if (calls === 1) await gate
        return row('broker-1', 'channel-1', lotAtFetchStart)
      },
    })
    const key = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    const first = cache.get({} as SupabaseClient, key)
    cache.invalidateExact(key)
    fixedLot = 0.02
    release()
    const firstResult = await first
    assert.equal(firstResult.row?.manual_settings.fixed_lot, 0.01)
    assert.equal(cache.size(), 0)
    const second = await cache.get({} as SupabaseClient, key)
    const third = await cache.get({} as SupabaseClient, key)
    assert.equal(second.row?.manual_settings.fixed_lot, 0.02)
    assert.equal(third.kind, 'hit')
    assert.equal(calls, 2)
    assert.equal(getMetricsSnapshot().light_config_cache_stale_fill_discarded, 1)
  })

  it('multiple invalidations during inflight remain safe', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        await gate
        return row('broker-1', 'channel-1', 0.01)
      },
    })
    const key = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    const pending = cache.get({} as SupabaseClient, key)
    cache.invalidateExact(key)
    cache.invalidateExact(key)
    cache.invalidateByBrokerChannel('broker-1', 'channel-1')
    release()
    await pending
    assert.equal(cache.size(), 0)
    assert.equal(cache.inflightSize(), 0)
    assert.equal(cache.generationSizeForTest(), 0)
  })

  it('cache disable during inflight prevents stale population', async () => {
    process.env.LIGHT_CONFIG_CACHE_ENABLED = 'true'
    process.env.LIGHT_CONFIG_CACHE_TTL_MS = '5000'
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const cache = new LightConfigCache({
      fetchRow: async () => {
        await gate
        return row('broker-1', 'channel-1', 0.01)
      },
    })
    const key = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    const pending = cache.get({} as SupabaseClient, key)
    process.env.LIGHT_CONFIG_CACHE_ENABLED = 'false'
    release()
    await pending
    assert.equal(cache.size(), 0)
  })

  it('max entries evicts oldest and repeated gets do not grow the cache', async () => {
    let calls = 0
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      maxEntries: 2,
      fetchRow: async (_sb, brokerId, channelId) => {
        calls += 1
        return row(brokerId, channelId, Number(brokerId.replace('broker-', '')) / 100)
      },
    })
    for (const brokerId of ['broker-1', 'broker-2']) {
      await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: brokerId, channelId: 'channel-1' })
    }
    assert.equal(cache.size(), 2)
    await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' })
    await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: 'broker-3', channelId: 'channel-1' })
    assert.equal(cache.size(), 2)
    assert.equal(getMetricsSnapshot().light_config_cache_evicted, 1)
    await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: 'broker-2', channelId: 'channel-1' })
    assert.equal(cache.size(), 2)
    assert.equal(calls, 4)
  })

  it('expired cold entries are pruned on cache operations', async () => {
    let now = 1_000
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5,
      now: () => now,
      fetchRow: async (_sb, brokerId, channelId) => row(brokerId, channelId, 0.01),
    })
    await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' })
    await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: 'broker-2', channelId: 'channel-1' })
    now += 6
    await cache.get({} as SupabaseClient, { userId: 'user-1', brokerAccountId: 'broker-3', channelId: 'channel-1' })
    assert.equal(cache.size(), 1)
    assert.equal(getMetricsSnapshot().light_config_cache_pruned, 2)
  })

  it('five thousand synthetic keys stay bounded by max entries', async () => {
    const cache = new LightConfigCache({ enabled: true, ttlMs: 5_000, maxEntries: 100 })
    const entry: LightConfigCacheEntry = {
      schemaVersion: 1,
      cachedAt: Date.now(),
      expiresAt: Date.now() + 5_000,
      configVersionOrUpdatedAt: 'v1',
      data: row('broker-1', 'channel-1', 0.01),
    }
    for (let i = 0; i < 5_000; i += 1) {
      cache.setRawForTest(lightConfigCacheKey({
        userId: `user-${i}`,
        brokerAccountId: `broker-${i}`,
        channelId: `channel-${i}`,
      }), entry)
    }
    assert.equal(cache.size(), 100)
    assert.ok(cache.generationSizeForTest() <= 100)
  })

  it('separate worker instances do not share cache memory', async () => {
    let cacheAReads = 0
    let cacheBReads = 0
    const key = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    const cacheA = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        cacheAReads += 1
        return row('broker-1', 'channel-1', 0.01)
      },
    })
    const cacheB = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => {
        cacheBReads += 1
        return row('broker-1', 'channel-1', 0.02)
      },
    })
    await cacheA.get({} as SupabaseClient, key)
    await cacheB.get({} as SupabaseClient, key)
    await cacheA.get({} as SupabaseClient, key)
    await cacheB.get({} as SupabaseClient, key)
    assert.equal(cacheAReads, 1)
    assert.equal(cacheBReads, 1)
    cacheA.invalidateExact(key)
    assert.equal(cacheA.size(), 0)
    assert.equal(cacheB.size(), 1)
  })

  it('cache disabled does not accumulate entries', async () => {
    let calls = 0
    const cache = new LightConfigCache({
      enabled: false,
      ttlMs: 5_000,
      fetchRow: async (_sb, brokerId, channelId) => {
        calls += 1
        return row(brokerId, channelId, 0.01)
      },
    })
    for (let i = 0; i < 5; i += 1) {
      await cache.get({} as SupabaseClient, {
        userId: `user-${i}`,
        brokerAccountId: `broker-${i}`,
        channelId: `channel-${i}`,
      })
    }
    assert.equal(cache.size(), 0)
    assert.equal(calls, 5)
  })

  it('ttl and max-entry env diagnostics are unambiguous', () => {
    process.env.LIGHT_CONFIG_CACHE_ENABLED = 'true'
    const cases: Array<[string | undefined, boolean, number]> = [
      [undefined, true, 5_000],
      ['5000', true, 5_000],
      ['1', true, 1],
      ['0', false, 0],
      ['-1', false, 0],
      ['NaN', false, 0],
      ['Infinity', false, 0],
      ['   ', true, 5_000],
      ['999999', true, 60_000],
    ]
    for (const [ttl, enabled, effectiveTtl] of cases) {
      resetMetricsForTest()
      if (ttl == null) delete process.env.LIGHT_CONFIG_CACHE_TTL_MS
      else process.env.LIGHT_CONFIG_CACHE_TTL_MS = ttl
      assert.equal(lightConfigCacheEnabled(), enabled)
      assert.equal(lightConfigCacheTtlMs(), effectiveTtl)
    }
    process.env.LIGHT_CONFIG_CACHE_MAX_ENTRIES = '2'
    assert.equal(lightConfigCacheMaxEntries(), 2)
    process.env.LIGHT_CONFIG_CACHE_MAX_ENTRIES = 'bad'
    assert.equal(lightConfigCacheMaxEntries(), 1_000)
  })

  it('cache round-trip preserves current execution-relevant config fields', async () => {
    const manualSettings = {
      fixed_lot: 0.03,
      trade_style: 'multi',
      risk_mode: 'fixed_lot',
      range_trading: true,
      range_layering_type: 'static',
      range_step_pips: 5,
      max_trades: 3,
      sl_pips: 20,
      tp_pips: 40,
      pending_order: true,
      execution_mechanism: 'virtual_pending',
      symbol_map: { GOLD: 'XAUUSD' },
    }
    const aiSettings = { enabled: true, confidence_threshold: 0.7 }
    const copyLimitState = { paused_period_keys: ['daily'], periods: { daily: { used: 1, limit: 3 } } }
    const expected = row('broker-1', 'channel-1', 0.03, manualSettings)
    expected.ai_settings = aiSettings
    expected.copy_limit_state = copyLimitState
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => expected,
    })
    const first = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    const second = await cache.get({} as SupabaseClient, {
      userId: 'user-1',
      brokerAccountId: 'broker-1',
      channelId: 'channel-1',
    })
    assert.deepEqual(second.row, first.row)
    assert.deepEqual(second.row?.manual_settings, expected.manual_settings)
    assert.deepEqual(second.row?.ai_settings, expected.ai_settings)
    assert.deepEqual(second.row?.copy_limit_state, expected.copy_limit_state)
  })

  it('metrics counters record miss, hit, expired, fallback, and invalidation', async () => {
    let now = 1_000
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5,
      now: () => now,
      fetchRow: async () => row('broker-1', 'channel-1', 0.01),
    })
    const key = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    await cache.get({} as SupabaseClient, key)
    await cache.get({} as SupabaseClient, key)
    now += 6
    await cache.get({} as SupabaseClient, key)
    cache.invalidate(key)
    const metrics = getMetricsSnapshot()
    assert.equal(metrics.light_config_cache_miss, 1)
    assert.equal(metrics.light_config_cache_hit, 1)
    assert.equal(metrics.light_config_cache_expired, 1)
    assert.equal(metrics.light_config_cache_fallback_db, 2)
    assert.equal(metrics.light_config_cache_invalidated, 1)
  })

  it('does not store secrets in cache keys or values', async () => {
    const cache = new LightConfigCache({
      enabled: true,
      ttlMs: 5_000,
      fetchRow: async () => row('broker-1', 'channel-1', 0.01, {
        api_key: 'secret',
        nested: { password: 'secret', safe: true },
      }),
    })
    const key = { userId: 'user-1', brokerAccountId: 'broker-1', channelId: 'channel-1' }
    const result = await cache.get({} as SupabaseClient, key)
    assert.equal(lightConfigCacheKey(key).includes('secret'), false)
    assert.equal('api_key' in (result.entry.data?.manual_settings ?? {}), false)
    assert.deepEqual(result.entry.data?.manual_settings.nested, { safe: true })
  })

  it('does not cache durable claims, idempotency, broker state, kill switches, cancellation, or duplicate dispatch decisions', async () => {
    const sb = fakeSupabase([row('broker-1', 'channel-1', 0.01)])
    const cache = new LightConfigCache({ enabled: false, ttlMs: 5_000 })
    await fetchBrokerForChannelWithLightConfigCache(cache, sb.client, broker(), 'channel-1')
    assert.deepEqual([...new Set(sb.calls.filter(c => c.startsWith('from:')))], [
      'from:broker_channel_trading_configs',
    ])
  })
})
