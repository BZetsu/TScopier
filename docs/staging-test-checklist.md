# Staging Test Checklist

**Current build:** `964152e3` (Jul 28, dev = staging)
**Staging listener:** `https://tscopier-worker-staging.up.railway.app`
**Staging Supabase:** `axdcledcyhyvzrnfkwat`

## Quick Reference

| Test | Section | Duration | Risk | Automation |
|---|---|---|---|---|
| AUTH_KEY_DUPLICATED recovery | #1 | 5 min | Critical | Manual |
| BinaryReader crash guard | #2 | 20 min | Critical | Manual |
| CHANNEL_INVALID auto-disable | #3 | 5 min | High | Manual |
| Realtime subscription reconnect | #4 | 30 min | High | Manual |
| Scale load (62 sessions) | #5 | 4 hours | Critical | Log monitoring |
| Martin: basket layering | #6 | 30 min | High | Manual |
| Martin: trade reconciliation | #7 | 30 min | Medium | Manual |
| Martin: ensureSignalRow | #8 | 30 min | Medium | Manual |
| Martin: SL/TP validation | #9 | 15 min | Medium | Manual |
| Martin: order close audit | #10 | 15 min | Low | Manual |
| Martin: purge cron | #11 | 15 min | High | Manual |
| Martin: frontend UI | #12 | 15 min | Low | Visual |
| Production rollout smoke | #13 | 2 hours | Critical | Log monitoring |

---

## How simulation works on staging

**Staging has:** 3 real Telegram sessions + 59 synthetic (blank session string) = 62 total.

- **Real sessions** connect to Telegram, poll channels, process signals. Use these for behavioral tests.
- **Synthetic sessions** fail to connect (invalid session). They exercise: startup, lease acquisition, error handling, retry loops, lease renewal. Use these for scale tests.

**To force a Railway redeploy** (triggers new connections):
```bash
# Trigger Railway deploy (any push to staging branch triggers auto-deploy)
git push upstream staging
# Or use Railway CLI/dashboard to trigger manual redeploy
```

**To view logs:**
```bash
# Railway dashboard → listener service → logs
# Or Supabase query:
SELECT * FROM listener_events WHERE created_at > now() - interval '1 hour' ORDER BY created_at DESC;
```

---

## 1. AUTH_KEY_DUPLICATED recovery (Section 2)

### What we're testing
- SIGTERM handler drains all 62 connections with 30s timeout
- New worker waits before reconnecting (no TCP race)
- Max retry limit (10 cycles) prevents infinite reconnect loops
- `releaseOwnedSessionLeases()` cleans up orphaned leases

### How to trigger
1. Check current Uptime on Railway (listener service)
2. Force a Railway deploy (push to staging or click Redeploy in Railway dashboard)
3. The old worker receives SIGTERM, new worker starts immediately

### What to check in logs

```
# EXPECTED — graceful disconnect on old worker:
[telegram-conn] event=disconnect_start ... source=shutdown
[telegram-conn] event=disconnect_complete ... source=shutdown
[telegram-conn] event=session_lease_released ... user=<id>

# EXPECTED — new worker connects cleanly:
[telegram-conn] event=connect_start ... attempt=1
[telegram-conn] event=recovery_complete ... source=connect

# SHOULD NOT SEE — no AUTH_KEY_DUPLICATED errors:
# [telegram-conn] event=auth_key_duplicated  ← FAIL
```

### Pass criteria
- [ ] Zero `AUTH_KEY_DUPLICATED` errors in first 2 minutes after deploy
- [ ] All 3 real sessions reconnect within 30s
- [ ] Drain timeout log shows ≥30s (not truncated by `Math.min(10_000, ...)`)
- [ ] `listOwnedActiveLeases` returns 0 unresolved after shutdown

### Fail criteria
- Any AUTH_KEY_DUPLICATED log entries → Section 2 fix not working
- Real sessions not reconnecting after 60s → drain/reconnect timing wrong

---

## 2. BinaryReader crash guard (Section 3)

### What we're testing
- Patch at `telegram+2.26.22.patch` guards both BinaryReader sites
- Raw error fallback catches `readUInt32LE` / `Cannot read properties of undefined`
- `noteMalformedRpcResult` triggers reconnect (rate-limited)

### How to trigger
**Cannot force easily** (probabilistic — Telegram sends garbled data). Instead:

1. Verify patch is applied:
```bash
# On Railway listener, exec into container:
node -e "require('telegram/network/MTProtoSender')"
# Check patch markers in logs: startup should log patch verification
```

2. Monitor for natural occurrence (wait for Telegram to send malformed data)

