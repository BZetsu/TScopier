# Incident: MT5 orders refused with "OLD_VERSION" — the bridge was running an outdated MT5 Manager API build

- **Date detected:** 2026-11-19 · **Root cause confirmed:** 2026-11-19 · **Fix applied and verified:** 2026-11-19
- **Status:** Fixed and verified in production (refusals 02:16 → 09:53 UTC; service restored 10:15 UTC)
- **Severity:** High (every order on an affected account refused; 58 signals lost across 18 users)
- **Component:** MTAPI bridge container (`mtapi`, image `timurila/mt5rest`) on the Contabo VPS — **not** the worker, the parser, or the broker integration code
- **Root cause:** the bridge's MT5 Manager API client was older than the minimum build the brokers now accept, so `MT5API.Connect()` was refused with `ServerException: OLD_VERSION`
- **Rendered report:** `incident-2026-11-19-mtapi-old-version.pdf`

## 1. Executive summary (plain English)

Throughout the morning of 19 November, trades stopped opening for a growing number of
customers, one broker at a time. The app showed every affected account as **connected**, the
signals were being received and understood correctly, and the copier tried to place each order —
but the broker refused every single one.

The refusal did not come from the broker's trading rules. It came one step earlier: the program
that connects our platform to the brokers is a small bridge service, and the bridge was running a
**two-month-old version of the MetaTrader connection software**. MetaQuotes (the maker of
MetaTrader) periodically raises the minimum version that brokers accept, and brokers switch that
requirement on at their own times. Once a broker switched, every order for its accounts was
refused with the message `OLD_VERSION`.

Customers only saw the generic label **"No position opened"**, which looks like a problem with the
signal or with their account. Nothing on the account was actually wrong — no trade was placed,
nothing was left open, and no money was at risk.

The incident ran from **02:16 to 10:15 UTC** and cost **58 signals across 18 customers on 27 MT5
accounts**. It stopped within a minute of updating the bridge service to the current build. The
first connection test after the update returned `OK` instead of `OLD_VERSION`, and no refusal has
been recorded since.

**It had nothing to do with the September "no position opened" bug.** That one was a signal-parsing
problem triggered by edited Telegram messages. This one never reached the parser: the order was
built correctly and refused by the bridge.

## 2. Issue encountered

Customers reported that signals were not being copied. Two examples, both correct parses:

| Signal | User | Parsed | Attempts | Result |
|---|---|---|---|---|
| `888462e5-6f1f-4750-91f8-cdf9d7a5904d` | always luv (`5058374208`, MetaQuotes-Demo) | GOLD sell 3736–3739, SL 3746, TP 3730/3720/3690 | `SellLimit` 3739 at 08:21:58 and 08:22:03 | both `OLD_VERSION (:0)` |
| `38e71f69-5260-4800-bf75-683258d30195` | Luis ESp (`52967879`, ICMarketsSC-Demo) | XAU/USD sell, entry 3728, SL 3755, TP 3724/3700 | 8 legs 09:31:58–09:32:01 | all 8 `OLD_VERSION (:0)` in 2.6 s |

On the dashboard this appeared as `entry_not_opened` / "No position opened". The technical code
shown to the customer was the raw bridge string `OLD_VERSION (:0)`.

## 3. Affected user(s)

27 MT5 accounts across 18 users. Worst hit:

| User | Account | Broker | Failures | First |
|---|---|---|---|---|
| ARUNASALAM SUKUMAR | `1300095969` | JustMarkets-DEMO6 | 89 | 08:00 |
| Luis ESp | `52967879` | ICMarketsSC-Demo | 40 | 08:07 |
| Luis ESp | `52886408` | ICMarketsSC-Demo | 39 | 02:46 |
| ARUNASALAM SUKUMAR | `1300095974` | JustMarkets-DEMO6 | 31 | 02:16 |
| Stefan Zeller | `26422396` | VantageMarkets-Demo | 13 | 07:47 |
| FREDY ALBERTO | `163127399` | Exness-MT5Real22 | 10 | 07:20 |
| Luis ESp | `52992109` | ICMarketsSC-Demo | 8 | 02:46 |
| always luv | `5058374208` | MetaQuotes-Demo | 2 | 08:21 |

Brokers affected: JustMarkets, ICMarkets, Vantage, Exness, MetaQuotes-Demo, Deriv, GNT Capital,
AquaFunded, TenTrade.

## 4. Root cause

`mt5rest` does **not** run a MetaTrader terminal. It is a .NET REST wrapper that logs in to each
broker's trade server through the **MT5 Manager API** (`mtapi.dll` / `mt5api.dll`). The decisive
evidence is the bridge's own stack trace:

