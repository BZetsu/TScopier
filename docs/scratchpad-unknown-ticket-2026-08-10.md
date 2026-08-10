# Scratchpad — "Broker · Unknown ticket" (Leonardo Araújo, XAUUSD auto_be)

> Investigation scratchpad. Answers the question: why does the broker say `unknown ticket`?
> Who/what/when, and did the broker ever receive the entry?

## Facts from the report

- Error: `Broker · Unknown ticket` (Major, Execution)
- User: **Leonardo Araújo**
- Trade: — (none linked directly to the error)
- Action: `auto_be` (auto break-even), 50 execution attempts, all `failed`, ~48s span
- Signal ID: `072a819e` (raw message "I buy gold again now @ 4332 - 4324 ... SL: 4322 TP: 100/200Pips")
- Request payloads cycle 5 tickets: 2334870079, 2334870097, 2334870269, 2334870737, 2334870796
- Symbol XAUUSD, mode `tp_hit`, attempted_sl ≈ 4333.2x
- Signal pipeline: status `skipped` (`commentary_not_trade_signal`), deterministic fast-lane
- Pipeline timeline: queue published `11:50:38.192Z`

## Questions to answer

1. Who is the user? (profiles row, display name, email)
2. What account/channel? (broker_accounts, telegram sources)
3. When did the initial signal arrive? (signals row)
4. When were the 5 trades opened on the broker? (trades row opened_at)
5. When/why did the broker-side positions close?
6. Did the entry ever reach the broker? (real MT5 tickets vs fake)
7. When did the first `auto_be` failure appear vs the entry?
8. Why does the DB still say `status='open'`?

## Answers (populate as verified)

- [x] user_id: `82756f8c-3b8a-4e9e-9614-3ad94e093781` (Leonardo Araújo, created 2026-08-05, trialing, timezone UTC)
- [x] broker_account_id: `fcabb782-82ba-4e33-8a94-77b5c65a29b0` ("MASTER ACCOUNT", MT5, login 68341835)
- [x] fxsocket_account_id: `61c32127-f861-49b6-aa1f-b1b0dae67d30`
- [x] channel: signal_channels id `e5707808-dae3-418f-b098-de1022f54133`; telegram_channels lookup by channel_id returned EMPTY (need to re-check via channel_username)
- [x] signal created: 2026-08-10 11:49:54Z (telegram_message_id 289)
- [x] **10 trades** for this signal, not 5!
- [x] First 5 trades (tickets 2334869892, 2334869915, 2334869978, 2334870039, 2334870059, tp=4335) → **closed_at 11:51:14.982**
- [x] Last 5 trades (tickets 2334870079, 2334870097, 2334870269, 2334870737, 2334870796, tp=4337) → **still `status='open'`** — THESE are the tickets in the error payloads
- [x] auto_be failures for this signal/account: growing continuously (earliest 17:27:35Z; ~680+ and still live; retention keep=500/user prunes old rows so counts slide)
- [x] ALL trade_execution_logs for this user/account = auto_be failed. **NO order_send logs at all**
- [x] No partial_tp_legs for these 5 open trades
- [x] message_revision_applied at 11:50:38 (live_edit, parameter_refresh) — signal later re-classified skipped/commentary_not_trade_signal
- [x] **Loop STILL RUNNING as of 17:49:33Z (live incident)**
- [x] broker-side close cause: positions on broker closed (TP), but DB not reconciled → `status='open'` forever
- [x] first auto_be failure: earliest observed 17:27:35Z; log retention (keep=500/user, `prune_all_trade_execution_logs` every 10min) prunes old rows so earliest surviving rows keep sliding (now 17:37:37Z). NOT 16:38 — that figure was for trade 1278201, different incident.
- [x] exact reason broker can't find ticket: broker-side close not detected because `openTradeReconcile` / v2 reconcile SAFETY-defer ghost closes when the broker snapshot is EMPTY (suspected disconnect). Account has ONLY these 5 open trades; once the last 5 closed on the broker, `/OpenedOrders` returns empty → deferral → DB rows stay `status='open'` forever → autoManagementMonitor re-selects them every tick and hammers `orderModify` on dead tickets.

## Root cause chain (verified against DB)

1. Signal arrived 11:49:54Z → 10 trades opened on broker 11:49:58–11:50:01Z (real MT5 tickets)
   - First 5 (tp=4335 = predefined TP1): tickets 2334869892→2334870059
   - Last 5 (tp=4337 = predefined TP2): tickets 2334870079→2334870796
   - **10 trades = 5 static layers × 2 TP targets** (`manual_settings`: `static_layer_count: 5`, `predefined_tp_pips: [20, 40]`, `fixed_lot: 2` × `multi_trade_leg_percent: 5` → 0.10 lot/leg)
2. First 5 hit TP1 4335 → closed on broker, then DB-closed 11:51:14.982 (all 5 same timestamp = batch update by `closeStaleOpenTrades` via reconcile; no execution log written)
3. Last 5 (tp=4337, TP2) eventually closed ON THE BROKER too (TP hit)
4. DB last-5 trades stayed `status='open'`, `auto_be_applied_at=null`: reconcile did NOT mark them closed because the broker snapshot was EMPTY (account had nothing else open) → `openTradeReconcile`/`v2ReconcileMonitor` empty-snapshot SAFETY deferral (suspected disconnect) skips the ghost close
5. `autoManagementMonitor` (tick every ~400ms) selects those rows (status=open, auto_be pending), fires `orderModify` for `tp_hit` auto-BE (account manual_settings `move_sl_to_entry_after_mode: "tp_hit"`, tp_index 1, offset 2 pips → attempted_sl ≈ entry+2)
6. Broker replies `unknown ticket` (position gone)
7. `autoManagementMonitor.ts:419` benign-error regex lacked `unknown ticket` → treated as hard failure → trade NOT closed → retried forever
8. Loop hammering since 17:27:35Z, STILL LIVE (last observed 17:49:33Z, ~680+ failures, growing; retention prunes old rows)

