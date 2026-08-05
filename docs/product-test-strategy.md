# TScopier — Product & Test Strategy

---

## 1. WHAT IS TSCOPIER?

**TScopier is an automated Telegram-to-MetaTrader trade copier.** It monitors Telegram channels for forex/gold trading signals, parses them into structured trade instructions, and executes the trades on the user's MT4/MT5 broker account via FxSocket.

**In one sentence:** A user connects their Telegram account + broker account, tells TScopier which channels to monitor, and TScopier automatically copies every signal from those channels into real trades.

---

## 2. SYSTEM ARCHITECTURE

```
┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────┐
│ Telegram │────▶│  Listener    │────▶│  Signal   │────▶│  Trade   │
│ Channels │     │  (GramJS)    │     │  Pipeline │     │ Executor │
└──────────┘     └──────┬───────┘     └─────┬─────┘     └────┬─────┘
                        │                   │                │
                        ▼                   ▼                ▼
                   ┌──────────────────────────────────────────┐
                   │              Supabase DB                  │
                   │  (telegram_sessions, signals, trades,     │
                   │   baskets, leases, execution_logs...)     │
                   └──────────────────────────────────────────┘
                        ▲                   ▲                ▲
                        │                   │                │
                   ┌────┴──────┐     ┌──────┴──────┐    ┌────┴─────┐
                   │Realtime   │     │ pg_cron     │    │ Edge     │
                   │Subscriber │     │ (7 jobs)    │    │Functions │
                   └───────────┘     └─────────────┘    └──────────┘

┌──────────────────────────────────────────────────────────────┐
│                    Frontend (React)                          │
│  Dashboard │ Channel Manager │ Broker Config │ Auth Flow     │
└──────────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Language | What It Does | Key Files |
|---|---|---|---|
| **Listener** | TypeScript/Node | Connects to Telegram via GramJS, monitors channels, receives messages, parses signals | `worker/src/userListener.ts`, `sessionManager.ts` |
| **Session Manager** | TypeScript/Node | Manages N Telegram sessions (load, connect, disconnect, lease), shard-aware | `worker/src/sessionManager.ts` |
| **Signal Parser** | TypeScript/Node | Converts raw Telegram text → structured signal (deterministic + AI/OpenAI) | `worker/src/signalParser/` |
| **Trade Executor** | TypeScript/Node | Executes trades on broker, manages baskets, SL/TP, trailing, monitors | `worker/src/tradeExecutor/` |
| **HTTP Server** | TypeScript/Node | REST API for auth, channel management, signal dispatch, health | `worker/src/httpServer.ts` |
| **Supabase DB** | PostgreSQL | All persistent state: sessions, channels, signals, trades, baskets, leases | `supabase/migrations/` (127 files) |
| **Edge Functions** | Deno/TS | 30 serverless functions: auth proxy, parsing, stripe, backtest, admin, email | `supabase/functions/` |
| **Frontend** | React 19 | User UI: dashboard, channel config, broker config, auth, backtest | `src/` |
| **Telegram Listener** | Python | Alternative listener (Telethon) — separate deployment | `telegram-listener/` |

---

## 3. ALL MODES

### 3.1 Listener Mode (role=listener)
- Connects Telegram sessions, monitors channels, parses signals
- Dispatches parsed signals to trade worker via HTTP or Redis
- **Env:** `WORKER_ROLE=listener`, `WORKER_INTERNAL_TOKEN`, `WORKER_SHARD_ID/COUNT`

### 3.2 Trade Mode (role=trade)
- Receives signals, executes on broker via FxSocket
- Runs all monitors (partial TP, trailing stop, reconciliation, basket SL/TP)
- **Env:** `WORKER_ROLE=trade`, `FXSOCKET_API_KEY`, `TRADE_WORKER_URL`

### 3.3 All-in-One Mode (role=all)
- Both listener + trade in a single process
- **Env:** `WORKER_ROLE=all`

### 3.4 Backtest Mode
- Replays historical channel messages, simulates trades
- **Env:** Via edge function `backtest-run` or separate worker config

### 3.5 Telegram Listener (Python/Telethon)
- Alternative lightweight listener — single Telegram session
- Deployed separately, communicates via listener events table
- **Env:** `python telegram-listener/`

---

## 4. ALL FEATURES (Complete Inventory)

### 4.1 Telegram Session Management

| Feature | Description | DB Table(s) |
|---|---|---|
| Phone auth | Send code → verify code → store session | `telegram_sessions`, `telegram_auth_pending` |
| QR auth | Start QR → scan → verify (with 2FA support) | `telegram_sessions`, `telegram_auth_pending` |
| Session persistence | Encrypted session string survives restarts | `telegram_sessions.session_string` |
| Session invalidation | Auto-invalidate on AUTH_KEY_UNREGISTERED | `telegram_sessions.is_active` |
| Multi-session | 1 Telegram account = 1 session per user | `telegram_sessions` |
| Listener engine | GramJS or Telethon | `telegram_sessions.listener_engine` |
| Lease system | Distributed shard ownership via worker leases | `worker_session_leases` |
| Shard awareness | Multiple worker replicas split sessions | `WORKER_SHARD_ID/COUNT` |

### 4.2 Channel Monitoring

| Feature | Description |
|---|---|
| Add channel | By @username, channel ID, or invite link |
| Auto-polling | Safety poll (10s) + fast poll (3s) for new messages |
| Reply chain tracking | Management signals reference parent entry |
| Message revision | Edit an existing signal → re-parse + update |
| Channel keywords | Per-channel lexicon for parsing (JSONB) |
| CHANNEL_INVALID auto-disable | 5 consecutive failures → auto-disable channel |
| Channel whitelist | Per-broker channel filter |
| Channel live tracking | `last_live_at` timestamp per channel |
| Backfill history | Import historical channel messages |

### 4.3 Signal Parsing

| Feature | Description |
|---|---|
| Deterministic parsing | Regex-based: side, symbol, lots, entry, SL, TP |
| AI parsing | OpenAI GPT-based: handles freeform natural language |
| Entry formats | Market order, limit entry, zone entry (range) |
| SL/TP formats | Single, ladder (multi-TP), dot-leader, underscore |
| Modification signals | Adjust SL, breakeven, close, close half, close partial, close worse entries |
| Reply chain | Management signal → parent entry signal |
| Signal reconciliation | Compare broker positions vs signals, fix mismatches |
| Pipeline timestamps | 20+ timing markers per signal (telegram_received → parsed → ensured → dispatched) |

### 4.4 Trade Execution

| Feature | Description |
|---|---|
| Market orders | Immediate buy/sell execution |
| Limit/stop orders | Pending order placement |
| Basket system | Group trades into baskets by (channel, symbol, direction) |
| Basket layering | Multiple entries into same basket with SL/TP per layer |
| Basket SL/TP | Authoritative stop-loss and take-profit targets per basket |
| Partial TP | Fill one TP rung → optionally adjust SL, trail, notify |
| Trailing stop | Auto-trail SL as price moves favorably |
| Breakeven | Move SL to entry + offset |
| Close half / close partial | Partial position close |
| Close worse entries | Close only the worst-positioned legs |
| Copy limits | Max lots, max trades per channel/user |
| Lot size override | Per-channel or per-signal lot multiplier |

### 4.5 Monitors (Background Loops)

| Monitor | Period (active) | Period (idle) | What It Does |
|---|---|---|---|
| SweepLoop | 1s | 15s | Polls trade queue |
| VirtualPendingMonitor | 200ms | 15s | Checks virtual pending legs for price triggers |
| RangeBrokerPendingMonitor | 2s | 15s | Checks broker pending orders |
| SignalEntryPendingMonitor | 2s | 15s | Checks signal-based pending entry orders |
| SignalRangeEntryMonitor | 2s | 15s | Checks range entry waits |
| PartialTpMonitor | 2s | 15s | Fills TP ladder rungs |
| OpenTradeReconcileMonitor | 30s | 120s | Reconciles open trades with broker |
| TrailingStopMonitor | 400ms | 15s | Updates trailing stops |
| BasketSlTpReconcileMonitor | 5s | 15s | Applies basket-wide SL/TP to individual legs |
| CopyLimitMonitor | 30s | — | Checks copy limits |
| NewsTradingMonitor | 60s | — | Blocks trades around news events |
| ChannelReconcileMonitor | 45s | — | Reconciles channel state |
| AutoManagementMonitor | varies | — | Auto-applies breakeven, SL adjustments |

### 4.6 Supabase Realtime Subscriptions

| Subscription | Table | Purpose |
|---|---|---|
| Worker: telegram_channels | `telegram_channels` | Live channel add/remove/disable |
| Worker: telegram_auth_pending | `telegram_auth_pending` | Auth flow events |
| Worker: signals | `signals` | New parsed signals |
| Worker: broker_accounts | `broker_accounts` | Broker config changes |
| Frontend: trades | `trades` | Live dashboard trade updates |
| Frontend: trade_execution_logs | `trade_execution_logs` | Live execution log |
| Frontend: backtest_runs | `backtest_runs` | Backtest progress |
| Frontend: app_settings | `app_settings` | Banner/announcement |

### 4.7 Cron Jobs (7 total)

| Job | Interval | What It Does |
|---|---|---|
| range-pending-sweep | 1 min | Backup virtual pending monitor |
| basket-sl-tp-sweep | 1 min | Backup basket SL/TP reconciliation |
| signal-reconcile-sweep | 2 min | Backup signal reconciliation |
| broker-session-keepalive | 2 min | Keep broker connections alive |
| expire-timed-admin-access | 5 min | Expire temporary admin grants |
| reconcile-expired-trials | 60 min | Sync Stripe trial expirations |
| purge-stale-trade-prices | 5 min | Clean stale ladder/SL/TP data |

### 4.8 Frontend Features

| Feature | Route/Component |
|---|---|
| Dashboard | `/` — CopierStatusCard, broker status, listener status |
| Channels | `/channels` — list, add, configure monitored channels |
| Broker config | `/broker` — add/edit MT4/MT5 accounts, FxSocket |
| Signal history | `/history` — past signals and trades |
| Backtest | `/backtest` — run and view backtests |
| Settings | `/settings` — profile, subscription, affiliate |
| Admin panel | `/admin` — user management, audit logs (separate app) |
| Telegram auth | Modal/flow — phone or QR auth |
| i18n | 9 languages: en, es, fr, ar, ja, nl, pl, ru, sv |

### 4.9 Failure Recovery Features

| Feature | What It Handles |
|---|---|
| AUTH_KEY_DUPLICATED | Exponential backoff, max 10 retries, then invalidate |
| BinaryReader crash | GramJS patch, reconnect in <5s, max 10/10min |
| CHANNEL_INVALID | Counter 1..5, auto-disable at 5 |
| TIMEOUT death spiral | Request reconnect, no infinite loop |
| Lease renewal wedged | `renewLeasesInFlight` flag prevents stacking |
| Realtime subscription drop | Auto-retry in 5s |
| OpenAI 429 | 10min cooldown, fallback to deterministic |
| Flood wait | Transparent backoff (2 retries, 90s) |
| Signal dispatch failure | Dead letter queue + retry |
| Graceful shutdown | SIGTERM → drain → exit, no AUTH_KEY_DUPLICATED |

---

## 5. COMPREHENSIVE TEST CASES

### 5.1 Telegram Session Tests

| TC# | Test Case | Steps | Expected | Automation |
|---|---|---|---|---|
| TC1 | Phone auth happy path | POST `/auth/send_code` with phone → POST `/auth/verify_code` with code | Session created, `telegram_sessions` row populated | Manual (need phone) |
| TC2 | QR auth happy path | POST `/auth/start_qr` → scan QR → POST `/auth/qr_status` | Session created | Manual (need Telegram app) |
| TC3 | QR auth with 2FA | QR + 2FA password verification | Session created with mtproto_hold | Manual |
| TC4 | Session persist after restart | Restart worker → check connections | All 3 sessions auto-connect, no re-auth | ✅ Automated (check /health) |
| TC5 | Session invalidation | Simulate AUTH_KEY_UNREGISTERED → check `is_active=false` | Session string deleted, UI shows "re-link" | Manual (force invalidate) |
| TC6 | Session lease acquisition | Check `worker_session_leases` table | Each session has 1 lease matching current shard | ✅ Automated |
| TC7 | Session lease renewal | Wait 10-20s, check `worker_session_leases.updated_at` | All leases refreshed, no `renewLeasesInFlight skip` | ✅ Automated |

### 5.2 Channel Monitoring Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC8 | Channel poll | Bot monitors channel → wait 10s | `last_successful_poll_at` updates, events processed |
| TC9 | Channel add via realtime | INSERT into `telegram_channels` → check listener picks it up | `listener.onChannelsChanged()` fires, new channel polled |
| TC10 | Channel remove via realtime | DELETE from `telegram_channels` | Listener stops polling |
| TC11 | CHANNEL_INVALID auto-disable | Remove bot from channel → wait for 5 poll errors | `is_active=false`, `channel_auto_disabled` event logged |
| TC12 | Channel re-enable | UI toggle `is_active=true` | Listener resumes polling, counter resets |
| TC13 | Backfill history | POST `/auth/backfill_channel_history` | Historical messages parsed, signals created |
| TC14 | Unknown channel detection | New message from unknown channel → `unmapped_channel` event | Logged, no signal created |

### 5.3 Signal Parsing Tests

| TC# | Signal Text | Expected Parsed Data | Format |
|---|---|---|---|
| TC15 | `BUY XAUUSD 1.00 SL 3980 TP 4000` | side=buy, symbol=XAUUSD, lots=1.00, sl=3980, tp=4000 | Standard entry |
| TC16 | `SELL XAUUSD 3950-3960 SL 3980 TP 3930 TP 3910` | side=sell, entry_min=3950, entry_max=3960, sl=3980, tp=[3930,3910] | Zone entry |
| TC17 | `BUY XAUUSD 1.00 SL 4020 TP 4030 TP 4050` | Rejected: SL inside TP ladder | Invalid SL |
| TC18 | `BUY XAUUSD 1.00` | side=buy, lots=1.00, no SL/TP | Naked entry |
| TC19 | `Sell.........4080 Sl.............4090 Tp............4071` | side=sell, price=4080, sl=4090, tp=4071 | Dot-leader |
| TC20 | `XAUUSD_BUY 1.00 SL 3980 TP 4000` | side=buy, symbol=XAUUSD | Underscore |
| TC21 | `Adjust SL to 3940` | intent=adjust_sl, sl=3940 | Modification |
| TC22 | `BE at 3970` | intent=breakeven, be_price=3970 | Breakeven |
| TC23 | `CLOSE XAUUSD at 4010` | intent=close, symbol=XAUUSD, price=4010 | Close |
| TC24 | `Close worse entries` | intent=close_worse_entries | Close worse |
| TC25 | `BUY XAUUSD 1.00 SL 3980 TP 4000 / TP 4020 / TP 4040` | tp=[4000,4020,4040], 3-rung ladder | Multi-TP |
| TC26 | `BIAS: Bullish above 3950` | Non-actionable → no signal created | Chatter |
| TC27 | Edit message "BUY XAUUSD 1.00" → change to "SELL XAUUSD 0.50" | Signal revised, not duplicated | Edit |
| TC28 | Message with image containing signal text | `raw_image_url` set, parsed from OCR | Image signal |

### 5.4 Trade Execution Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC29 | Market order entry | Send entry signal → broker receives order | `trade_execution_logs` has "executed" status |
| TC30 | Limit order entry | Signal with limit price → pending order placed | `signal_entry_pending_orders` row created |
| TC31 | Basket creation | First entry signal → basket created | `basket_sl_tp_targets` row created |
| TC32 | Basket layering | Second entry same channel/symbol/direction → added to basket | Multiple legs same basket |
| TC33 | Partial TP fill | Price hits TP1 → partial close → adjust remaining | Logs show partial fill, remaining legs adjusted |
| TC34 | Trailing stop | Price moves favorably X pips → SL trails | `trail_peak_price` and `trail_last_sl` updated |
| TC35 | Breakeven | Price hits BE level → SL moved to entry | Trade shows SL moved to entry + offset |
| TC36 | Close half | `CLOSE HALF` signal → 50% position closed | Half the lots closed, remainder open |
| TC37 | Close worse entries | `Close worse entries` → worst legs closed | Only losing-positioned legs closed |
| TC38 | Copy limit enforce | Configure max 0.5 lots → send 1.0 lot signal | Signal scaled to 0.5 lots |
| TC39 | Lot size override | Per-channel 0.5 override → signal with 1.0 executed as 0.5 | Trade shows 0.5 lots |

### 5.5 Basket Reconciliation Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC40 | Basket SL applied | Set basket SL → all legs get new SL | `basket_reconcile_legs.desired_sl` populated |
| TC41 | Basket TP applied | Set basket TP → all legs get new TP | Legs modified with new TP |
| TC42 | Basket flat → purge | Close all trades → wait 5 min | Ladder rows purged, `basket_sl_tp_targets` cleared |
| TC43 | Reconcile on restart | Worker restart with open baskets | Reconciliation triggers, positions match |

### 5.6 Realtime Subscription Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC44 | telegram_channels subscription active | Check startup logs | `Realtime telegram_channels subscription active` |
| TC45 | telegram_auth_pending subscription active | Check startup logs | `Realtime telegram_auth_pending subscription active` |
| TC46 | Subscription drop → reconnect | Kill Realtime connection → wait 10s | Auto-retry in 5s, subscription re-established |
| TC47 | Channel add via Realtime | INSERT channel while worker running | Picked up within 5s, listener starts polling |
| TC48 | Auth pending via Realtime | INSERT into telegram_auth_pending | Worker pauses MTProto session |

### 5.7 Failure Recovery Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC49 | Graceful restart | Send SIGTERM to worker | All sessions disconnect, leases released, exit 0 |
| TC50 | AUTH_KEY_DUPLICATED recovery | Force duplicate session (start 2 workers) | Backoff retry, max 10, then invalidate |
| TC51 | TIMEOUT recovery | Block Telegram TCP temporarily | Request reconnect, resumes in <30s |
| TC52 | BinaryReader crash | Send malformed RPC response | Catch, reconnect in <5s |
| TC53 | OpenAI 429 | Rate-limit AI parsing endpoint | 10min cooldown, fallback to deterministic |
| TC54 | Flood wait | Trigger Telegram flood protection | Transparent backoff, operation retries |
| TC55 | Lease renewal hang | Simulate hung renewal cycle | Skip + log, next cycle retries |

### 5.8 Scale & Load Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC56 | 62 sessions startup | Load all sessions → measure time | < 120s total |
| TC57 | Memory stability | Run 4 hours → measure RSS growth | < 5% growth (no leak) |
| TC58 | CPU under load | Post 100 signals in 1 minute → measure CPU | < 80% sustained |
| TC59 | Concurrent signal processing | 10 signals in 1 second → all parsed | No signal dropped |
| TC60 | Channel poll at scale | 170 channels polled → no backlog | All polls complete before next cycle |

### 5.9 Frontend Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC61 | Dashboard loads | Navigate to `/` | No console errors, all widgets render |
| TC62 | CopierStatusCard | Check card rendering | Shows broker status, listener status, correct summary |
| TC63 | ListenerOfflineBanner | When lease expired → banner shown | Amber banner with reconnect link |
| TC64 | Channel list | Navigate to `/channels` | All channels listed with status |
| TC65 | Add channel | Fill form → submit | Channel appears in list, worker starts polling |
| TC66 | i18n all languages | Switch to each language | All strings translated, no missing keys |
| TC67 | RTL layout | Switch to Arabic | Right-to-left layout correct |
| TC68 | Telegram auth modal | Start phone/QR auth flow | Modal renders, code sent, session created |

### 5.10 Production Rollout Tests

| TC# | Test Case | Steps | Expected |
|---|---|---|---|
| TC69 | Deploy without downtime | Push to `main` → Railway deploys | Zero AUTH_KEY_DUPLICATED, drain works |
| TC70 | 53 sessions reconnect | Post-deploy | All sessions within 60s |
| TC71 | Signal delivery post-deploy | Compare pre/post latency | No regression |
| TC72 | Rollback | `git push upstream main~1:main` | Previous version deploys in <2 min |

---

## 6. HOW TO CREATE MULTIPLE SESSIONS

### 6.1 Real Sessions (one per Telegram account)

Each session represents a real Telegram account:

```sql
-- Creating a blank session row
INSERT INTO telegram_sessions (user_id, session_string, phone_number, is_active, listener_engine)
VALUES ('<user-uuid>', '', '', true, 'gramjs');
```

To create a real session, you need to auth via phone or QR:
1. POST `/auth/send_code` with phone number → receives code on Telegram
2. POST `/auth/verify_code` with 4-digit code → session string stored
3. Telegram listener connects with this session

**You can create unlimited sessions** — each just takes a Telegram account and phone number (can use virtual numbers).

### 6.2 Synthetic Sessions (for scale testing)

These have blank session strings — they test startup, lease, error handling but don't connect:

```sql
-- Create 59 blank sessions (already done on staging)
INSERT INTO telegram_sessions (user_id, session_string, phone_number, is_active, listener_engine)
SELECT gen_random_uuid()::text, '', '', true, 'gramjs'
FROM generate_series(1, 59);
```

**On staging:** 3 real + 59 synthetic = 62 total.

### 6.3 To add more real sessions on staging:
1. Create a new user in Supabase Auth
2. Insert `telegram_sessions` row with that `user_id`
3. Go through phone auth flow on the frontend
4. The session string gets saved automatically

---

## 7. HOW TO STRESS TEST THE SYSTEM

### 7.1 Signal Volume Stress

**Goal:** Test pipeline under load (100+ signals/min)

**Method — Automated script:**
Write a Node.js script using GramJS with an existing session to flood the test channel:

```typescript
// pseudo-code
for (let i = 0; i < 100; i++) {
  const signal = randomSignal(); // BUY/SELL XAUUSD random lots
  await client.sendMessage(testChannel, { message: signal });
  await sleep(100); // 10 msgs/sec max
}
```

**What to monitor:**
- Signal queue depth (no backlog)
- Parse latency per signal (< 500ms avg)
- CPU/memory during flood
- No dropped signals (compare sent vs created in DB)
- Realtime subscription lag

### 7.2 Session Count Stress

**Goal:** Test scalability to 200+ sessions

**Method:**
Create 200+ synthetic sessions (blank strings). Monitor:
- Startup time (< 120s for 62, project for 200)
- Lease renewal cycle time
- Memory per session (~5-10MB baseline × 200 = 1-2GB)
- No MaxListenersExceededWarning

### 7.3 Channel Count Stress

**Goal:** Test scalability to 500+ channels

**Method:**
Create 500+ `telegram_channels` rows across the synthetic users. Monitor:
- Poll queue build-up
- Reconnect time
- Memory for channel state
- No `poll_peer_resolve_failed` for real channels

### 7.4 Concurrent Signal Stress

**Goal:** Test concurrent signal processing (same timestamp)

**Method:**
Post 20 signals in rapid succession (< 1 second). Monitor:
- All signals parsed without race conditions
- No duplicate trades
- No FK violations
- Basket layering correct order

### 7.5 Memory Leak Detection

**Goal:** Verify no memory growth over time

**Method:**
1. Deploy worker with `--max-old-space-size=512`
2. Run for 4 hours with continuous signal posting
3. Log RSS every 5 minutes
4. **Pass:** RSS < 500MB, no linear trend, no GC thrash

### 7.6 Reconnection Stress

**Goal:** Test reconnect stability under network jitter

**Method:**
Use `tc` command to simulate packet loss:
```bash
# Add 5% packet loss
tc qdisc add dev eth0 root netem loss 5%
# Run for 30 min
# Remove
tc qdisc del dev eth0 root
```

**Monitor:** Reconnect count, signal loss, AUTH_KEY_DUPLICATED errors

---

## 8. HOW TO CREATE MULTIPLE REALTIME SESSIONS

### 8.1 What "Realtime Sessions" Means in TScopier

TScopier uses **Supabase Realtime** (WebSocket-based) for:
- **Worker side:** 4 subscriptions (telegram_channels, telegram_auth_pending, signals, broker_accounts)
- **Frontend side:** 4+ subscriptions (trades, execution_logs, backtest_runs, app_settings)

These are NOT Telegram sessions. They are WebSocket connections to Supabase's Realtime server that listen for PostgreSQL changes on specific tables.

### 8.2 To Create Multiple Realtime Test Sessions

**On the worker side** — each worker instance establishes its own Realtime subscriptions:
```typescript
// sessionManager.ts
this.realtimeSub = supabase
  .channel('telegram_channels')
  .on('postgres_changes', ...)
  .subscribe()
