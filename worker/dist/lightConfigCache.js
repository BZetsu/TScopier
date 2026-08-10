"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LightConfigCache = exports.DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES = exports.DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS = exports.LIGHT_CONFIG_CACHE_SCHEMA_VERSION = void 0;
exports.lightConfigCacheEnabled = lightConfigCacheEnabled;
exports.lightConfigCacheTtlMs = lightConfigCacheTtlMs;
exports.lightConfigCacheMaxEntries = lightConfigCacheMaxEntries;
exports.lightConfigCacheKey = lightConfigCacheKey;
exports.fetchBrokerForChannelWithLightConfigCache = fetchBrokerForChannelWithLightConfigCache;
const brokerChannelTradingConfigs_1 = require("./brokerChannelTradingConfigs");
const channelTradingConfig_1 = require("./channelTradingConfig");
const workerMetrics_1 = require("./workerMetrics");
exports.LIGHT_CONFIG_CACHE_SCHEMA_VERSION = 1;
exports.DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS = 5000;
exports.DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES = 1000;
const MAX_LIGHT_CONFIG_CACHE_TTL_MS = 60000;
const MAX_LIGHT_CONFIG_CACHE_MAX_ENTRIES = 10000;
function envFlagEnabled() {
    return String(process.env.LIGHT_CONFIG_CACHE_ENABLED ?? 'false').trim().toLowerCase() === 'true';
}
function envTtlMs() {
    const raw = process.env.LIGHT_CONFIG_CACHE_TTL_MS;
    if (raw == null || String(raw).trim() === '')
        return exports.DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        (0, workerMetrics_1.incMetric)('light_config_cache_invalid_ttl');
        return 0;
    }
    return Math.min(MAX_LIGHT_CONFIG_CACHE_TTL_MS, Math.max(1, Math.floor(n)));
}
function envMaxEntries() {
    const raw = process.env.LIGHT_CONFIG_CACHE_MAX_ENTRIES;
    if (raw == null || String(raw).trim() === '')
        return exports.DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        (0, workerMetrics_1.incMetric)('light_config_cache_invalid_max_entries');
        return exports.DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES;
    }
    return Math.min(MAX_LIGHT_CONFIG_CACHE_MAX_ENTRIES, Math.max(1, Math.floor(n)));
}
function lightConfigCacheEnabled() {
    if (!envFlagEnabled())
        return false;
    return envTtlMs() > 0;
}
function lightConfigCacheTtlMs() {
    return envTtlMs();
}
function lightConfigCacheMaxEntries() {
    return envMaxEntries();
}
function canonicalizeKey(key) {
    const userId = String(key.userId ?? '').trim();
    const brokerAccountId = String(key.brokerAccountId ?? '').trim();
    const channelId = (0, channelTradingConfig_1.normalizeChannelUuid)(key.channelId);
    if (!userId || !brokerAccountId || !channelId)
        return null;
    return { userId, brokerAccountId, channelId };
}
function lightConfigCacheKey(key) {
    const canonical = canonicalizeKey(key);
    if (!canonical)
        return '';
    return JSON.stringify([
        canonical.userId,
        canonical.channelId,
        canonical.brokerAccountId,
    ]);
}
const SENSITIVE_CONFIG_KEY = /password|secret|token|session|credential|encrypted|api[_-]?key/i;
function sanitizeConfigValue(value) {
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(sanitizeConfigValue);
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        if (SENSITIVE_CONFIG_KEY.test(key))
            continue;
        out[key] = sanitizeConfigValue(child);
    }
    return out;
}
function cloneConfigRow(row) {
    if (!row)
        return null;
    return {
        broker_account_id: row.broker_account_id,
        channel_id: row.channel_id,
        copier_mode: row.copier_mode,
        manual_settings: sanitizeConfigValue(row.manual_settings ?? {}),
        ai_settings: sanitizeConfigValue(row.ai_settings ?? {}),
        copy_limit_state: row.copy_limit_state
            ? sanitizeConfigValue(row.copy_limit_state)
            : undefined,
        updated_at: row.updated_at ?? null,
    };
}
function isWellFormedEntry(entry) {
    if (!entry || typeof entry !== 'object')
        return false;
    const row = entry;
    return row.schemaVersion === exports.LIGHT_CONFIG_CACHE_SCHEMA_VERSION
        && typeof row.cachedAt === 'number'
        && Number.isFinite(row.cachedAt)
        && typeof row.expiresAt === 'number'
        && Number.isFinite(row.expiresAt)
        && 'data' in row;
}
class LightConfigCache {
    constructor(opts = {}) {
        this.entries = new Map();
        this.inflight = new Map();
        this.identities = new Map();
        this.generationByKey = new Map();
        this.invalidatedInflightKeys = new Set();
        this.now = opts.now ?? (() => Date.now());
        this.fetchRow = opts.fetchRow ?? brokerChannelTradingConfigs_1.fetchBrokerChannelTradingConfigRow;
        this.enabledOverride = opts.enabled;
        this.ttlOverride = opts.ttlMs;
        this.maxEntriesOverride = opts.maxEntries;
    }
    enabled() {
        if (this.enabledOverride != null) {
            return this.enabledOverride === true && this.ttlMs() > 0;
        }
        return lightConfigCacheEnabled();
    }
    ttlMs() {
        if (this.ttlOverride != null) {
            return Number.isFinite(this.ttlOverride) && this.ttlOverride > 0
                ? Math.floor(this.ttlOverride)
                : 0;
        }
        return envTtlMs();
    }
    maxEntries() {
        if (this.maxEntriesOverride != null) {
            return Number.isFinite(this.maxEntriesOverride) && this.maxEntriesOverride > 0
                ? Math.min(MAX_LIGHT_CONFIG_CACHE_MAX_ENTRIES, Math.max(1, Math.floor(this.maxEntriesOverride)))
                : exports.DEFAULT_LIGHT_CONFIG_CACHE_MAX_ENTRIES;
        }
        return envMaxEntries();
    }
    size() {
        return this.entries.size;
    }
    inflightSize() {
        return this.inflight.size;
    }
    generationSizeForTest() {
        return this.generationByKey.size;
    }
    clear() {
        this.entries.clear();
        this.inflight.clear();
        this.identities.clear();
        this.generationByKey.clear();
        this.invalidatedInflightKeys.clear();
    }
    /** Test-only hook for malformed-entry and eviction coverage. Do not use in production dispatch paths. */
    setRawForTest(key, value) {
        this.entries.set(key, value);
        const identity = this.parseCacheKey(key);
        if (identity)
            this.identities.set(key, identity);
        this.evictOverflow();
    }
    invalidate(key) {
        this.invalidateScoped(key);
    }
    invalidateExact(key) {
        const cacheKey = lightConfigCacheKey(key);
        if (!cacheKey)
            return;
        const invalidatedInflight = this.bumpGeneration(cacheKey);
        const removed = this.deleteCacheKey(cacheKey, { preserveGeneration: invalidatedInflight });
        if (removed > 0)
            (0, workerMetrics_1.incMetric)('light_config_cache_invalidated', removed);
    }
    invalidateByChannel(userId, channelId) {
        this.invalidateScoped({ userId, channelId });
    }
    invalidateByBroker(userId, brokerAccountId) {
        this.invalidateScoped({ userId, brokerAccountId });
    }
    invalidateByBrokerChannel(brokerAccountId, channelId) {
        this.invalidateScoped({ brokerAccountId, channelId });
    }
    invalidateScoped(key) {
        this.pruneExpired();
        let removed = 0;
        const userId = key.userId ? String(key.userId).trim() : null;
        const channelId = key.channelId ? (0, channelTradingConfig_1.normalizeChannelUuid)(key.channelId) : null;
        const brokerAccountId = key.brokerAccountId ? String(key.brokerAccountId).trim() : null;
        for (const [cacheKey, identity] of Array.from(this.identities.entries())) {
            if (userId && identity.userId !== userId)
                continue;
            if (channelId && identity.channelId !== channelId)
                continue;
            if (brokerAccountId && identity.brokerAccountId !== brokerAccountId)
                continue;
            const invalidatedInflight = this.bumpGeneration(cacheKey);
            removed += this.deleteCacheKey(cacheKey, { preserveGeneration: invalidatedInflight });
        }
        if (removed > 0)
            (0, workerMetrics_1.incMetric)('light_config_cache_invalidated', removed);
    }
    async get(supabase, key) {
        const started = this.now();
        const ttl = this.ttlMs();
        const identity = canonicalizeKey(key);
        if (!identity) {
            (0, workerMetrics_1.incMetric)('light_config_cache_malformed');
            (0, workerMetrics_1.incMetric)('light_config_cache_fallback_db');
            const dbStarted = this.now();
            const row = await this.fetchRow(supabase, key.brokerAccountId, key.channelId);
            (0, workerMetrics_1.observeMetric)('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted);
            (0, workerMetrics_1.observeMetric)('light_config_cache_lookup_duration_ms', this.now() - started);
            const entry = this.buildEntry(row, ttl || exports.DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS);
            return { kind: 'miss', row, entry };
        }
        const cacheKey = lightConfigCacheKey(key);
        if (!this.enabled() || ttl <= 0) {
            (0, workerMetrics_1.incMetric)('light_config_cache_fallback_db');
            const dbStarted = this.now();
            const row = await this.fetchRow(supabase, key.brokerAccountId, key.channelId);
            (0, workerMetrics_1.observeMetric)('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted);
            (0, workerMetrics_1.observeMetric)('light_config_cache_lookup_duration_ms', this.now() - started);
            const entry = this.buildEntry(row, ttl || exports.DEFAULT_LIGHT_CONFIG_CACHE_TTL_MS);
            return { kind: 'miss', row, entry };
        }
        const existing = this.entries.get(cacheKey);
        if (existing) {
            if (!isWellFormedEntry(existing)) {
                (0, workerMetrics_1.incMetric)('light_config_cache_malformed');
                this.deleteCacheKey(cacheKey);
            }
            else if (existing.expiresAt > this.now()) {
                (0, workerMetrics_1.incMetric)('light_config_cache_hit');
                this.entries.delete(cacheKey);
                this.entries.set(cacheKey, existing);
                (0, workerMetrics_1.observeMetric)('light_config_cache_cached_lookup_duration_ms', this.now() - started);
                (0, workerMetrics_1.observeMetric)('light_config_cache_lookup_duration_ms', this.now() - started);
                return { kind: 'hit', row: cloneConfigRow(existing.data), entry: existing };
            }
            else {
                (0, workerMetrics_1.incMetric)('light_config_cache_expired');
                this.deleteCacheKey(cacheKey);
            }
        }
        else {
            (0, workerMetrics_1.incMetric)('light_config_cache_miss');
        }
        this.pruneExpired();
        const joined = this.inflight.get(cacheKey);
        if (joined) {
            (0, workerMetrics_1.incMetric)('light_config_cache_singleflight_join');
            return joined;
        }
        this.identities.set(cacheKey, identity);
        const generation = this.generation(cacheKey);
        const fetchPromise = this.fetchAndStore(supabase, key, cacheKey, ttl, started, generation);
        this.inflight.set(cacheKey, fetchPromise);
        try {
            return await fetchPromise;
        }
        finally {
            if (this.inflight.get(cacheKey) === fetchPromise)
                this.inflight.delete(cacheKey);
            this.cleanupGeneration(cacheKey);
        }
    }
    async fetchAndStore(supabase, key, cacheKey, ttl, started, generation) {
        const dbStarted = this.now();
        try {
            (0, workerMetrics_1.incMetric)('light_config_cache_fallback_db');
            const row = await this.fetchRow(supabase, key.brokerAccountId, key.channelId);
            (0, workerMetrics_1.observeMetric)('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted);
            const entry = this.buildEntry(row, ttl);
            if (this.enabled() && this.generation(cacheKey) === generation) {
                this.entries.set(cacheKey, entry);
                this.evictOverflow();
            }
            else {
                (0, workerMetrics_1.incMetric)('light_config_cache_stale_fill_discarded');
            }
            (0, workerMetrics_1.observeMetric)('light_config_cache_lookup_duration_ms', this.now() - started);
            return { kind: 'miss', row: cloneConfigRow(row), entry };
        }
        catch (err) {
            (0, workerMetrics_1.incMetric)('light_config_cache_error');
            this.deleteCacheKey(cacheKey);
            (0, workerMetrics_1.observeMetric)('light_config_cache_db_fallback_duration_ms', this.now() - dbStarted);
            (0, workerMetrics_1.observeMetric)('light_config_cache_lookup_duration_ms', this.now() - started);
            throw err;
        }
    }
    buildEntry(row, ttl) {
        const cachedAt = this.now();
        return {
            schemaVersion: exports.LIGHT_CONFIG_CACHE_SCHEMA_VERSION,
            cachedAt,
            expiresAt: cachedAt + ttl,
            configVersionOrUpdatedAt: row?.updated_at ?? null,
            data: cloneConfigRow(row),
        };
    }
    parseCacheKey(cacheKey) {
        try {
            const parsed = JSON.parse(cacheKey);
            if (!Array.isArray(parsed) || parsed.length !== 3)
                return null;
            const [userId, channelId, brokerAccountId] = parsed.map(v => String(v ?? '').trim());
            if (!userId || !channelId || !brokerAccountId)
                return null;
            return { userId, channelId, brokerAccountId };
        }
        catch {
            return null;
        }
    }
    generation(cacheKey) {
        return this.generationByKey.get(cacheKey) ?? 0;
    }
    bumpGeneration(cacheKey) {
        this.generationByKey.set(cacheKey, this.generation(cacheKey) + 1);
        const hadInflight = this.inflight.delete(cacheKey);
        if (hadInflight)
            this.invalidatedInflightKeys.add(cacheKey);
        return hadInflight || this.invalidatedInflightKeys.has(cacheKey);
    }
    deleteCacheKey(cacheKey, opts = {}) {
        const existed = this.entries.delete(cacheKey);
        this.identities.delete(cacheKey);
        if (!opts.preserveGeneration && !this.invalidatedInflightKeys.has(cacheKey) && !this.inflight.has(cacheKey)) {
            this.generationByKey.delete(cacheKey);
        }
        return existed ? 1 : 0;
    }
    cleanupGeneration(cacheKey) {
        this.invalidatedInflightKeys.delete(cacheKey);
        if (!this.inflight.has(cacheKey) && !this.entries.has(cacheKey)) {
            this.generationByKey.delete(cacheKey);
        }
    }
    pruneExpired() {
        const now = this.now();
        let removed = 0;
        for (const [cacheKey, entry] of Array.from(this.entries.entries())) {
            if (isWellFormedEntry(entry) && entry.expiresAt <= now) {
                removed += this.deleteCacheKey(cacheKey);
            }
        }
        if (removed > 0)
            (0, workerMetrics_1.incMetric)('light_config_cache_pruned', removed);
    }
    evictOverflow() {
        const maxEntries = this.maxEntries();
        let removed = 0;
        while (this.entries.size > maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (!oldest)
                break;
            removed += this.deleteCacheKey(oldest);
        }
        if (removed > 0)
            (0, workerMetrics_1.incMetric)('light_config_cache_evicted', removed);
    }
}
exports.LightConfigCache = LightConfigCache;
async function fetchBrokerForChannelWithLightConfigCache(cache, supabase, broker, channelId) {
    if (!channelId)
        return broker;
    if (!cache.enabled()) {
        (0, workerMetrics_1.incMetric)('light_config_cache_fallback_db');
        const started = Date.now();
        const row = await (0, brokerChannelTradingConfigs_1.fetchBrokerChannelTradingConfigRow)(supabase, broker.id, channelId);
        (0, workerMetrics_1.observeMetric)('light_config_cache_db_fallback_duration_ms', Date.now() - started);
        return row ? (0, brokerChannelTradingConfigs_1.applyBrokerChannelTradingConfigRow)(broker, row) : broker;
    }
    try {
        const result = await cache.get(supabase, {
            userId: broker.user_id,
            brokerAccountId: broker.id,
            channelId,
        });
        return result.row ? (0, brokerChannelTradingConfigs_1.applyBrokerChannelTradingConfigRow)(broker, result.row) : broker;
    }
    catch {
        const row = await (0, brokerChannelTradingConfigs_1.fetchBrokerChannelTradingConfigRow)(supabase, broker.id, channelId);
        return row ? (0, brokerChannelTradingConfigs_1.applyBrokerChannelTradingConfigRow)(broker, row) : broker;
    }
}
