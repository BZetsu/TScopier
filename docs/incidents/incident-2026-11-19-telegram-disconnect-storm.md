# Incident 2026-11-19 — Telegram disconnected 13 times in six minutes by repeated Disconnect calls

**Incident report · one customer unable to stay linked · app Disconnect path and worker session health**

| | |
|---|---|
| **Severity** | Medium — customer cannot stay connected; no money at risk |
| **Status** | Mitigated (status row corrected). Worker fixes not started |
| **Window** | 19 Nov 2026, 09:38:57 → 09:44:09 UTC (and 17 Nov 2026, 14:12:15 UTC) |
| **Customer** | Toky RAKOTOBE — `029ab2db-98ed-4abe-8704-5c09959b91b8` |
| **Component** | App Disconnect button → `telegram-auth` edge function → worker `/auth/disconnect_telegram`; `copier_listener_health` writes |
| **Root cause** | Several Disconnect calls fired within one second from the client side; two worker defects made the result worse |

## 1. Executive summary (plain English)

A customer spent the morning trying to link his Telegram account. It linked three times and was disconnected thirteen times in six minutes. The list of identical "Telegram disconnected" lines in the admin is what alarmed support, and understandably so.

Each of those lines is produced by one thing only: a call to the Disconnect action. It is not written when a connection drops, and it is not a Telegram or encryption error. In two of the bursts the calls arrived **4 times in 314 milliseconds** and **8 times in 729 milliseconds** — far faster than a person can press a button, so more than one client was acting at the same time.

We cannot yet say which client, because the logging that records the caller (IP address, browser, per-tab identifier) was switched on at **10:59 UTC**, seventy-five minutes after his last attempt. The same pattern happened on **17 November** — three calls in 21 milliseconds — so this is a repeating behaviour on the client side, not a one-off.

Two defects on our side made the aftermath confusing:

1. After the account was deliberately disconnected, the worker still tried to bring the listener back ("kicking a reconnect in background").
2. The status write that should have marked the account **not linked** was rejected as *stale ownership*, so the admin kept saying **linked** while the database held no Telegram session at all. That is what invites a customer to keep pressing Disconnect.

The account is now in a truthful state, nothing was traded and nothing is at risk. The customer must link once more, from a single tab, on a freshly loaded page.

## 2. Issue encountered

Three successful links and thirteen disconnects inside six minutes:

| Time (UTC) | Event |
|---|---|
| 09:38:09 | Link #1 (phone code), session `0fb59f03` |
| 09:38:33 | Worker stops the listener for a reconnect attempt |
| 09:38:57 | Disconnect ×1 |
| 09:42:15 | Link #2, session `beca85f1` |
| 09:42:21.818 – 09:42:22.132 | **Disconnect ×4 in 314 ms** |
| 09:43:46 | Link #3, session `3462302b` |
| 09:44:08.643 – 09:44:09.371 | **Disconnect ×8 in 729 ms** |

Same customer, two days earlier:

| Time (UTC) | Event |
|---|---|
| 17 Nov 14:12:15.581 / .592 / .601 | **Disconnect ×3 in 21 ms** |
| 18 Nov 15:27:41 | Disconnect ×1 |

Attempt counts per day: 17 Nov — 5 attempts / 1 success / 3 disconnects; 18 Nov — 2 / 1 / 1; 19 Nov — 17 / 3 / 13.

## 3. Affected user

| User | Plan | Broker | Channels | Link attempts (19 Nov) | Sessions now |
|---|---|---|---|---|---|
| Toky RAKOTOBE | basic, active | 1 connected | 2 active (kept) | 17 | **0** |

No trades were placed for this account during the window, so no position and no money were affected.

## 4. Root cause (technical)