```

- Each worker replica = 1 set of Realtime subscriptions
- To test with multiple Realtime sessions: run multiple worker replicas
- Each subscribes independently

**On the frontend side** — each browser tab = 1 Realtime connection:
- Open multiple browser tabs → each establishes its own WebSocket
- Monitor Supabase Realtime dashboard for connection count

### 8.3 To Stress Test Realtime

1. Open 10+ browser tabs of `staging.tscopier.ai`
2. Each establishes its own Realtime WebSocket
3. Monitor: WebSocket connections, message latency, reconnections
4. Simulate network drop → verify auto-reconnect on each tab

---

## 9. HOW TO ENSURE PRODUCTION IS WORKING PERFECTLY

### 9.1 Pre-Deploy Checklist (gate)

Before pushing to `main`, ALL of these must pass:
- [ ] All TC1-TC72 with ✅ Automated pass
- [ ] Staging listener running 4+ hours with zero ERROR/FATAL logs
- [ ] All 3 real sessions connected entire window
- [ ] Memory stable (< 5% growth over 4h)
- [ ] All signal formats parsed correctly (TC15-TC28)
- [ ] Graceful shutdown test (TC49) passes
- [ ] Realtime subscriptions reconnect test (TC46) passes

### 9.2 Post-Deploy Monitoring (first 2 hours)

**Automated checks (run every 5 min):**
```bash
# Health check
curl -s https://tscopier-worker.up.railway.app/health \
  | jq '.ok == true and .connected_listeners >= 53 and .lease_mismatch == false'
