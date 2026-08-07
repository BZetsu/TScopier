# Light Configuration Cache

## Purpose

The light configuration cache is a disabled-by-default feature for the trade dispatch path. It removes repeated Supabase reads for stable per-channel broker configuration while keeping execution authority live and unchanged. The same code artifact can run in staging and production; production stays on the legacy path unless configuration explicitly enables the cache after staging approval.

It is intentionally not a distributed cache and not an aggressive performance layer.

## Env

```env
LIGHT_CONFIG_CACHE_ENABLED=false
LIGHT_CONFIG_CACHE_TTL_MS=5000
LIGHT_CONFIG_CACHE_MAX_ENTRIES=1000
```

Defaults:

- `LIGHT_CONFIG_CACHE_ENABLED=false`
- `LIGHT_CONFIG_CACHE_TTL_MS=5000`
- `LIGHT_CONFIG_CACHE_MAX_ENTRIES=1000`

Invalid TTL values fail safely by disabling cache use.
Invalid max-entry values fall back to the safe default of 1000 entries.
`LIGHT_CONFIG_CACHE_ENABLED` is enabled only when the trimmed value is `true` case-insensitively. Any malformed value is disabled.
Env values are parsed with cheap primitive reads on lookup so changing `LIGHT_CONFIG_CACHE_ENABLED=false` immediately routes new dispatches to DB in a live process.

Staging enablement:

```env
LIGHT_CONFIG_CACHE_ENABLED=true
LIGHT_CONFIG_CACHE_TTL_MS=5000
LIGHT_CONFIG_CACHE_MAX_ENTRIES=1000
```

Rollback:

```env
LIGHT_CONFIG_CACHE_ENABLED=false
```

No code rollback is required.

Emergency rollback procedure:

1. Set `LIGHT_CONFIG_CACHE_ENABLED=false` on the trade worker service.
2. Redeploy/restart only if the platform requires it to apply env changes.
3. Watch `light_config_cache_fallback_db` increase and cache hit counters stop increasing.
4. Compare new dispatch behavior with the authoritative `broker_channel_trading_configs` row.

No migration rollback, cache cleanup job, DB row deletion, or manual claim cleanup is required.

## Cached Values

The cache stores only rows from `broker_channel_trading_configs` for:

- `copier_mode`
- `manual_settings`
- `ai_settings`
- `copy_limit_state`
- `updated_at`

Cached entries are versioned:

```ts
{
  schemaVersion: 1,
  cachedAt,
  expiresAt,
  configVersionOrUpdatedAt,
  data
}
```

Cache key identity:

`{ userId, channelId, brokerAccountId }`

The canonical key builder normalizes channel ids and encodes the identity as a structured value, so similar ids such as `12` and `123` do not collide. Keys include no secrets.

`configVersionOrUpdatedAt` is informational only. It helps diagnostics identify the source row freshness, but stale-fill safety is enforced by the cache generation/epoch guard.

## Explicitly Not Cached

Do not add any of these to the light config cache:

- durable dispatch claims
- idempotency state
- broker order state
- current prices
- open orders
- broker connectivity
- account balance, equity, or free margin
- kill switches
- cancellation state
- already-sent decisions
- active reconciliation state
- listener health ownership
- anything used to prove whether a trade was already sent

The implementation strips credential-like keys from cached config payloads as an additional defense.

## Dispatch Boundary

The cache wraps the repeated pre-send `broker_channel_trading_configs` lookup used to refresh per-channel broker config immediately before execution planning. With the flag off, the path uses the authoritative database read directly.

Safety-critical checks remain live:

- in-process duplicate dispatch guard
- `signalExecutionProven(...)`
- `manualDispatchAlreadyMaterialized(...)`
- `claimSignalBrokerDispatch(...)`
- broker readiness/session checks
- broker symbol/quote/order calls
- cancellation and reconciliation state
- duplicate execution proof
- durable claims and idempotency
- prices, margin, balance, and equity
- kill switches
- listener health ownership

Do not expand this cache to anything that proves an order was or was not sent.

## Multi-Worker Behavior

The cache is in-process volatile memory only.

- Worker A and worker B do not share cache entries.
- Supabase Realtime should deliver `broker_channel_trading_configs` invalidations to each relevant worker.
- If a worker misses realtime invalidation, the TTL bounds stale state.
- Worker restart starts with an empty cache and warms from DB.
- Shard or ownership movement does not copy cache state.
- The cache is never authoritative across workers and does not require a single global worker.

## Invalidation

The trade worker invalidates affected entries when it receives Supabase Realtime changes for `broker_channel_trading_configs`.

Invalidation uses exact structured identity, not substring matching:

- `INSERT`: invalidate the new `{ userId, channelId, brokerAccountId }` identity.
- `DELETE`: invalidate the old `{ userId, channelId, brokerAccountId }` identity.
- `UPDATE`: invalidate both old and new identities.

Realtime payloads do not store secrets. When the worker can resolve the broker owner from its in-memory broker cache, it invalidates the exact user/channel/broker key. If the owner is unavailable, it falls back to a bounded structured broker+channel scan of known cache identities; it still does not substring-match raw key text.