### What to check in logs
```
# EXPECTED if patch triggers:
[userListener] malformed Telegram RPC result for user-xxx (1/10) — reconnecting
[telegram-conn] event=malformed_rpc_result_detected ... error=GRAMJS_MALFORMED_RPC_RESULT
[telegram-conn] event=disconnect_start ... source=malformed_rpc_result
[telegram-conn] event=recovery_complete ... generation=2

# SHOULD NOT SEE:
# readUInt32LE: Cannot read properties of undefined  ← patch not working (but caught by fallback)
```

### Pass criteria
- [ ] Patch applied on startup (check `--check` output or log markers)
- [ ] If malformed RPC occurs: reconnect happens within 5s, `consecutiveMalformedRpcs` increments
- [ ] After 10 consecutive: session invalidated (not stuck in retry loop)

### Fail criteria
- BinaryReader crashes reaching `console.error` without reconnect
- `noteMalformedRpcResult` not rate-limiting (flood of reconnects)

---

## 3. CHANNEL_INVALID auto-disable (Section 4)

### What we're testing
- Map tracks consecutive failures per channel
- After 5 (configurable) → `is_active=false`, removed from monitored set
- `channel_auto_disabled` event emitted
- Successful poll resets counter
- Stale usernames (USERNAME_NOT_OCCUPIED) treated same as CHANNEL_INVALID

### How to trigger

**Option A — Remove bot from a channel (real):**
1. Pick a real staging Telegram session
2. Go to a channel it monitors and remove the bot (`/kick @yourbot`)
3. Wait for next poll cycle (3-10s)
4. Should see consecutive failures

**Option B — Rename channel:**
1. Rename a channel the bot has joined (old username becomes invalid)
2. `ensureJoinedPublicChannel` gets `USERNAME_NOT_OCCUPIED`
3. Counter starts incrementing

### What to check in logs
```
# EXPECTED — first failure:
[userListener] channel_invalid_detected user=user-a channel=row-1 count=1/5 source=poll_peer_resolve code=CHANNEL_INVALID

# EXPECTED — after 5 failures:
[userListener] channel_auto_disabled user=user-a channel=row-1 count=5 code=CHANNEL_INVALID

# EXPECTED — in DB:
SELECT is_active FROM telegram_channels WHERE id = 'row-1';
# → false
```

### Pass criteria
- [ ] Counter increments 1..5 on consecutive failures
- [ ] At 5: DB update `is_active=false`, `updated_at` set
- [ ] `auto_disabled` event in `listener_events`
- [ ] Listener stops polling (no more `poll_peer_resolve_failed` for this channel)
- [ ] USERNAME_NOT_OCCUPIED counts toward same counter
- [ ] After disabling: re-enabling via UI (`is_active=true`) resets counter
- [ ] TIMEOUT errors do NOT count as CHANNEL_INVALID

### Fail criteria
- Counter stops before 5 (reset incorrectly)
- Channel keeps polling after disable
- `is_active` not updated in DB
- TIMEOUT counted as CHANNEL_INVALID

---

## 4. Realtime subscription reconnect (Section 5)

### What we're testing
- On CLOSED/CHANNEL_ERROR: `this.channelChannel = null`, retry after 5s
- 60s health-check timer re-subscribes if reference is null
- `stopRealtimeHealthCheck()` called during shutdown

### How to trigger

**Option A — Wait for natural WebSocket drop:**
Supabase WebSocket drops every 20-40 min. Wait and monitor.

**Option B — Force by restarting Supabase realtime (if possible):**
In Supabase dashboard → Database → Realtime → toggle publication off/on.

### What to check in logs
```
# EXPECTED — subscription active:
[sessionManager] Realtime telegram_channels subscription active

# EXPECTED — on drop (should auto-recover in 5s):
[sessionManager] Realtime telegram_channels subscription CHANNEL_ERROR — retrying in 5s
# ...5s later...
[sessionManager] Realtime telegram_channels subscription active

# EXPECTED — health check every 60s (only fires if recovery missed):
[sessionManager] Health check: telegram_channels subscription missing — re-subscribing
```

### Pass criteria
- [ ] After CLOSED/CHANNEL_ERROR: subscription reconnects within 5s
- [ ] No "subscription active" → silence → never reconnects pattern
- [ ] Health check timer doesn't fire (or fires rarely) — means 5s retry is working
- [ ] On shutdown: `stopRealtimeHealthCheck()` runs, no interval leaks

### Fail criteria
- Subscription stays dead after CLOSED/CHANNEL_ERROR
- Health check fires repeatedly (5s retry not working)
- Timer leaks on shutdown (interval keeps firing after disconnect)

---

## 5. Scale load with 62 sessions (Section 6)

### What we're testing
- Session manager starts 62 listeners without crashing
- Lease system handles 62 concurrent leases
- Memory and CPU stable over hours
- 3 real sessions process signals normally
- 59 synthetic sessions fail gracefully (invalid session)
- Entity cache warmup at scale
- Realtime subscription handling with 170 channel changes