## Why no order_send logs at all

- Entries (order_send) for this account do NOT appear in trade_execution_logs — the only rows are auto_be failures. The entry path did not write execution logs for this broker (log write is either absent for the entry action or only broker actions that fail/succeed via certain paths are logged). Not the cause of the incident; noted as observation.

## Open questions still to verify

- [x] What closed the FIRST 5 trades at 11:51:14? → broker TP1=4335 hit on broker; DB close via reconcile (`closeStaleOpenTrades` batch update, same `closed_at` timestamp for all 5, no execution log). At that moment the broker snapshot was NON-empty (last 5 still open) so the ghost-close ran.
- [x] Why are there 10 trades for one signal? → 5 static layers × 2 TP targets (predefined_tp_pips [20,40] → 4335/4337)
- [x] When did the broker actually close the 5 "open" tickets? → before first auto_be failure 17:27:35Z; exact broker time not queryable, but "unknown ticket" confirms gone
- [x] Channel confirmed: **CHARTSYCO ELITE** (telegram_channels id `e5707808-dae3-418f-b098-de1022f54133`, telegram_chat_id `-1003725132100`, signal_channel_id `5074641b-1d0f-44a8-b6c1-10b6b5f3a33d`, created 2026-08-05)
- [x] Why didn't reconcile close the last 5 too? → empty broker snapshot (account had NO other open positions) triggers the disconnect-safety deferral in `openTradeReconcile.reconcileOpenTradesForBroker` (`brokerTickets.size === 0` → warn + return 0) and `v2ReconcileMonitor` (same guard). Both monitor loops guard against mass-close on empty snapshot; that guard is what left these 5 rows open forever.

## New evidence found in this session (DB queries)

1. **10 trades, not 5**: signal 072a819e has 10 trades. First 5 (tp=4335, TP1) closed 11:51:14.982; last 5 (tp=4337, TP2) still open.
2. **Last 5 tickets** = exactly the ones in the error payloads: 2334870079, 2334870097, 2334870269, 2334870737, 2334870796
3. **No order_send logs exist** for this account AT ALL (only auto_be failed rows). Entry path didn't write execution logs.
4. **auto_be failures**: earliest 17:27:35Z, STILL LIVE at 17:49:33Z (680+ rows). Retention (`prune_all_trade_execution_logs`, keep 500/user, every 10min) prunes old rows → earliest surviving rows slide forward (17:37:37Z now).
5. **Loop is LIVE** — failing every ~5s per ticket, 5 tickets cycling (each ticket ~199-200 failures).
6. **message_revision_applied** at 11:50:38 (live_edit, parameter_refresh) — re-classified signal as skipped/commentary
7. First 5 trades have tp=4335 (TP1), last 5 have tp=4337 (TP2) — 5 static layers × 2 TP targets = 10 trades. `manual_settings`: `static_layer_count: 5`, `predefined_tp_pips: [20, 40]`, `fixed_lot: 2` × `multi_trade_leg_percent: 5` → 0.10 lot/leg.
8. `manual_settings`: `move_sl_to_entry_after_mode: "tp_hit"`, tp_index 1, `move_sl_to_entry_type: "sl_only"`, breakeven_offset_pips 2
9. Request payloads: `mode: tp_hit, symbol: XAUUSD, ticket: <cycling>, attempted_sl: ~4332.9-4333.3` — the monitor computes BE SL from entry+2pips
10. **All 5 open trades share ONE broker account** with NO other open positions → once broker closed them, snapshot empty → reconcile empty-snapshot SAFETY deferral prevented ghost-close
11. **OpenTradeReconcileMonitor**: 30s tick, selects open trades, calls `reconcileOpenTradesForBroker` → `fetchOpenBrokerTicketsStrict` → `closeStaleOpenTrades` (batch update, no execution log). Guard: empty snapshot + open rows → defer.
12. **v2ReconcileMonitor**: same empty-snapshot guard; this broker is v1 (no v2 flags, no v2_reconcile_tick logs).

## Code fix (applied locally, uncommitted)

All 5 regex sites now include `unknown\s+ticket`:
- worker/src/autoManagementMonitor.ts:419
- worker/src/cweCloseMonitor.ts:357
- worker/src/forceCloseSignalTrades.ts:50
- worker/src/trailingStopMonitor.ts:286
- worker/src/tradeExecutor/managementExecutor.ts:2096
- partialTpMonitor.ts:97 already had it

## Evidence checklist (prod DB)

- [x] signals row for 072a819e (created 11:49:54Z, message 289, status skipped/commentary_not_trade_signal)
- [x] trades rows (10) + metaapi_order_id/tickets + opened_at + status + auto_be fields
- [x] broker_accounts row (fcabb782, "MASTER ACCOUNT", MT5, login 68341835, v1 engine)
- [x] trade_execution_logs for fcabb782 (auto_be failed only, no order_send)
- [x] any order_send logs for this account — NONE exist
- [x] partial_tp_legs for these trades — NONE
- [x] reconciliation rows — NONE (basket_reconcile_jobs empty for account)
- [x] worker_session_leases / reconcile monitor flow (code-read: openTradeReconcile empty-snapshot guard)