There is no new distributed invalidation subsystem. If realtime delivery is unavailable, the short TTL bounds staleness.

Each cache key also has an invalidation generation. A DB fetch captures the generation before it starts. If settings change while the fetch is in flight, invalidation increments the generation and removes the in-flight promise from the join map. The old caller may still receive its DB result, matching legacy semantics, but that result is not stored in cache and cannot resurrect invalidated config.

## Settings Changes

Any path that writes `broker_channel_trading_configs` through normal database writes should emit realtime to workers subscribed to that table:

| Change path | Expected invalidation | Fallback if realtime is missed |
|-------------|-----------------------|--------------------------------|
| Frontend account/channel settings update | Realtime UPDATE invalidates old and new identities | TTL, default 5s |
| Edge Function settings update | Realtime UPDATE invalidates old and new identities | TTL, default 5s |
| Admin/backoffice update | Realtime UPDATE invalidates old and new identities when table realtime is delivered | TTL, default 5s |
| Service-role update | Realtime UPDATE invalidates old and new identities when table realtime is delivered | TTL, default 5s |
| Direct database update | Realtime UPDATE if publication/subscription delivers it | TTL, default 5s |
| Delete/recreate | DELETE invalidates old, INSERT invalidates new | TTL, default 5s |
| Broker disconnect/delete | Related cache becomes irrelevant when broker is removed from worker broker cache; table DELETE/UPDATE invalidates when emitted | TTL, default 5s |
| Channel removal/unlink | Table DELETE/UPDATE invalidates when emitted | TTL, default 5s |

Do not describe invalidation as guaranteed instant for every operational path. The production safety bound is the configured TTL.

## Fallback

Cache behavior:

- valid hit: use cached stable config
- miss: fetch DB, validate, populate, continue
- expired: ignore, fetch DB
- malformed: ignore, count `cache_malformed`, fetch DB
- cache subsystem failure: bypass cache and fetch DB
- stale in-flight fill after invalidation: return the DB result to the caller, discard the cache fill, count `light_config_cache_stale_fill_discarded`

If the underlying DB lookup has the same failure behavior as before, that behavior is preserved.

## Concurrency

Identical concurrent lookups share one in-flight promise per cache key. Failed fetches clear the in-flight entry, so later requests can retry. Unrelated users, channels, and broker accounts do not block one another.

Invalidation during an in-flight fetch removes that in-flight promise from the join map, so a later same-key lookup can start a newer DB fetch. Older completions cannot overwrite the newer generation.

## Memory Bounds

The cache is bounded by `LIGHT_CONFIG_CACHE_MAX_ENTRIES` and defaults to 1000 entries per worker. The implementation uses deterministic insertion/recency order eviction: valid hits refresh recency, and inserting beyond the max evicts the oldest entry until the cache is within bounds.

Expired entries are pruned during get, set, and invalidation operations. There is no high-frequency timer. The in-flight map is bounded by active requests and each successful or failed promise is deleted on completion.

Rough memory expectations:

- 50 users: comfortably below the default if each has a small number of channels/brokers.
- 500 users: still bounded by 1000 entries; active hot keys stay cached, older keys evict.
- 5,000 users: cache remains capped at 1000 entries per worker, so hit rate may drop but memory does not grow indefinitely.

## Metrics

Worker metrics include:

- `light_config_cache_hit`
- `light_config_cache_miss`
- `light_config_cache_expired`
- `light_config_cache_invalidated`
- `light_config_cache_fallback_db`
- `light_config_cache_malformed`
- `light_config_cache_error`
- `light_config_cache_singleflight_join`
- `light_config_cache_stale_fill_discarded`
- `light_config_cache_evicted`
- `light_config_cache_pruned`
- `light_config_cache_lookup_duration_ms_*`
- `light_config_cache_cached_lookup_duration_ms_*`
- `light_config_cache_db_fallback_duration_ms_*`

These are counters/histogram-compatible timings only. Cache hits and misses do not emit Sentry issues.
Metrics use low-cardinality names only; user, channel, and broker ids are not labels.

Useful formulas:

- Hit rate = `light_config_cache_hit / (light_config_cache_hit + light_config_cache_miss)`
- Fallback rate = `light_config_cache_fallback_db / (light_config_cache_hit + light_config_cache_miss + light_config_cache_expired)`
- Error rate = `light_config_cache_error / (light_config_cache_hit + light_config_cache_miss + light_config_cache_expired)`

Operational review thresholds are guidance, not hard-coded alerts:

- Warning: cache error rate above 1% for 5 minutes.
- Warning: fallback rate unexpectedly high after warm-up.
- Warning: `light_config_cache_stale_fill_discarded` spikes continuously.
- Warning: hit rate near 0 for stable repeated traffic.
- Warning: realtime disconnect/invalidation gaps are sustained.
- Critical / disable cache: any confirmed stale broker/account configuration use.
- Critical / disable cache: any duplicate trade, wrong risk setting, or execution outcome change attributable to cache.
- Critical / disable cache: any cache-related exception reaches the broker hot path.

