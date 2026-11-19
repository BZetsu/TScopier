# Incident: Basic-plan accounts silently discard every entry that carries a stop loss or take profit

- **Date detected:** 2026-11-18 · **Root cause confirmed and reproduced:** 2026-11-18 · **Fix implemented and verified:** 2026-11-18
- **Status:** Fix implemented — deployment pending
- **Severity:** High (a paying customer cannot trade at all; four accounts lost signals in 30 days)
- **Component:** worker entry routing (`mergeRouting.ts`, `entryPrepare.ts`), Basic-plan channel defaults
  (`src/lib/channelMessageFilters.ts`), admin visibility (`tscopier-admin`)
- **Root cause:** a filter written for *changes to existing trades* is applied to *new entries*,
  before the code checks whether a trade exists
- **Rendered report:** `incident-2026-11-18-basic-plan-entry-discard.pdf`

## 1. Executive summary (plain English)

A customer on the Basic plan reported that none of his trades were opening. He had 20 messages
from his signal channel and **zero trades** — not opened, not closed, nothing.

Every entry his channel sends carries a stop loss and a take profit, for example:

> Xauusd sell now
> Sl 3776.93
> Tp 3749.22

Our program reads that message correctly. Then, before it builds an order, it asks one question:
*does this message contain a stop loss or take profit?* The answer is yes, so it treats the message
as a **request to change an existing trade**. His channel settings — which the product filled in for
him because he is on the Basic plan — say to ignore those changes. So the program skips the message
entirely, including the entry, and records the vague label "entry not opened".

It never checks whether he had an open trade. It could not have: he had none.

The result is that his entries were discarded before any order existed. Nothing was ever sent to his
broker, which is why changing broker accounts made no difference. The one message he received that
carried no stop loss went straight through to the broker and was attempted — that is the proof that
the stop loss in the message, not the broker, decided the outcome.

He was told the problem was his broker. He changed his broker. He re-linked his Telegram. Neither
could help, and nothing in the app or the admin dashboard showed him or us the setting responsible.

We reproduced the defect on staging four times with four different symbols and prices, and confirmed
it stops the moment the setting is switched to Allow.

## 2. Issue encountered

Customer `029ab2db-98ed-4abe-8704-5c09959b91b8` (Toky RAKOTOBE), Basic plan, MT5 account
`2002280614`, one channel (SMC Gold Expert).

| Message | SL / TP | Recorded outcome | Orders sent |
|---|---|---|---|
| 1097 | 3870.01 / 3842.31 | failed `entry_not_opened` | 0 |
| 1105 | 3849.90 / 3822.22 | failed `entry_not_opened` | 0 |
| 1109 | 3792.93 / 3765.22 | failed `entry_not_opened` | 0 |
| 1112 | 3778.26 / 3750.55 | failed `entry_not_opened` | 0 |
| 1115 | 3776.93 / 3749.22 | failed `entry_not_opened` | 0 |
| 1119 | 3782.04 / 3754.33 | failed `entry_not_opened` | 0 |
| 1104 | none | failed `BROKER_SYMBOL_TRADE_DISABLED` | 1 |
| 1121 | none | failed — OrderSend timed out | 1 |

Two facts stand out. First, every message carrying stops produced **no order attempt at all** —
not a rejection, nothing. Second, the only two messages without stops are the only two that reached
a broker.

His `trades` count is **0**. The single broker refusal was recorded against a broker account he has
since deleted, so his current account has never received an order.

## 3. Affected users

Scan of the last 30 days. Conditions: Basic plan active, account in manual mode, the signal's own
channel set to ignore stop-loss adjustments, new entry carrying a stop loss, and the signal filed as
`entry_not_opened` with no `order_send` record.

| Customer | Account | Dropped signals | Trades in 30 days | Last trade |
|---|---|---|---|---|
| `0b635194…` | MT4 79261348 | 18 | 388 | today |
| `029ab2db…` (reporter) | MT5 2002280614 | 6 | **0** | **never** |
| `1d5b898a…` | MT5 927824 | 5 | 154 | yesterday |
| `dfc7040c…` | MT5 196509025 | 3 | 73 | today |

Total: **32 signals across 4 accounts.**

The funnel, to show how narrow the population is:

| Step | Signals | Customers |
|---|---|---|
| Entry signals with stops, Basic + active + manual | 2,732 | 18 |
| … also meeting the channel filter condition | 1,283 | 17 |
| … actually discarded with no order attempted | 32 | 4 |

The other three customers copy many channels and lose a small fraction of their entries. The reporter
copies one channel, and every message from it matches the pattern, so his loss is total.

Separate outcome: message 1121 (18 Nov, 09:35 UTC) reached the broker and timed out — "the order may
still have filled". Our database shows no trade, so an unrecorded position with no stop loss may exist
on his account. This must be checked in MT5.

## 4. Root cause