```
[10:06:38 WRN]  <OLD_VERSION>
mtapi.mt5.ServerException: OLD_VERSION
   at mtapi.mt5.MT5API.Connect()
   at mt5rest.MyControllerBase.GetClient(String id, String method, Boolean checkConnect) in /src/mt5rest/MyControllerBase.cs:line 253
   at mt5rest.Connection.CheckConnect(String id) in /src/mt5rest/Controllers/Connection.cs:line 1903
```

`OLD_VERSION` is thrown at `Connect()` — the manager login — not at order send. The running
container was built from the **10 Sep 2026** image (vendor tag `26.09.10-15.08`; `/app` files
dated 10 Sep 19:08). The vendor had published newer builds ever since, including **ten on 19 Nov**
(`26.11.19-05.02` … `26.11.19-09.26`), because that is how they ship updated Manager API clients.

Brokers raise the minimum accepted build in waves, which is why the failures arrived one broker at
a time and why no account ever recovered on its own:

| Broker | First `OLD_VERSION` (UTC) | Last successful order |
|---|---|---|
| JustMarkets-DEMO6 | 02:16 | 02:06 |
| ICMarketsSC-Demo (`52886408`, `52992109`) | 02:46 | 18 Nov 19:00 |
| GNTCapital-Live | 04:10 | 18 Nov 10:35 |
| Exness-MT5Real30 | 04:16 | 18 Nov 07:26 |
| Deriv-Demo | 05:13 | 18 Nov 07:30 |
| VantageMarkets-Live 6 | 06:34 | 16 Nov 17:23 |
| ICMarketsSC-Demo (`52967879`) | 08:07 | 01:26 |
| MetaQuotes-Demo | 08:10 (`5051280860`) / 08:21 (`5058374208`) / 09:17 (`114360758`, `5058361628`) | 05:47 |
| Vantage / JustMarkets (rest) | 09:17 → 09:53 | — |

The last refusal of the day was **09:53**; the bridge was restored at **10:15**, which is why the two times differ in this report.

Across all 27 accounts there are **zero successful orders after the first `OLD_VERSION`**, and the
accounts stayed `connected` throughout — an out-of-date Manager API still logs in far enough to
stream prices and report balances, and only refuses trading.

Why it was invisible for eight hours:

1. The customer-visible reason is the generic `entry_not_opened`, which reads like a parser or
   broker-rejection problem. The raw bridge string only appeared as the technical code.
2. `mtapi_accounts_error` and `mtapi_connect_errors` measure the *account* connection columns,
   which stayed `connected`.
3. `executions_failing` only reached its **warning** threshold at 08:55, after six hours and dozens
   of lost signals, and warning recipients are not paged.

## 5. The fix

Operational (applied on the VPS):

1. `docker pull timurila/mt5rest` → image created **2026-11-19T09:27:01Z** (`26.11.19-09.26`).
2. Recreated the container through the redactor installer, which preserves the `UserKey` licence
   env, the `127.0.0.1:8080` binding, the `unless-stopped` restart policy and the password-redacting
   entrypoint:
   ```bash
   cd /root/mtapi-log-redactor
   CONTAINER=mtapi IMAGE=timurila/mt5rest HOST_IP=127.0.0.1 HOST_PORT=8080 CONTAINER_PORT=80 bash ./install.sh
   ```
3. Verified at the bridge: `curl -s "http://127.0.0.1:8080/CheckConnect?id=<session>"` → **`OK`**
   (previously `201` with an `OLD_VERSION` body).

Code (in this repository):

- `supabase/functions/alert-evaluator/index.ts` — new `evalMtapiOldVersion` rule, its dispatch case
  in `evaluate()`, the threshold documentation line and a `NEXT_ACTION` runbook entry. It fires on the
  **first affected account** (`max_accounts: 0`): `OLD_VERSION` has no benign cause, nothing
  self-heals, and this incident's first 24 minutes were a single account before the rest followed.
  `max_rows: 6` covers rows that arrive without an account id, and `persistence_minutes: 5` stops a
  quiet ten-minute gap from resolving the event, emailing "recovered" and then muting the re-fire
  under the cooldown.
- `supabase/migrations/20261119120000_mtapi_old_version_alert.sql` — adds the `mtapi_old_version`
  rule, severity **critical**, `{"max_accounts": 0, "max_rows": 6, "persistence_minutes": 5}` over a
  10-minute window, 900 s cooldown.

## 6. Files changed

