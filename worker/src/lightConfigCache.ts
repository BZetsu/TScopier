import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applyBrokerChannelTradingConfigRow,
  fetchBrokerChannelTradingConfigRow,
  type BrokerChannelTradingConfigRow,
} from './brokerChannelTradingConfigs'
import { normalizeChannelUuid } from './channelTradingConfig'
import { incMetric, observeMetric } from './workerMetrics'

export const LIGHT_CONFIG_CACHE_SCHEMA_VERSION = 1
export const DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS = 5_000
export const DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES = 1_000
const MAX_LIGHT_CONFIG_CACHE_TTL_MS = 60_000
const MAX_LIGHT_CONFIG_CACHE_MAX_ENTRIES = 10_000

export type LightConfigCacheKey = {
  userId: string
  channelId: string
  brokerAccountId: string
}

export type LightConfigCacheEntry = {
  schemaVersion: 1
  cachedAt: number
  expiresAt: number
  configVersionOrUpdatedAt: string | null
  data: BrokerChannelTradingConfigRow | null
}

type CacheResult =
  | { kind: 'hit'; row: BrokerChannelTradingConfigRow | null; entry: LightConfigCacheEntry }
  | { kind: 'miss'; row: BrokerChannelTradingConfigRow | null; entry: LightConfigCacheEntry }
  | { kind: 'expired'; row: BrokerChannelTradingConfigRow | null; entry: LightConfigCacheEntry }

export type LightConfigCacheOptions = {
  enabled?: boolean
  ttlMs?: number
  maxEntries?: number
  now?: () => number
  fetchRow?: (
    supabase: SupabaseClient,
    brokerAccountId: string,
    channelId: string,
  ) => Promise<BrokerChannelTradingConfigRow | null>
}

function envFlagEnabled(): boolean {
  return String(process.env.LIGHT_CONFIG_CACHE_ENABLED ?? 'false').trim().toLowerCase() === 'true'
}

function envTtlMs(): number {
  const raw = process.env.LIGHT_CONFIG_CACHE_TTL_MS
  if (raw == null || String(raw).trim() === '') return DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    incMetric('light_config_cache_invalid_ttl')
    return 0
  }
  return Math.min(MAX_LIGHT_CONFIG_CACHE_TTL_MS, Math.max(1, Math.floor(n)))
}

function envMaxEntries(): number {
  const raw = process.env.LIGHT_CONFIG_CACHE_MAX_ENTRIES
  if (raw == null || String(raw).trim() === '') return DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    incMetric('light_config_cache_invalid_max_entries')
    return DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES
  }
  return Math.min(MAX_LIGHT_CONFIG_CACHE_MAX_ENTRIES, Math.max(1, Math.floor(n)))
}

export function lightConfigCacheEnabled(): boolean {
  if (!envFlagEnabled()) return false
  return envTtlMs() > 0
}

export function lightConfigCacheTtlMs(): number {
  return envTtlMs()
}

export function lightConfigCacheMaxEntries(): number {
  return envMaxEntries()
}

type CanonicalLightConfigCacheKey = {
  userId: string
  channelId: string
  brokerAccountId: string
}

function canonicalizeKey(key: LightConfigCacheKey): CanonicalLightConfigCacheKey | null {
  const userId = String(key.userId ?? '').trim()
  const brokerAccountId = String(key.brokerAccountId ?? '').trim()
  const channelId = normalizeChannelUuid(key.channelId)
  if (!userId || !brokerAccountId || !channelId) return null
  return { userId, brokerAccountId, channelId }
}

export function lightConfigCacheKey(key: LightConfigCacheKey): string {
  const canonical = canonicalizeKey(key)
  if (!canonical) return ''
  return JSON.stringify([
    canonical.userId,
    canonical.channelId,
    canonical.brokerAccountId,
  ])
}

const SENSITIVE_CONFIG_KEY = /password|secret|token|session|credential|encrypted|api[_-]?key/i

function sanitizeConfigValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sanitizeConfigValue)
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_CONFIG_KEY.test(key)) continue
    out[key] = sanitizeConfigValue(child)
  }
  return out
}