1. **The Basic plan sets every channel instruction category to `ignore`** —
   `src/lib/channelMessageFilters.ts:38-41` (`BASIC_PLAN_CHANNEL_FILTERS`), applied because
   `channel_keyword_filters` is Advanced-only (`src/lib/planLimits.ts:116-118`). The values are written
   when a channel is linked (`src/lib/brokerChannelLink.ts:92-104`) or configuration is saved
   (`src/pages/dashboard/AccountConfigPage.tsx:2445-2447`, `:2562`).
2. **The entry path reads those categories before it knows whether a trade exists** —
   `worker/src/tradeExecutor/basketMerge/mergeRouting.ts:633-638` returns
   `{ handled: true, success: false }`. The open-trade lookup is at line `641`, seven lines later.
   Measured: the function makes **zero** database calls before deciding.
3. **The rule was written for a different job.** `f8b2ce57` (2026-05-27) added it to the
   modification-only path, where a trade always exists, and logged the skip. `954a9d00` (2026-06-12)
   added `tryTeaserCompletionMerge`, copied the guard, dropped the log line, and placed it before the
   anchor lookup.
4. **The failure is recorded without a reason** — `worker/src/tradeExecutor/entryPrepare.ts:619-628`
   returns an outcome with no `failureReason`, so `dispatch.ts:514-524` falls back to
   `SKIP_REASON_ENTRY_NOT_OPENED`, which reads like a broker or market problem.
5. **Nobody could see the setting.** In the customer app the control is disabled and covered by an
   upgrade prompt (`AccountConfigPage.tsx:4780`, `:4785-4791`). The admin dashboard never reads the
   field at all: `tscopier-admin` `src/pages/UserDetailPage.tsx:387` omits it from the query, and
   `src/components/user/ChannelBrokerConfigs.tsx:204-231` builds the Filters tab from manual settings
   only. A repository-wide search for `channel_message_filters` in `tscopier-admin` returns nothing.

## 5. The fix (implemented, not yet deployed)

1. **Prove an open basket before reading the filter.** In `tryTeaserCompletionMerge` the channel
   filter is now consulted only after the anchor resolves, the anchor's parsed data is settleable, a
   live leg row exists for the anchor, and the ghost-basket check has cleared it. A new entry
   therefore never reaches the check, and the setting keeps its intended meaning: it still suppresses
   stop-loss and take-profit edits on trades that exist.
2. **Record every skip, with its own reason.** The skip writes a `merge_routed_modify_only` row
   (`status: skipped`, payload reason `channel_filter_ignored`, `anchor_signal_id`, `open_legs`) and
   returns `failureReason: 'basket_modify_skipped_by_channel_filter'`. The separate reason matters:
   `channel_filter_ignored` is listed in `NON_TRADE_SKIP_REASONS`, which the customer log uses to hide
   keyword-filtered messages — reusing it would have hidden the skip and restored the original
   "no explanation" complaint.
3. **Carry the reason to the signal.** `entryPrepare.ts` propagates it with the matching code. The
   parameter-follow-up path in the same file now returns the same reason instead of nothing.
4. **Bring the admin board to full parity with the customer app** (`tscopier-admin`). Every stored
   setting is described, with anything unrecognised falling through to an "Other settings" section;
   the ten channel instruction categories are shown per channel; values that match the Basic preset
   are marked "set by plan default"; the layout is the app's vertical collapsible stack inside the
   existing closable modal, and a raw panel shows the complete per-channel record.
5. **Tell Basic customers what is applied.** The locked channel-filter control now lists the
   categories applied automatically and states that entries still open, with an explicit empty state
   when nothing is ignored.

### Why the first version of the guard move was not enough

The anchor is not proof of an open trade: `resolveOpenBasketAnchorForParameterFollowUp` falls back to
`resolveRecentEntrySignalAnchor`, which selects recent signals in the same channel and direction
within a 10-minute window while skipping only rows with `status = 'skipped'`. An earlier entry that
failed as `entry_not_opened` has `status = 'failed'`, so it qualifies as an anchor. A channel that
re-posts a stopped entry within ten minutes would have been discarded again. That is why the check now
sits after the live-leg proof, and why one of the tests covers exactly this case.

## 6. Files changed

| Repository | File | Change |
|---|---|---|
| unicopier | `worker/src/tradeExecutor/basketMerge/mergeRouting.ts` | guard moved after the live-leg proof; skip logged; own failure reason; two pre-existing unused symbols removed |
| unicopier | `worker/src/tradeExecutor/entryPrepare.ts` | reason propagated with `basket_modify_skipped_by_channel_filter` |
| unicopier | `worker/src/tradeExecutor/basketMerge/teaserFilter.test.ts` | NEW — three regression tests |
| unicopier | `src/lib/copierSkipReasonLabels.ts` | label and detail for the new reason |
| unicopier | `src/pages/dashboard/AccountConfigPage.tsx` | Basic overlay lists the applied categories, with an empty state |
| tscopier-admin | `src/lib/channelSettingsSections.ts` | NEW — describes every stored setting and the ten categories |
| tscopier-admin | `src/components/user/ChannelBrokerConfigs.tsx` | rewritten: vertical collapsible sections, all settings, channel instructions, raw panel |
| tscopier-admin | `src/pages/UserDetailPage.tsx` | account query extended; effective plan passed; modal widened |