1. **One writer, one row per call.** `telegram_link_disconnect` is written only by `disconnectTelegramSession` (`worker/src/sessionManager.ts`, ~1303–1351). It is reached only through `/auth/disconnect_telegram` (`worker/src/httpServer.ts:374`), which the app calls from the Disconnect button (`src/pages/dashboard/CopierEnginePage.tsx:373–397`, `953–955`) via the `telegram-auth` edge function. The edge function forwards with a single `fetch` and no retry, and the client wrapper has no retry either — so N rows means N separate calls.
2. **The bursts are not human input.** 4 calls in 314 ms and 8 calls in 729 ms, and 3 calls in 21 ms on 17 November. A connection drop never writes this event; drops are recorded in `copier_listener_health` (`last_disconnected_at`) and the connection trace, not in this table.
3. **Not attributable retrospectively.** The `telegram_auth_action` trace (action, client id, IP, user agent) was deployed to production at 10:59 UTC, after the last call at 09:44. There are no trace rows for this user, so the client(s) responsible cannot be named from today's data.
4. **Worker defect A — reconnect after an intentional disconnect.** At 09:42:25 the lease loop logged `listener disconnected but renewing lease anyway … kicking reconnect in background` for an account whose session had just been deleted. The reconnection cannot succeed (no session), and it races the disconnect.
5. **Worker defect B — health write rejected after disconnect.** `[copierHealth] upsert rejected (stale ownership)` at 09:38:34 and 09:43:55. The disconnect path writes `telegramAccountStatus: 'not_linked'`, but the write was refused, so the row kept `telegram_account_status = 'linked'` while `telegram_sessions` was empty. That is the state the app reads.

## 5. The fix

Applied immediately (14:23 UTC), one row:

```sql
update copier_listener_health
set telegram_account_status = 'not_linked',
    listener_status        = 'disconnected',
    copier_engine_status   = 'stopped',
    worker_ownership_status= 'unowned',
    mtproto_connected      = false,
    health_reason          = 'user_disconnected_telegram',
    updated_at             = now()
where user_id = '029ab2db-98ed-4abe-8704-5c09959b91b8';
```

Still to do (not started):

1. Make `/auth/disconnect_telegram` idempotent and debounced, so repeated calls collapse into one operation and one event row.
2. Do not reconnect a listener whose session was deleted on purpose — the lease loop must respect a deliberate stop.
3. Let the disconnect health write succeed without a lease, so `not_linked` always lands.
4. Optionally add an admin action "reset Telegram state" that clears session, pending auth, leases and health in one step.

## 6. Files changed

None in code for this incident yet. The only change is the corrected `copier_listener_health` row.

Relevant code, unchanged:

- `worker/src/sessionManager.ts` — `disconnectTelegramSession`, lease renew loop (`renewing lease anyway`)
- `worker/src/httpServer.ts` — `/auth/disconnect_telegram`
- `supabase/functions/telegram-auth/index.ts` — proxy, temporary `telegram_auth_action` trace
- `src/pages/dashboard/CopierEnginePage.tsx` — Disconnect button and `clearTelegramConnection`

## 7. Verification

After the correction:

| Check | Value |
|---|---|
| `copier_listener_health.telegram_account_status` | `not_linked` |
| `health_reason` | `user_disconnected_telegram` |
| `telegram_sessions` rows for the user | 0 (unchanged) |
| `telegram_auth_pending` rows | 0 |
| `worker_session_leases` rows | 0 |
| Telegram account claim | kept (`+26138…`) |
| Channels | 2, both active and kept |

## 8. Deployment status

The status correction is applied to production (`sxkpcovbyaficvtkpsdo`). No code deployed. The trace that will identify the calling client on the next attempt is already live in production since 10:59 UTC.

## 9. Follow-ups

1. Ask the customer to close every other tab and device, hard-refresh, then link once. Record the time.
2. On the next attempt, read `telegram_auth_action` rows for the user: one row per call with `client`, `ip`, `ua`. That names the source of any burst.
3. Raise the three worker/app fixes above as one change.
4. Consider a guard in the app: disable the Disconnect button while the call is in flight, and ignore repeat presses for a few seconds.