```

**Log alerts (any of these → investigate):**
- `FATAL` or `ERROR` log level
- `AUTH_KEY_DUPLICATED` > 0
- `BinaryReader` or `readUInt32LE` crash
- `CHANNEL_INVALID` infinite retry
- `TIMEOUT` death spiral
- `renewLeasesInFlight` skip

**Metric dashboards:**
- Signal delivery latency (p50, p95, p99 over 5min windows)
- Parse success rate (% signals parsed correctly)
- Listener connected count (should stay at 53)
- Active lease count (should match connected count)
- Lease mismatch flag (should stay false)

### 9.3 Rollback Plan

```bash
# Rollback to previous version
git push upstream main~1:main --force

# Railway auto-deploys previous build
# Time to rollback: ~2 minutes

# Verify rollback
curl -s https://tscopier-worker.up.railway.app/health | jq '.ok'

# After rollback: fix forward on dev, not main
```

### 9.4 Production Monitoring Checklist

| What | How | Frequency |
|---|---|---|
| Listener connected count | `curl /health \| jq '.connected_listeners'` | Every 5 min |
| Lease mismatch | `curl /health \| jq '.lease_mismatch'` | Every 5 min |
| Signal delivery | Check signals table for recent rows | Every 15 min |
| Error rate | Search for ERROR/FATAL in Railway logs | Continuous |
| Memory | Railway dashboard metrics | Continuous |
| Session count | `SELECT count(*) FROM telegram_sessions WHERE is_active = true` | Daily |
| Realtime subscriptions | Supabase Realtime dashboard | Daily |
| cron jobs ran | `SELECT * FROM cron.job_run_details` | Daily |

---

## 10. IMMEDIATE NEXT STEPS

### Phase 1 — Build the automation (today)
1. Write GramJS signal-posting script → can run TC15-TC28 automatically
2. Set up monitoring queries in Supabase for real-time test verification
3. Run Sections 1, 4, 5, 7, 8 (no test channel needed)

### Phase 2 — Execute test suite (today/tomorrow)
1. Run TC15-TC28: all signal formats via automation script
2. Run TC44-TC48: Realtime subscription tests
3. Run TC49-TC55: Failure recovery tests
4. Run TC56-TC60: Scale tests

### Phase 3 — Production gate (before merge)
1. Run all ✅ automated tests one final time
2. Verify pre-deploy checklist (Section 9.1)
3. Merge `staging` → `main`
4. Monitor post-deploy (Section 9.2)