Two planned items were not needed: the modal already existed in `tscopier-admin` (it closes on button,
backdrop and Escape), so no new modal file was added; and that repository has no test runner, so the
completeness guarantee is enforced by the "Other settings" fallback rather than a test.

### Previously invisible settings, now shown

Fourteen `manual_settings` keys were never rendered: `add_new_trades_to_existing`,
`allow_high_impact_news`, `copy_limits`, `dynamic_max_layers`, `dynamic_step_pips`, `layering_mode`,
`layering_optimization_strategy`, `multi_trade_max_orders`, `order_comments_enabled`,
`partial_close_percent`, `schema_version`, `signal_entry_prefer`, `static_layer_count`, `tp_lots`.
Beyond those, the ten channel instruction categories and `enforce_signal_channel_filter` were absent
entirely.

## 7. Verification

**Reproduced on staging before the fix**, with `scripts/test-signal.mjs`, test account
`MT5 • 476205482`, Adjust SL and Adjust TP set to Ignore for that channel only:

| Message | Parsed as | Result | Orders | Trades |
|---|---|---|---|---|
| Xagusd sell now · Sl 46.31 · Tp 44.51 | SELL XAGUSD | failed `entry_not_opened` | 0 | 0 |
| EurUsd buy now · Sl 1.0920 · Tp 1.1080 | BUY EURUSD | failed `entry_not_opened` | 0 | 0 |
| Btcusd sell now · Sl 65252 · Tp 62252 | SELL BTCUSD | failed `entry_not_opened` | 0 | 0 |
| Xauusd sell now · Sl 3781.10 · Tp 3746.10 | SELL XAUUSD | failed `entry_not_opened` | 0 | 0 |

**Control:** the identical gold message with the setting on Allow → `executed`, 1 order, 1 trade
(closed afterwards). The deployed version was confirmed identical: `upstream/staging` carries the same
guard at the same lines.

**Tests added** (`teaserFilter.test.ts`):

| Test | Asserts |
|---|---|
| New entry with stops, filter ignored, no basket | `handled: false` — the entry proceeds |
| Recent-signal anchor with no open legs | `handled: false` — no live legs, so no modification |
| Real teaser completion with open legs | still skipped, `basket_modify_skipped_by_channel_filter`, log row written |

**Checks run**

| Check | Result |
|---|---|
| `worker` build (`tsc`) | pass |
| worker targeted tests | 28 passed, 0 failed |
| frontend `npx tsc -b` | pass |
| frontend eslint on changed files | only pre-existing debt, on lines not touched |
| `tscopier-admin` typecheck (`-p tsconfig.app.json`) | pass |
| `tscopier-admin` eslint on changed files | clean |
| `tscopier-admin` `vite build` | pass |

The full worker suite was not run: it exceeds 15 minutes in this environment.

**Review findings addressed:** the skip is no longer hidden by the non-trade filter list; the guard
runs after proof of live legs; the failure reason reaches the signal; keys that render nothing fall
through to "Other settings"; plan labelling uses entitlement rather than the raw plan column;
`enforce_signal_channel_filter` is now shown; an empty filter map says so instead of reading as "all
allowed".

## 8. Deployment status

| Environment | State |
|---|---|
| Production | **Unfixed.** Every Basic customer whose channel sends entries with stops remains exposed. |
| Staging | Code not yet deployed. The test account was prepared for a manual review of the customer view: plan set to `basic`, all ten channel instruction categories set to `ignore`. |
| Admin dashboard | Changed locally; not committed or deployed. |

Nothing has been committed, pushed or deployed from either repository.

## 9. Follow-ups

1. Check account `2002280614` in MT5 for the timed-out order from message 1121 and close it if present.
2. Commit and deploy the worker fix, then re-run the four reproduction cases against the deployed build.
3. Deploy the `tscopier-admin` change so the setting can never be invisible again.
4. Decide the response for the four affected customers, including the reporter's refund request.
5. Restore the staging test account (plan `advanced`, ten categories `allow`) once the review is done.
6. `tscopier-admin` now contains a second configuration reader alongside
   `src/lib/userConfigurationSummary.ts`. They will drift on alias key spellings; converge on one.
7. A failed anchor lookup is indistinguishable from "no open trade". With the guard after the leg
   proof this fails open (the entry opens) rather than closed. Decide whether that is acceptable.
8. Consider whether Basic-plan channel filters should be stored at all, given channel management is not
   offered on that plan.