function cloneConfigRow(row: BrokerChannelTradingConfigRow | null): BrokerChannelTradingConfigRow | null {
  if (!row) return null
  return {
    broker_account_id: row.broker_account_id,
    channel_id: row.channel_id,
    copier_mode: row.copier_mode,
    manual_settings: sanitizeConfigValue(row.manual_settings ?? {}) as Record<string, unknown>,
    ai_settings: sanitizeConfigValue(row.ai_settings ?? {}) as Record<string, unknown>,
    copy_limit_state: row.copy_limit_state
      ? sanitizeConfigValue(row.copy_limit_state) as Record<string, unknown>
      : undefined,
    updated_at: row.updated_at ?? null,
  }
}

function isWellFormedEntry(entry: unknown): entry is LightConfigCacheEntry {
  if (!entry || typeof entry !== 'object') return false
  const row = entry as Partial<LightConfigCacheEntry>
  return row.schemaVersion === LIGHT_CONFIG_CACHE_SCHEMA_VERSION
    && typeof row.cachedAt === 'number'
    && Number.isFinite(row.cachedAt)
    && typeof row.expiresAt === 'number'
    && Number.isFinite(row.expiresAt)
    && 'data' in row
}

export class LightConfigCache {
  private readonly entries = new Map<string, LightConfigCacheEntry>()
  private readonly inflight = new Map<string, Promise<CacheResult>>()
  private readonly identities = new Map<string, CanonicalLightConfigCacheKey>()
  private readonly generationByKey = new Map<string, number>()
  private readonly invalidatedInflightKeys = new Set<string>()
  private readonly now: () => number
  private readonly fetchRow: NonNullable<LightConfigCacheOptions['fetchRow']>
  private readonly enabledOverride?: boolean
  private readonly ttlOverride?: number
  private readonly maxEntriesOverride?: number

  constructor(opts: LightConfigCacheOptions = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.fetchRow = opts.fetchRow ?? fetchBrokerChannelTradingConfigRow
    this.enabledOverride = opts.enabled
    this.ttlOverride = opts.ttlMs
    this.maxEntriesOverride = opts.maxEntries
  }

  enabled(): boolean {
    if (this.enabledOverride != null) {
      return this.enabledOverride === true && this.ttlMs() > 0
    }
    return lightConfigCacheEnabled()
  }

  ttlMs(): number {
    if (this.ttlOverride != null) {
      return Number.isFinite(this.ttlOverride) && this.ttlOverride > 0
        ? Math.floor(this.ttlOverride)
        : 0
    }
    return envTtlMs()
  }

  maxEntries(): number {
    if (this.maxEntriesOverride != null) {
      return Number.isFinite(this.maxEntriesOverride) && this.maxEntriesOverride > 0
        ? Math.min(MAX_LIGHT_CONFIG_CACHE_MAX_ENTRIES, Math.max(1, Math.floor(this.maxEntriesOverride)))
        : DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES
    }
    return envMaxEntries()
  }

  size(): number {
    return this.entries.size
  }

  inflightSize(): number {
    return this.inflight.size
  }

  generationSizeForTest(): number {
    return this.generationByKey.size
  }

  clear(): void {
    this.entries.clear()
    this.inflight.clear()
    this.identities.clear()
    this.generationByKey.clear()
    this.invalidatedInflightKeys.clear()
  }

  /** Test-only hook for malformed-entry and eviction coverage. Do not use in production dispatch paths. */
  setRawForTest(key: string, value: unknown): void {
    this.entries.set(key, value as LightConfigCacheEntry)
    const identity = this.parseCacheKey(key)
    if (identity) this.identities.set(key, identity)
    this.evictOverflow()
  }

  invalidate(key: Partial<LightConfigCacheKey>): void {
    this.invalidateScoped(key)
  }

  invalidateExact(key: LightConfigCacheKey): void {
    const cacheKey = lightConfigCacheKey(key)
    if (!cacheKey) return
    const invalidatedInflight = this.bumpGeneration(cacheKey)
    const removed = this.deleteCacheKey(cacheKey, { preserveGeneration: invalidatedInflight })
    if (removed > 0) incMetric('light_config_cache_invalidated', removed)
  }

  invalidateByChannel(userId: string, channelId: string): void {
    this.invalidateScoped({ userId, channelId })
  }

  invalidateByBroker(userId: string, brokerAccountId: string): void {
    this.invalidateScoped({ userId, brokerAccountId })
  }