## Staging Success Criteria

Staging should use a meaningful traffic sample, not one synthetic request. Start with one internal account/channel, then a small cohort, then normal staging load.

Correctness must show:

- no duplicate trades
- zero stale broker selections
- zero stale risk-setting incidents beyond TTL
- zero claim/idempotency behavior changes
- zero kill-switch bypass
- zero broker-readiness bypass
- no cache-caused broker failures

Performance should show:

- reduced Supabase config reads on repeated same-user/channel/broker dispatch
- meaningful cache hit rate under repeated traffic
- config lookup p50 improves
- config lookup p95 does not regress
- pre-broker preparation latency does not regress

Reliability should show:

- invalidation works
- fallback works
- cache error does not affect trade execution
- `LIGHT_CONFIG_CACHE_ENABLED=false` restores the old behavior immediately
- memory stays within `LIGHT_CONFIG_CACHE_MAX_ENTRIES`

## Production Rollout

Use the same code artifact that passed staging.

1. Phase 0: deploy production code with `LIGHT_CONFIG_CACHE_ENABLED=false` and verify legacy path health.
2. Phase 1: after staging approval, enable cache with normal TTL and max entries. No code change is required.
3. Phase 2: observe hit rate, fallback, errors, stale-fill discard, invalidation, pre-broker latency, duplicate trade count, and support incidents.
4. Phase 3: keep enabled only if metrics and correctness remain clean.

Rollback at any anomaly by setting `LIGHT_CONFIG_CACHE_ENABLED=false`.

## Capacity

With `LIGHT_CONFIG_CACHE_MAX_ENTRIES=1000`:

- 50 active identities: all should fit; high hit rate is expected for repeated traffic.
- 500 active identities: all should fit under default cap.
- 1,000 active identities: cap is full; recency determines retained hot set.
- 5,000 requested identities: memory remains capped at 1,000; churn reduces hit rate and increases DB fallback, but correctness is unchanged.

Hot cache hits are O(1) map operations plus a recency refresh. Misses can prune expired entries and may evict oldest entries after insertion. Scoped invalidation scans known cache identities, which is bounded by `LIGHT_CONFIG_CACHE_MAX_ENTRIES`.

## Failure Modes

| Failure mode | Behavior |
|--------------|----------|
| Cache disabled | DB path |
| Cache hit | Cached stable config |
| Cache miss | DB path, then populate if enabled |
| Expired entry | DB path |
| Malformed entry | Delete entry, count malformed, DB path |
| Cache exception | Wrapper falls back to DB |
| Realtime invalidation missed | Stale state bounded by TTL |
| Invalidation during DB fetch | Stale completion discarded from cache |
| Cache full | Oldest/least-recent entry evicted |
| Worker restart | Empty cache, DB warm-up |
| Metrics failure | Execution unaffected by metrics design |
| DB failure | Preserve legacy DB failure semantics |

## Support Runbook

If support suspects caching:

1. Check whether `LIGHT_CONFIG_CACHE_ENABLED=true`.
2. Review hit, miss, fallback, expired, error, invalidated, and evicted metrics.
3. Check `light_config_cache_stale_fill_discarded`.
4. Compare recent `broker_channel_trading_configs.updated_at` with the signal time.
5. Reproduce or observe the next signal with `LIGHT_CONFIG_CACHE_ENABLED=false`.

Immediate mitigation is `LIGHT_CONFIG_CACHE_ENABLED=false`. Then compare execution before/after disable, the DB config row, and worker metrics/logs. Do not delete DB rows or manually clear claims as a cache mitigation.

## Security And Privacy

The cache is process-local volatile memory and stores no persisted cache state. Cache keys contain no secrets. Cache values are limited to the audited `broker_channel_trading_configs` subset and defensively strip credential-like nested keys.

The cache must not contain broker passwords, API keys, access tokens, Telegram sessions, Supabase secrets, raw Telegram messages, raw broker payloads, account balances, equity, or margin. Metrics do not use user, channel, or broker ids as labels.

## Invariants

1. Cache off equals legacy behavior.
2. Durable claims are never cached.
3. Idempotency is never cached.
4. Broker order state is never cached.
5. Kill switch remains live.
6. Broker readiness remains live.
7. Cache failure falls back safely.
8. Stale cache never survives beyond TTL.
9. Known settings changes invalidate immediately where realtime is available.
10. In-flight fetches from an older generation never repopulate cache after invalidation.
11. Cache memory remains bounded by `LIGHT_CONFIG_CACHE_MAX_ENTRIES`.
12. Cache never changes trade outcome semantics.
13. Cache never causes duplicate dispatch.
14. Cache never stores credentials or sensitive broker/session data.
15. The same code can run staging and production; enablement is configuration only.
16. Production deploy with the flag off preserves legacy behavior.
17. No migration or persisted state is required for cache operation.
18. Multi-worker behavior is safe without shared memory.