### How to test
1. Ensure 59 synthetic sessions + 3 real sessions are in staging Supabase:
```sql
-- Check synthetic sessions exist
SELECT COUNT(*) FROM telegram_sessions WHERE session_string = '';
-- Should be 59

-- Check real sessions exist
SELECT COUNT(*) FROM telegram_sessions WHERE session_string != '';
-- Should be 3

-- Check total channels
SELECT COUNT(*) FROM telegram_channels WHERE is_active = true;
-- Should be ~170
```

2. Restart the Railway listener
3. Monitor for 4 hours

### What to check in logs
```
# EXPECTED — synthetic sessions fail gracefully:
[sessionManager] Failed to start listener for user-synthetic-1: ...
# (no crash, no stack trace flood)

# EXPECTED — real sessions connect:
[sessionManager] Started listener for user-<real-id>

# EXPECTED — channel polling runs at scale:
[userListener] polled N channels in Xms

# SHOULD NOT SEE:
# FATAL ERROR, heap OOM, MaxListenersExceededWarning
```

### Pass criteria (4-hour window)
- [ ] All 62 sessions processed through `loadAll()` without exception
- [ ] 3 real sessions show `SUBSCRIBED` in logs
- [ ] Channel polling logs show 62 sessions × multiple channels
- [ ] CPU stays <50% (baseline on staging)
- [ ] Memory stays stable (no leak — flat line after 30 min warmup)
- [ ] No heap warnings or `MaxListenersExceededWarning`
- [ ] No `ETIMEDOUT` or connection pool exhaustion
- [ ] Lease renewal cycles complete for all 62

### Fail criteria
- Listener startup crash (loadAll throws uncaught error)
- Memory grows linearly over 4h (leak)
- Real sessions disconnect mid-test
- Supabase connection pool exhaustion (too many concurrent queries)

---

## 6. Martin: Basket layering — flat basket purge (commits 03d21caf, 5ed2571c)

### What we're testing
- `shouldLockBasketLayering` returns `basket_fully_closed` for flat baskets with history
- Layer-till-close no longer prevents purge on flat baskets
- Pre-claim stale check prevents re-opening closed baskets
- `purgeRangePendingLegsForBaskets` cleans up ladder data on flat baskets

### How to test
Requires real staging trades or a test basket:
1. Trigger a trade signal on a real staging channel
2. Let the basket open and layer
3. Close all trades in the basket
4. Send another signal for the same channel

### What to check
```
# EXPECTED — basket fully closed detected:
[VirtualPendingMonitor] shouldLockBasketLayering: basket_fully_closed

# EXPECTED — ladder rows purged:
[purgeRangePendingLegsForBaskets] purged N legs for basket <id>

# EXPECTED — pre-claim stale check blocks re-open:
[fireLeg] stale basket <id> — skipping leg claim

# SHOULD NOT SEE:
# Ladder rows firing for a fully closed basket (re-opening trades)
```

### Pass criteria
- [ ] Flat basket with history: `shouldLockBasketLayering` returns `basket_fully_closed`
- [ ] `purgeRangePendingLegsForBaskets` called on close
- [ ] No phantom re-entries from stale ladder rows
- [ ] Layer-till-close ON does NOT prevent purge on flat baskets

### Fail criteria
- Flat basket re-opens via ladder rows
- Layer-till-close blocks purge on flat baskets (old bug reappears)
- Active basket's ladder rows incorrectly purged

---

## 7. Martin: Trade reconciliation — empty OpenedOrders guard (commit 5dd36c5b)

### What we're testing
- `reconcileOpenTradesForBroker` defers ghost-close when `OpenedOrders` returns empty
- Prevents mass-close during FxSocket session disconnect
- `stripInvalidStopsForSide` drops SL/TP too close to reference

### How to test
Hard to simulate without FxSocket. Validation options:
1. Code review of `reconcileOpenTradesForBroker` guard
2. Verify `copyLimitFlatten.ts` logging integration

### Pass criteria
- [ ] Code review: empty `OpenedOrders` does NOT trigger mass ghost-close
- [ ] Code review: `minDistance` in `stripInvalidStopsForSide` is reasonable (1e-4 × ref)

---

## 8. Martin: ensureSignalRow — signal persistence (commit 186c8d1c)

### What we're testing
- Signal row exists before FK-dependent writes (trades, execution_logs)
- Retry loop on FK violation
- `persist_before_dispatch` flag set to true

### How to test
Send a real trade signal through a staging channel:
1. Post a signal in a staging-monitored Telegram channel
2. Wait for signal processing