  invalidateByBrokerChannel(brokerAccountId: string, channelId: string): void {
    this.invalidateScoped({ brokerAccountId, channelId })
  }

  private invalidateScoped(key: Partial<LightConfigCacheKey>): void {
    this.pruneExpired()
    let removed = 0
    const userId = key.userId ? String(key.userId).trim() : null
    const channelId = key.channelId ? normalizeChannelUuid(key.channelId) : null
    const brokerAccountId = key.brokerAccountId ? String(key.brokerAccountId).trim() : null
    for (const [cacheKey, identity] of Array.from(this.identities.entries())) {
      if (userId && identity.userId !== userId) continue
      if (channelId && identity.channelId !== channelId) continue
      if (brokerAccountId && identity.brokerAccountId !== brokerAccountId) continue
      const invalidatedInflight = this.bumpGeneration(cacheKey)
      removed += this.deleteCacheKey(cacheKey, { preserveGeneration: invalidatedInflight })
    }
    if (removed > 0) incMetric('light_config_cache_invalidated', removed)
  }

  async get(
    supabase: SupabaseClient,
    key: LightConfigCacheKey,
  ): Promise<CacheResult> {
    const started = this.now()
    const ttl = this.ttlMs()
    const identity = canonicalizeKey(key)
    if (!identity) {
      incMetric('light_config_cache_malformed')
      incMetric('light_config_cache_fallback_db')
      const dbStarted = this.now()
      const row = await this.fetchRow(supabase, key.brokerAccountId, key.channelId)
      observeMetric('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted)
      observeMetric('light_config_cache_lookup_duration_ms', this.now() - started)
      const entry = this.buildEntry(row, ttl || DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS)
      return { kind: 'miss', row, entry }
    }
    const cacheKey = lightConfigCacheKey(key)
    if (!this.enabled() || ttl <= 0) {
      incMetric('light_config_cache_fallback_db')
      const dbStarted = this.now()
      const row = await this.fetchRow(supabase, key.brokerAccountId, key.channelId)
      observeMetric('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted)
      observeMetric('light_config_cache_lookup_duration_ms', this.now() - started)
      const entry = this.buildEntry(row, ttl || DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS)
      return { kind: 'miss', row, entry }
    }

    const existing = this.entries.get(cacheKey)
    if (existing) {
      if (!isWellFormedEntry(existing)) {
        incMetric('light_config_cache_malformed')
        this.deleteCacheKey(cacheKey)
      } else if (existing.expiresAt > this.now()) {
        incMetric('light_config_cache_hit')
        this.entries.delete(cacheKey)
        this.entries.set(cacheKey, existing)
        observeMetric('light_config_cache_cached_lookup_duration_ms', this.now() - started)
        observeMetric('light_config_cache_lookup_duration_ms', this.now() - started)
        return { kind: 'hit', row: cloneConfigRow(existing.data), entry: existing }
      } else {
        incMetric('light_config_cache_expired')
        this.deleteCacheKey(cacheKey)
      }
    } else {
      incMetric('light_config_cache_miss')
    }
    this.pruneExpired()

    const joined = this.inflight.get(cacheKey)
    if (joined) {
      incMetric('light_config_cache_singleflight_join')
      return joined
    }

    this.identities.set(cacheKey, identity)
    const generation = this.generation(cacheKey)
    const fetchPromise = this.fetchAndStore(supabase, key, cacheKey, ttl, started, generation)
    this.inflight.set(cacheKey, fetchPromise)
    try {
      return await fetchPromise
    } finally {
      if (this.inflight.get(cacheKey) === fetchPromise) this.inflight.delete(cacheKey)
      this.cleanupGeneration(cacheKey)
    }
  }

  private async fetchAndStore(
    supabase: SupabaseClient,
    key: LightConfigCacheKey,
    cacheKey: string,
    ttl: number,
    started: number,
    generation: number,
  ): Promise<CacheResult> {
    const dbStarted = this.now()
    try {
      incMetric('light_config_cache_fallback_db')
      const row = await this.fetchRow(supabase, key.brokerAccountId, key.channelId)
      observeMetric('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted)
      const entry = this.buildEntry(row, ttl)
      if (this.enabled() && this.generation(cacheKey) === generation) {
        this.entries.set(cacheKey, entry)
        this.evictOverflow()
      } else {
        incMetric('light_config_cache_stale_fill_discarded')
      }
      observeMetric('light_config_cache_lookup_duration_ms', this.now() - started)
      return { kind: 'miss', row: cloneConfigRow(row), entry }
    } catch (err) {
      incMetric('light_config_cache_error')
      this.deleteCacheKey(cacheKey)
      observeMetric('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted)
      observeMetric('light_config_cache_lookup_duration_ms', this.now() - started)
      throw err
    }
  }

  private buildEntry(row: BrokerChannelTradingConfigRow | null, ttl: number): LightConfigCacheEntry {
    const cachedAt = this.now()
    return {
      schemaVersion: LIGHT_CONFIG_CACHE_SCHEMA_VERSION,
      cachedAt,
      expiresAt: cachedAt + ttl,
      configVersionOrUpdatedAt: row?.updated_at ?? null,
      data: cloneConfigRow(row),
    }
  }

  private parseCacheKey(cacheKey: string): CanonicalLightConfigCacheKey | null {
    try {
      const parsed = JSON.parse(cacheKey) as unknown
      if (!Array.isArray(parsed) || parsed.length !== 3) return null
      const [userId, channelId, brokerAccountId] = parsed.map(v => String(v ?? '').trim())
      if (!userId || !channelId || !brokerAccountId) return null
      return { userId, channelId, brokerAccountId }
    } catch {
      return null
    }
  }

  private generation(cacheKey: string): number {
    return this.generationByKey.get(cacheKey) ?? 0
  }

  private bumpGeneration(cacheKey: string): boolean {
    this.generationByKey.set(cacheKey, this.generation(cacheKey) + 1)
    const hadInflight = this.inflight.delete(cacheKey)
    if (hadInflight) this.invalidatedInflightKeys.add(cacheKey)
    return hadInflight || this.invalidatedInflightKeys.has(cacheKey)
  }

  private deleteCacheKey(cacheKey: string, opts: { preserveGeneration?: boolean } = {}): number {
    const existed = this.entries.delete(cacheKey)
    this.identities.delete(cacheKey)
    if (!opts.preserveGeneration && !this.invalidatedInflightKeys.has(cacheKey) && !this.inflight.has(cacheKey)) {
      this.generationByKey.delete(cacheKey)
    }
    return existed ? 1 : 0
  }

  private cleanupGeneration(cacheKey: string): void {
    this.invalidatedInflightKeys.delete(cacheKey)
    if (!this.inflight.has(cacheKey) && !this.entries.has(cacheKey)) {
      this.generationByKey.delete(cacheKey)
    }
  }

  private pruneExpired(): void {
    const now = this.now()
    let removed = 0
    for (const [cacheKey, entry] of Array.from(this.entries.entries())) {
      if (isWellFormedEntry(entry) && entry.expiresAt <= now) {
        removed += this.deleteCacheKey(cacheKey)
      }
    }
    if (removed > 0) incMetric('light_config_cache_pruned', removed)
  }

  private evictOverflow(): void {
    const maxEntries = this.maxEntries()
    let removed = 0
    while (this.entries.size > maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) break
      removed += this.deleteCacheKey(oldest)
    }
    if (removed > 0) incMetric('light_config_cache_evicted', removed)
  }
}

export async function fetchBrokerForChannelWithLightConfigCache<T extends {
  id: string
  user_id: string
  channel_trading_configs?: unknown
}>(
  cache: LightConfigCache,
  supabase: SupabaseClient,
  broker: T,
  channelId: string | null | undefined,
): Promise<T> {
  if (!channelId) return broker
  if (!cache.enabled()) {
    incMetric('light_config_cache_fallback_db')
    const started = Date.now()
    const row = await fetchBrokerChannelTradingConfigRow(supabase, broker.id, channelId)
    observeMetric('light_config_cache_db_fallback_duration_ms', Date.now() - started)
    return row ? applyBrokerChannelTradingConfigRow(broker, row) : broker
  }
  try {
    const result = await cache.get(supabase, {
      userId: broker.user_id,
      brokerAccountId: broker.id,
      channelId,
    })
    return result.row ? applyBrokerChannelTradingConfigRow(broker, result.row) : broker
  } catch {
    const row = await fetchBrokerChannelTradingConfigRow(supabase, broker.id, channelId)
    return row ? applyBrokerChannelTradingConfigRow(broker, row) : broker
  }
}
