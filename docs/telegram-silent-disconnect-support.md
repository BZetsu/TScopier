# Support: Telegram shows Connected but no trades

Users often report “Telegram is connected” while signals/trades are missing. **Connected in the product now means MTProto-ready** (`copier_listener_health`: `listener_status=connected`, `mtproto_connected=true`, fresh `last_successful_probe_at`). A fresh **lease** alone is ownership, not liveness.

Also see [telegram-copier-triage.md](./telegram-copier-triage.md), [copier-health-model.md](./copier-health-model.md), [telegram-capacity-ops.md](./telegram-capacity-ops.md).

## Quick path

1. **Listener `/health`** — is `user_id` present and `connected: true`?
2. **SQL** — `telegram_sessions`, `worker_session_leases`, `copier_listener_health`.
3. Branch on the tables (below).
4. If socket is live but no trades — channels, peers, floods, brokers, subscription/pause.

## 1. Listener `/health`

```bash
curl -sS "https://YOUR-LISTENER.up.railway.app/health" | jq .
# or filter one user:
curl -sS "https://YOUR-LISTENER.up.railway.app/health" | jq --arg u USER_UUID \
  '.detail[]? | select(.user_id == $u)'
```

| Result | Meaning |
|--------|---------|
| User missing from `detail` | Not on this shard / no session / wrong shard |
| `connected: false` | MTProto down — UI should show offline / linked-not-receiving / reconnecting |
| `connected: true` | Socket up; dig into channels / trade worker if still no copy |

Confirm `WORKER_SHARD_ID` / `WORKER_SHARD_COUNT` match the user’s partition if multi-shard.

## 2. SQL checks

Replace `:user_id`.

```sql
-- Session (must exist to be on the listener)
select user_id, updated_at, last_event_at, listener_status
from public.telegram_sessions
where user_id = :user_id;

-- Lease = ownership only (can be fresh while MTProto is down)
select user_id, worker_id, role, expires_at, updated_at
from public.worker_session_leases
where user_id = :user_id;

-- Truth for Connected / trade live gate
select
  user_id,
  telegram_account_status,
  listener_status,
  copier_engine_status,
  mtproto_connected,
  last_successful_probe_at,
  updated_at,
  freshness_threshold_ms,
  health_reason,
  recovery_exhausted,
  shutdown_in_progress
from public.copier_listener_health
where user_id = :user_id;
```

Probe freshness: `now() - last_successful_probe_at` should be within `freshness_threshold_ms` (typically ~90s).

## 3. Decision table

| Finding | User-facing action |
|---------|-------------------|
| No `telegram_sessions` row | **Reconnect Telegram** (link again). Not on listener at all. |
| `telegram_account_status` in (`reconnect_required`, `invalid`) or AUTH UNREGISTERED | Re-link: terminate other Telegram sessions if needed, wait, login again |
| Lease fresh, `mtproto_connected=false` or stale probe | “Linked, not receiving” — wait for heal / Refresh; if stuck, Reconnect Telegram. Do **not** treat lease as Online |
| `/health` connected, health operational, no signals | Check channel `is_active`, peer resolve, FLOOD_WAIT, inactive CHANNEL_INVALID |
| Health live, signals in DB, no broker trades | Brokers, subscription, copier pause, trade worker, `telegram_listener_not_live` skips |
| `AUTH_KEY_DUPLICATED` in logs around deploy | Ops: dual replica / drain — see capacity ops; user may need re-link if key invalidated |

## 4. Connected ≠ copying

Even with a live socket:

- Flood backoff can pause polls.
- Peer resolve failures skip channels.
- Subscription / pause / trade gate can skip while badges catch up (gate now uses probe-fresh health when `WORKER_REQUIRE_TELEGRAM_LIVE_FOR_TRADES=true`).

## 5. What not to tell the user

- Do not say “you’re Online” based only on `worker_session_leases.expires_at`.
- Do not restart a second listener replica “to fix” disconnects — that causes AUTH_KEY_DUP.