| File | Change |
|---|---|
| `supabase/functions/alert-evaluator/index.ts` | `evalMtapiOldVersion`, dispatch case, threshold doc, `NEXT_ACTION` runbook |
| `supabase/migrations/20261119120000_mtapi_old_version_alert.sql` | `mtapi_old_version` alert rule (critical) |
| `apply-mtapi-old-version-alert-2026-11-19.sql` | SQL-editor copy of the rule, with checks, replay evidence and kill switch |
| `docs/incidents/incident-2026-11-19-mtapi-old-version.md/.html/.pdf` | this report |
| `docs/PROJECT_MEMORY.md` | changelog entry |

Bridge: container `mtapi` recreated from image `26.11.19-09.26`. No worker, parser or broker-code
change was needed — the parser and dispatcher were correct throughout.

## 7. Verification

- **Refusals stop:** `select count(*) from trade_execution_logs where error_message ilike '%OLD_VERSION%' and created_at >= '2026-11-19 10:15:00+00'` → **0** (294 before).
- **Connect works:** `CheckConnect` on a live session returns `OK`; no `ServerException` in `docker logs mtapi`.
- **Sessions re-registered** after the recreate (for example Luis `52967879` moved from `6245bb1f…` to `a26882a5…`, Vantage `26422396` to `30ad5ed1…`).
- **Write path healthy:** 10 `BROKER_WRITE_FENCE_REJECTED` rows between 10:16:26 and 10:17:07 only — signals caught mid-restart while the worker held the pre-restart session id — and none since.
- **Trading resumed end-to-end:** 8 trades opened between 10:24 and 10:30 UTC, all `status = open` with real broker tickets, on accounts that had been refused minutes earlier — echi fru `223594169` (Exness-MT5Real30) at 10:25:39, Stefan Zeller `26422396` and Speedy TV `26386377` (VantageMarkets-Demo) at 10:30. 8 successful `order_send` rows match the 8 trades; no duplicate or half-filled basket.
- **The new rule would have caught it early:** replaying the incident's rows through the rule's
  thresholds (10-minute buckets, `max_accounts 0`, `max_rows 6`) fires in the **02:10 bucket** — the
  first refusal is 02:16 — and with the 5-minute persistence pages at about **02:21**, five minutes
  into the incident. The old `executions_failing` warning only fired at 08:55.
  ```
  bucket | rows | accts | would_fire
  02:10  |   1  |   1   | true
  02:40  |  18  |   3   | true
  02:50  |   2  |   1   | true
  03:00  |   3  |   1   | true
  ```

## 8. Deployment status

- **Bridge:** fixed on the VPS (image `26.11.19-09.26`), verified with `CheckConnect` and the logs.
- **alert-evaluator:** **deployed to production** (`sxkpcovbyaficvtkpsdo`) and verified by invocation — 17 rules, 17 evaluated, **0 skipped**, nothing fired, no emails. The deploy needed one unrelated change: `@supabase/supabase-js` pinned to `2.119.1`, because npm's `latest` (2.119.2) depended on `@supabase/auth-js@2.119.2`, whose tarball 404s and breaks the edge bundler for every function in this repo.
- **Migration:** **applied** — the rule row is present and enabled (critical, 10-minute window, 900 s cooldown, `{"max_accounts":0,"max_rows":6,"persistence_minutes":5}`) and `20261119120000` is recorded in `supabase_migrations.schema_migrations`.
- **Worker:** no change, no deploy required.
- **Not force-fired on purpose:** the rule's thresholds were validated by replaying the real incident rows rather than by injecting a synthetic failure, which would have paged critical recipients for a non-event.

## 9. Follow-ups

1. **Pin the image and refresh it deliberately.** The container had been recreated on 14 Nov with a
   stale local `latest` from September. Run a pinned tag and pull a newer build on a schedule
   (monthly is enough; broker minimum-build waves are the trigger). Add the image creation date to
   the Systems Health page so a stale bridge is visible before brokers enforce.
2. **Deploy the new alert rule** (evaluator first, then migration) and confirm it fires by
   threshold-testing with historical rows.
3. **Log rotation** on the Docker daemon (`max-size`/`max-file`). `docker logs --since 12h` had to be
   interrupted because the json-file had grown so large.
4. **Reconcile the nginx internal token** on the VPS: `/root/.mtapi_internal_token` does not match
   `map $http_x_internal_token` in `/etc/nginx/nginx.conf`, so verification calls with the file's
   value get 403. It does not affect the worker (which authenticates with the Bearer key), but the
   documented rotation source is wrong.
5. **Customer communication** for the 58 lost signals was deliberately not raised as tickets; no
   replay is recommended, because the entries are hours old and re-entering them at current prices
   is a worse trade than no trade.
