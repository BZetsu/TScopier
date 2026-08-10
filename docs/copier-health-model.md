# Copier Health Model

The dashboard copier status is server-authoritative. It no longer treats a fresh `worker_session_leases` row or a `telegram_sessions` row as proof that the live Telegram listener is connected and ready.

## Current Flow Before This Change

- Worker ownership lived in `worker_session_leases`.
- Telegram linkage lived in `telegram_sessions`.
- Worker `/health` reported in-process listener status, but the dashboard did not query that per user.
- `src/lib/listenerLeaseStatus.ts` read only lease freshness, and `CopierStatusCard` used session-row existence for Telegram "Online".

That meant the UI could show "Copier engine: Live" and "Telegram: Online" while MTProto was reconnecting, disconnected, failed, or not processing signals.

## Source Of Truth

`public.copier_listener_health` is the safe user-readable health table. It is written by worker/service-role code through `upsert_copier_listener_health(...)` and read by authenticated users only for their own `user_id`.

Stored fields are status metadata only: listener state, worker id/role/shard, ownership epoch, lease acquisition timestamp, probe timestamps, reconnect/recovery flags, freshness threshold, and a stable reason. It does not store Telegram session strings, phone numbers, credentials, broker responses, balances, raw messages, signal payloads, or order lists.

## State Model

Telegram account:

- `not_linked`
- `linked`
- `invalid`
- `reconnect_required`
- `unknown`

Signal listener:

- `connected`
- `reconnecting`
- `disconnected`
- `failed`
- `unknown`

Worker ownership:

- `owned`
- `lease_expiring`
- `unowned`
- `stale`
- `unknown`

Copier engine:

- `operational`: linked account, owned listener, connected Telegram listener, connected MTProto, fresh health row, recent successful probe, not shutting down, and no exhausted recovery.
- `degraded`: owned listener with reconnect in progress or a recent disconnect within grace.
- `offline`: missing/stale/unowned listener, disconnected beyond grace, startup failed.
- `stopped`: user disconnected Telegram, session invalid/reconnect required, worker shutdown, or copying intentionally paused.
- `unknown`: migration/row not available yet.

## Transitions

Worker writes occur on meaningful transitions:

- listener startup and successful connection;
- watchdog probe success/failure;
- reconnect start, reconnect success, reconnect exhaustion;
- malformed RPC or duplicate-auth recovery exhaustion;
- lease acquisition failure;
- listener stop/shutdown;
- user Telegram disconnect;
- session invalidation.

Writes are coalesced. Unchanged state is suppressed for about 30 seconds, and heartbeat/probe timestamps are bounded to avoid high-frequency database writes. Health write failures are swallowed and never disconnect Telegram or block trading.

`last_successful_probe_at` is updated only after positive listener/MTProto health confirmation, such as a successful watchdog poll or reconnect. Lease renewal alone does not refresh probe freshness.

## Stale Rows And CAS Writes

Operational rows expire unless both `updated_at` and `last_successful_probe_at` are recent. The freshness threshold written by the worker is:

```text
max(COPIER_HEALTH_OFFLINE_GRACE_MS, 3 * 30000ms probe interval)
```

With defaults, this is 90000ms. The frontend uses the persisted `freshness_threshold_ms` value from the worker, so UI evaluation does not drift from worker semantics. Missing, malformed, or far-future timestamps fail closed and never display Operational.

Health writes are ownership-aware. Each listener instance publishes an `ownership_epoch` equal to its lease acquisition timestamp plus `lease_acquired_at`. The service-role RPC verifies the caller still owns the active `worker_session_leases` row before accepting owned-health updates. If another worker now owns the user, or an older ownership epoch attempts a late update without current ownership, the RPC returns `false`; the worker records a safe breadcrumb, stops treating the write as authoritative, and does not disconnect Telegram or stop trading.

## Grace Period

`COPIER_HEALTH_OFFLINE_GRACE_MS` defaults to `60000`. Invalid values fall back to 60 seconds.

Within grace, a disconnected listener with a recent successful probe is shown as reconnecting/degraded. A connected listener with a stale probe is degraded only during the freshness-plus-grace allowance, then becomes offline. Beyond grace, disconnected listeners become offline. Auth/session-invalid states become reconnect-required/stopped immediately. Transient listener recovery exhaustion, such as repeated malformed GramJS RPC results, is failed/offline while the Telegram account remains linked; users should only be told to reconnect Telegram when auth/session invalidation is proven.

## UI Copy

Normal dashboard copy avoids internal terms such as MTProto, lease, shard, worker ownership, or heartbeat.

- Operational: "Copier is ready and listening for signals."
- Reconnecting: "Telegram is reconnecting. New signals may be delayed."
- Offline: "Signal listener is offline. Trades may not copy until it reconnects."
- Reconnect required: "Telegram connection expired. Reconnect Telegram to resume copying."
- Stopped: "Copying is stopped for this account."

The card also shows the last successful health timestamp and a refresh action.

## Sentry Alerts

Copier-health business events emit only when user impact is meaningful and after grace where applicable:

- `copier_engine_offline`
- `telegram_listener_failed`
- `telegram_recovery_exhausted`
- `listener_ownership_lost`
- `listener_health_stale`

Normal reconnect success, probes, and lease renewals do not emit issues. Repeated offline states are cooldown-limited by stable reason/category. For one underlying listener incident, prefer one issue-level event and use breadcrumbs or health state for secondary stage transitions.

## Deployment

1. Apply the additive migration `20260806120000_copier_listener_health.sql`.
2. Deploy worker code so service-role CAS writes begin populating health rows.
3. Deploy frontend code that reads the new table.

Missing rows display unknown/checking safely for existing users until their listener next transitions or probes.

## Rollback

Rollback frontend to the previous status card if necessary. Worker writes are best-effort and additive. The table can remain in place for audit/troubleshooting; dropping it is not required for runtime rollback.

## Support Troubleshooting

1. Check the user's `copier_listener_health` row.
2. If `telegram_account_status=reconnect_required`, ask the user to reconnect Telegram.
3. If `listener_status=reconnecting` and `updated_at` is recent, wait through the grace period and refresh.
4. If `copier_engine_status=offline`, inspect worker logs and Sentry for matching `copier_engine_offline` or `telegram_listener_failed`.
5. Cross-check `worker_session_leases` only for ownership evidence; do not treat it as proof of connectivity.

Sentry does not replace database state, audit logs, or broker reconciliation.
