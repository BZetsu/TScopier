# Investigation: "Broker · Unknown ticket" — auto-be (autoManagementMonitor) infinite retry loop

Date: 2026-08-10
Status: Root cause identified, fix applied to worker code (5 files), typecheck NOT yet run (user aborted), deploy NOT done.

---

## 1. The error being investigated

Admin dashboard (tscopier-admin) error view for user **Leonardo Araújo**:

- Severity: Major, source: Execution
- Error: `Broker · Unknown ticket` — "The broker does not know this position ticket"
- Action: `auto_be` (auto break-even), 50 execution attempts, all `failed`, error `unknown ticket`, spanning ~48s
- Signal: `072a819e-b505-45a6-9a89-282910aff3e3`
- Request payloads show: `mode: "tp_hit"`, `symbol: "XAUUSD"`, tickets cycling through 5 values, `attempted_sl` ~4333.2x

User question being answered: **WHY does the broker say "unknown ticket", and what fixes it?**

---

## 2. What "unknown ticket" literally means (code-verified)

- The worker sends `POST /OrderModify` with `{ ticket: <metaapi_order_id>, stopLoss, takeProfit }` (`worker/src/fxsocketClient.ts:1158-1167`).
- The MT5 terminal replies with an error; `assertNoApiError` (`worker/src/fxsocketClient.ts:268-294`) throws `FxsocketApiError` using the **broker's own message** (`retcodeDescription` / `error.message`).
- Therefore `unknown ticket` is the **broker terminal's literal answer**: "I have no open order with that ticket."

Conclusion: the broker did NOT "lose" the ticket. The ticket exists in broker history, but the **position with that ticket is no longer open** (closed by TP/SL/user/broker-side close). MT5 refuses to modify a closed position → `unknown ticket`.

---

## 3. Root cause chain (verified with prod data + code)

1. **Signal created** `2026-08-10 11:49:54` — channel `CHARTSYCO ELITE` (channel_id `-1003725132100`), raw message `"I buy gold again now @ 4332 - 4324\n\nSL: 4322\n\nTP: 100/200Pips"`, parsed `buy XAUUSD`, confidence 0.99, entry zone 4324–4332.
2. **5 trades opened on the broker** at `11:50:00–11:50:01` (real MT5 tickets, `opened_at` set, ~300ms apart — a 5-leg basket/static-layer entry):
   | trade id | ticket | entry | opened_at |
   |---|---|---|---|
   | 4678a2cb-d43f-4c15-8cf8-d626a4bad9d5 | 2334870079 | 4333.05 | 11:50:00.064 |
   | 65a87694-5607-48d1-a50f-2ae9cde4e1bc | 2334870097 | 4333.04 | 11:50:00.276 |
   | 7f679e3e-8984-4ce4-aa33-0c69da896fd1 | 2334870269 | 4333.07 | 11:50:00.610 |
   | e8765213-7ef8-4167-98ee-e24475869859 | 2334870737 | 4332.79 | 11:50:00.859 |
   | 7319714b-14e6-4b60-9888-fdc89dc17a1d | 2334870796 | 4332.76 | 11:50:01.037 |
   - All: user `82756f8c-3b8a-4e9e-9614-3ad94e093781`, broker account `fcabb782-82ba-4e33-8a94-77b5c65a29b0` ("MASTER ACCOUNT", MT5, fxsocket `61c32127-f861-49b6-aa1f-b1b0dae67d30`), XAUUSD buy, 0.10 lots, SL 4323, **TP 4337**, `auto_be_mode='tp_hit'`, `auto_be_applied_at=null`, status `open`.