### What to check
```
# EXPECTED:
[ensureSignalRow] ensured signal <uuid>
[dispatch] dispatching signal <uuid> with persist_before_dispatch=true

# In DB:
SELECT * FROM signals WHERE id = '<uuid>';  -- should exist
SELECT * FROM trade_execution_logs WHERE signal_id = '<uuid>';  -- FK valid
```

### Pass criteria
- [ ] Signal row created before dispatch
- [ ] No FK violation errors in logs
- [ ] Retry loop not triggered (first attempt succeeds)

---

## 9. Martin: SL/TP validation — sanitizeBasketTargetStops (commit ebed3860)

### What we're testing
- Directionally invalid stops stripped before persist
- Incoherent SL-within-TP-ladder rejected
- Dot-leader signal formats parsed correctly

### How to test
1. Send a signal with SL inside the TP ladder
2. Verify the invalid target is rejected

### Pass criteria
- [ ] SL inside TP ladder → `incoherent_sl_within_tp_ladder` rejection
- [ ] Sell SL above market → stripped
- [ ] Buy SL below market → kept (valid)
- [ ] Dot-leader formats (`Sell.........4080`) parsed

---

## 10. Martin: Order close audit (commit 6274eb78)

### What we're testing
- Every `orderClose` call logged with stack trace
- Console + `trade_execution_logs` (best-effort)
- Both fxClient (v1) and fxsocketClient (v2) covered

### How to test
Trigger a close operation. Check logs for audit entries.

### Pass criteria
- [ ] Close operations emit `[orderCloseAudit]` log lines
- [ ] Stack trace included in audit
- [ ] Both success and failure paths audited

---

## 11. Martin: Purge stale trade prices cron (commit 70de046f migration)

### What we're testing
- `purge_stale_trade_prices` cron runs every 5 minutes
- Does NOT delete active basket data
- `symbols_compatible()` matching is correct (substring not full match)

### How to test
1. Wait 5 minutes for cron to fire
2. Check Supabase query performance

### What to check
```
# In Supabase → SQL Editor:
SELECT * FROM cron.job WHERE jobname = 'purge-stale-trade-prices';

# Check for any unwanted deletions:
SELECT * FROM range_pending_legs WHERE basket_id IN (
  SELECT id FROM trades WHERE status != 'closed'
);
```

### Pass criteria
- [ ] Cron job registered in `cron.job` table
- [ ] Active baskets: ladder rows NOT purged
- [ ] Flat baskets: ladder rows purged within 5 min of going flat
- [ ] No query timeouts on the cron SQL
- [ ] `channel_active_trade_params` not purged for active channels

### Fail criteria
- Active basket data deleted by cron
- Cron not registered (migration failed)
- Query takes >1s (no index on `status` + `basket_id`)

---

## 12. Martin: Frontend UI components (commits cf31c7e8, 70de046f)

### What we're testing
- `ListenerLeaseOfflineBanner` shows when lease expired
- `CopierStatusCard` shows broker/engine/listener health
- i18n translations render for all 6 languages

### How to test
1. Open staging.tscopier.ai in browser
2. Log in with staging user
3. Check dashboard for offline banner and status card

### Pass criteria
- [ ] Banner visible when listener lease expired
- [ ] Status card shows correct engine state (live/offline)
- [ ] "Reconnect Telegram" link navigates to /channels
- [ ] All 6 dashboard locale files load without error
- [ ] Collapsed/expanded state persists across page reload

---

## 13. Production rollout smoke test (Section 1)

### What we're testing
Full production rollout after staging passes.

### How to test
1. Merge staging → main (`git push upstream staging:main`)
2. Railway auto-deploys from main
3. Monitor production logs for 2 hours

### What to check (2-hour window)
```
# EXPECTED — no old bugs:
# Zero TIMEOUT death spirals
# Zero QR login AUTH_KEY_UNREGISTERED loops
# Zero BinaryReader crashes
# Zero CHANNEL_INVALID infinite retry loops
```

### Pass criteria (2-hour window)
- [ ] No `TIMEOUT` errors from `_updateLoop`
- [ ] No `AUTH_KEY_UNREGISTERED` QR login loops
- [ ] No BinaryReader crashes
- [ ] No `CHANNEL_INVALID` infinite retry
- [ ] No Realtime subscription drops >5s
- [ ] No signal delivery regression (compare pre/post per-channel latency)

---

## Summary: Minimal smoke test sequence (15 min)

Run this before any deeper testing:

1. `[ ]` Redeploy Railway listener → check logs for 62 sessions loaded
2. `[ ]` Check `/health` endpoint returns `{"ok":true}`
3. `[ ]` Verify 3 real sessions show `SUBSCRIBED` in logs
4. `[ ]` Verify 59 synthetic sessions show `Failed to start listener` (graceful)
5. `[ ]` Check no `ERROR` or `FATAL` log entries
6. `[ ]` Open staging.tscopier.ai → dashboard loads without error
