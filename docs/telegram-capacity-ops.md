# Telegram capacity — shard, deploy, and alert playbook

Telegram does not publish a “N UniCopier users” quota. Practical capacity is limited by:

1. **One live MTProto connection per auth key** — a second connect yields `AUTH_KEY_DUPLICATED` (often later `AUTH_KEY_UNREGISTERED`).
2. **Per-account / per-DC rate limits (`FLOOD_WAIT`)** — dialogs, history poll, resolve-username, catch-up, and reconnect storms share one RPC budget per session.
3. **Our architecture** — one Railway listener process holds every active GramJS client on its shard. There is no coded `MAX_SESSIONS`.

Scale path is **more shards** (partition users), never more replicas of the same shard.

Related: [railway-architecture.md](./railway-architecture.md), [worker-deployment.md](./worker-deployment.md), [staging-shard-fleet.md](./staging-shard-fleet.md), [copier-health-model.md](./copier-health-model.md).

## Hard deploy rules

| Rule | Why |
|------|-----|
| Exactly **1 replica** per `WORKER_SHARD_ID` listener | Two processes → `AUTH_KEY_DUPLICATED` |
| Set `TELEGRAM_SHUTDOWN_DRAIN_MS` (e.g. 8000) | Overlapping deploys must drain GramJS before the new replica claims the same auth key |
| Match `WORKER_SHARD_ID` / `WORKER_SHARD_COUNT` on listener **and** trade workers | Wrong shard → silent miss / wrong live gate |
| Prefer rolling one shard at a time | Limits reconnect/flood storms |

Never scale a listener service horizontally for the same shard. Add `listener-shard-N` services instead.

## When to add shards

Measure load on the current shard (`WORKER_SHARD_COUNT=1` today in production means all users in one process):

| Signal | Action |
|--------|--------|
| Sustained `FLOOD_WAIT` in listener logs / high flood backoff | Split users: raise `WORKER_SHARD_COUNT`, add one replica per new shard id |
| Listener `/health` `ok:false` for many users, or OOM / restart loops | Shard or reduce poll pressure; check quiet-channel / flood session backoff |
| Reconnect storms after deploy | Confirm drain + single replica; pause further deploys until AUTH_KEY_DUP falls |
| Session×channel count climbing while RPC latency rises | Plan shard fleet (see staging pilot) before production OOM |

Pilot pattern: [staging-shard-fleet.md](./staging-shard-fleet.md) (`WORKER_SHARD_COUNT=4`, one listener + trade entry per index).

## FLOOD_WAIT pressure

Worker already budgets polls (`floodSleepThreshold`, `TELEGRAM_FLOOD_*`, fast-poll batching, quiet-channel backoff, channel resolve cooldown in `userListener.ts`). Ops response:

1. Confirm floods are not from dual replica / deploy overlap.
2. Check for catch-up storms (many inactive channels, history reconcile).
3. If a single process is at budget, **shard** rather than raising poll frequency.
4. Avoid restarting the whole listener fleet at once.

## AUTH_KEY_DUP pressure

| Cause | Mitigation |
|-------|------------|
| Two listener replicas same shard | Set max replicas = 1 |
| Deploy without drain | Keep `TELEGRAM_SHUTDOWN_DRAIN_MS`; wait for old process exit |
| Manual second worker with same session | Never run local listener against production sessions while Railway holds them |
| User logged in elsewhere with same auth key export | Rare; may need re-link after `AUTH_KEY_UNREGISTERED` |

After a spike: users may need **Reconnect Telegram** if status is `reconnect_required` / UNREGISTERED. Do not “heal” by restarting two replicas.

## Alerting (recommended)

Page or high-priority notify when:

1. **Lease fresh + MTProto down** — `worker_session_leases` not expired **and** `copier_listener_health.mtproto_connected = false` (or stale `last_successful_probe_at`) lasting **>60s** for many users.
2. **`AUTH_KEY_DUPLICATED` spike** — listener metrics / Sentry / log rate above baseline during or after deploy.
3. **Listener `/health` `ok:false`** for a large fraction of `detail[]` users.
4. **Trade skips** `telegram_listener_not_live` rising while UI still shows Linked (should now show Linked, not receiving).

Lease renew intentionally continues while disconnected (ownership). Alerts and UI must key off **health/probe**, not lease alone. Trade gate `WORKER_REQUIRE_TELEGRAM_LIVE_FOR_TRADES` requires lease **and** probe-fresh MTProto health.

## Checklist before production shard rollout

1. Staging fleet green with same `WORKER_SHARD_COUNT` on listener + trade ([staging-shard-fleet.md](./staging-shard-fleet.md)).
2. `TRADE_WORKER_SHARD_URLS` length matches count; Edge `LISTENER_SHARD_URLS` set in the same order; listener routes by user hash.
3. One replica per shard service; drain enabled.
4. Dashboards for FLOOD_WAIT, AUTH_KEY_DUP, `/health` ok rate, linked-not-receiving count.
5. Run `node scripts/diagnostics/shard_fleet_check.mjs` against staging URLs.
6. Support runbook updated: [telegram-silent-disconnect-support.md](./telegram-silent-disconnect-support.md).