3. **Signal later marked `skipped` (`commentary_not_trade_signal`)** — `listener_events` shows `message_revision_applied` at `11:50:38` (live_edit, parameter_refresh). The trades were already opened before that. (Separate concern: status flip after execution.)
4. **Broker positions eventually closed** (TP at 4337 was only ~4 points above entry; most likely broker-side TP close). **DB trades were never reconciled to `closed`** — still `status='open'`, `auto_be_applied_at=null`.
5. **AutoManagementMonitor** (`worker/src/autoManagementMonitor.ts`) selects `status='open'` + `auto_be_mode` NOT NULL + `auto_be_applied_at` IS NULL, every ~400ms (active) / 15s (idle). With mode `tp_hit` and TP1 hit, the trigger fires → it calls `orderModify` on the dead ticket → broker replies `unknown ticket`.
6. **The benign-error regex at `autoManagementMonitor.ts:419` did NOT include `unknown ticket`**:
   ```ts
   const benign = /not\s+found|already\s+closed|invalid\s+ticket|no\s+such\s+order/i.test(msg)
   ```
   So the error was treated as a hard failure → trade NOT closed → monitor re-selects it next tick → **infinite retry loop**.
7. **Prod evidence of the loop**: `trade_execution_logs` for broker account `fcabb782` has **905 rows, ALL `auto_be` failures**, first `16:38:15.114962Z`, last `16:53:29.975954Z` (~15 min). No `order_send` logs exist for this account at all.

---

## 4. Why the existing "unknown ticket" fix did NOT cover this

The earlier fix (partial-TP incident) added `unknown\s+ticket` to **only one site**: `partialTpMonitor.ts:96-98` (`isPartialTpBenignBrokerError`). That fixed the partial-TP retry loop.

But the same regex exists in **5 other places**, all still missing `unknown ticket`:

| File | Line | Status after fix |
|---|---|---|
| `worker/src/autoManagementMonitor.ts` | 419 | **FIXED** (this is the one in the reported error) |
| `worker/src/cweCloseMonitor.ts` | 357 | **FIXED** |
| `worker/src/trailingStopMonitor.ts` | 286 | **FIXED** |
| `worker/src/tradeExecutor/managementExecutor.ts` | 2096 | **FIXED** |
| `worker/src/forceCloseSignalTrades.ts` | 50 | **FIXED** |
| `worker/src/partialTpMonitor.ts` | 96-98 | already had it |

All now read:
```ts
/not\s+found|already\s+closed|invalid\s+ticket|no\s+such\s+order|unknown\s+ticket/i
```

---

## 5. Fix behavior after the change

When the broker replies `unknown ticket`:

- `autoManagementMonitor` catch branch (`autoManagementMonitor.ts:417-430`) now matches `benign` → updates the trade to `status='closed'`, sets `closed_at` and `auto_be_applied_at` → trade leaves the watch set → **retry loop stops permanently**.
- Same pattern for the other 4 sites (close/cancel instead of retry).
- The 5 stale trades will be auto-closed on the next monitor tick after deploy.

---

## 6. Verification status

- DB-side root cause: **VERIFIED** (prod queries: signal, channel, 5 trades + tickets + opened_at, 905 auto_be failures, no order_send logs, no partial_tp_legs, no basket_reconcile rows, broker account manual_settings with `move_sl_to_entry_after_mode: "tp_hit"`).
- Code fix: applied to 5 files (exact one-token regex additions).
- `tsc --noEmit` for the worker: **NOT RUN** — user aborted the command twice ("fuck the typecheck"). MUST be run before committing.
- Deploy: **NOT done**. Worker changes are local, uncommitted.

---

## 7. Open items / follow-ups

1. Run worker typecheck (`npx tsc --noEmit -p worker/tsconfig.json`) and any relevant tests before commit.
2. Commit + push worker fix to `upstream/staging` (following the repo git workflow), redeploy worker on staging Railway (listener + trade worker), then promote per normal flow.
3. Optionally reconcile the 5 stale `open` trades on prod (they are genuinely closed on the broker). The fix auto-closes them on next tick after deploy.
4. Deeper root cause (separate change, not done): why the DB trade rows stayed `status='open'` after the broker-side close (reconcile/ghost-close deferral on empty snapshots — see prior Aug-10 investigation `docs/Prod_Logs/Listener/investigation-findings-2026-08-10.md`).
5. Note: signal `072a819e` shows `skipped/commentary_not_trade_signal` although 5 trades were opened from it — the live-edit revision at 11:50:38 re-classified it. Worth a separate look.
