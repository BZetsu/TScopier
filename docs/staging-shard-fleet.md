# Staging shard fleet (WORKER_SHARD_COUNT=4 pilot)

Pilot horizontal sharding before scaling to 10k users. Use **staging Supabase** and **staging Railway** services only.

Related: [worker-deployment.md](./worker-deployment.md), [telegram-capacity-ops.md](./telegram-capacity-ops.md), [telegram-silent-disconnect-support.md](./telegram-silent-disconnect-support.md).

## Architecture

```text
Edge (telegram-auth, signal-reconcile-sweep)
        │  LISTENER_SHARD_URLS[hash(user)%N]
        ▼
listener-shard-0..3  (WORKER_ROLE=listener, 1 replica each)
        │
        │ TRADE_WORKER_SHARD_URLS (4 URLs, ordered 0..3)
        ▼
trade-entry-shard-0..3  (WORKER_ROLE=trade_entry, 1 replica each)
trade-mgmt-shard-0..3   (WORKER_ROLE=trade_mgmt, optional TRADE_MGMT_WORKER_SHARD_URLS)
```

User routing: `hash(user_id) % N` on listener, trade, and Edge (`supabase/functions/_shared/workerShard.ts` must match worker `shardForUserId`).

## Listener env (per shard)

Create 4 Railway services from the same worker image:

```env
WORKER_ROLE=listener
WORKER_SHARD_ID=0          # 0, 1, 2, or 3 per service
WORKER_SHARD_COUNT=4
WORKER_INTERNAL_TOKEN=<shared-secret>

TRADE_WORKER_SHARD_URLS=https://trade-entry-shard-0.up.railway.app,https://trade-entry-shard-1.up.railway.app,https://trade-entry-shard-2.up.railway.app,https://trade-entry-shard-3.up.railway.app
TRADE_WORKER_SHARD_COUNT=4
# Optional management fleet (same count as trade entry):
# TRADE_MGMT_WORKER_SHARD_URLS=https://trade-mgmt-shard-0.up.railway.app,...,https://trade-mgmt-shard-3.up.railway.app
# Or single mgmt until sharded:
TRADE_MGMT_WORKER_URL=https://trade-mgmt-shard-0.up.railway.app

TRADE_SIGNAL_PUSH_ENABLED=true
TRADE_SIGNAL_PUSH_MAX_ATTEMPTS=3
TELEGRAM_SHUTDOWN_DRAIN_MS=8000
```

Startup validates `TRADE_WORKER_SHARD_URLS.length === TRADE_WORKER_SHARD_COUNT === WORKER_SHARD_COUNT` — mismatch exits with FATAL. Also FATAL if `WORKER_SHARD_ID >= WORKER_SHARD_COUNT`.

## Trade entry env (per shard)

```env
WORKER_ROLE=trade_entry
WORKER_SHARD_ID=0          # match listener partition index
WORKER_SHARD_COUNT=4
WORKER_INTERNAL_TOKEN=<shared-secret>
WORKER_REQUIRE_TELEGRAM_LIVE_FOR_TRADES=true
EXECUTOR_REALTIME_SIGNALS=false
MT4API_HTTP_CONNECTIONS=128
```

## Trade management env (per shard, preferred when fleet is live)

```env
WORKER_ROLE=trade_mgmt
WORKER_SHARD_ID=0
WORKER_SHARD_COUNT=4
WORKER_INTERNAL_TOKEN=<shared-secret>
EXECUTOR_REALTIME_SIGNALS=false
```

## Edge / Supabase secrets (staging project)

Set on the Edge Function secrets (same project the app uses):

| Secret | Value |
|--------|--------|
| `WORKER_INTERNAL_TOKEN` | Same as Railway workers |
| `LISTENER_SHARD_URLS` | Comma-separated listener bases in shard-id order (0..N-1) |
| `TELEGRAM_LISTENER_URL` | Optional fallback when fleet unset (single listener) |
| `TRADE_WORKER_SHARD_URLS` | Same ordered list as listener trade push (for TV / override) |
| `TRADE_MGMT_WORKER_SHARD_URLS` | Optional mgmt fleet |
| `TRADE_WORKER_URL` / `TRADE_MGMT_WORKER_URL` | Single-URL fallbacks |

`telegram-auth` picks `LISTENER_SHARD_URLS[hash(user)]`. `signal-reconcile-sweep` routes each user to their owning listener. Auth on the wrong shard returns `reason: wrong_shard`.

## Verification checklist

1. **Startup** — each listener shard logs no FATAL shard URL / bounds errors.
2. **Health** — `curl https://listener-shard-0/health` shows only users where `hash(user_id)%4==0`.
3. **Routing** — post test signal; listener logs show push to correct trade-entry URL index.
4. **Wrong shard** — dispatch to shard-0 with user on shard-2 returns `accepted: false, reason: wrong_shard`. Auth via wrong listener returns `wrong_shard`.
5. **Diagnostic** — `node scripts/diagnostics/shard_fleet_check.mjs --user-id … --listener-urls … --trade-urls … --token …`
6. **Load** — run [`scripts/load/burst-dispatch.mjs`](../load/burst-dispatch.mjs) against each trade-entry URL.

## Scaling beyond 4

Increase `WORKER_SHARD_COUNT` on **all** listener and trade services together. Append new URLs to `TRADE_WORKER_SHARD_URLS`, `LISTENER_SHARD_URLS`, and (if used) `TRADE_MGMT_WORKER_SHARD_URLS` in shard-id order. Never run two replicas with the same `WORKER_SHARD_ID`.
