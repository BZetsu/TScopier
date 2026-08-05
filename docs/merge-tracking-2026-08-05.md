# Merge Tracking — 2026-08-05: upstream/main + staging + dev integration

Reference document for the `integrate/upstream-sync` branch. Every commit pulled today is
listed with the **problem** it was fixing, **why** it exists, **who** pushed it, the **files**
it touched, and — where relevant — **how it conflicted** with our local work and the outcome.

Verified branch state:
- `integrate/upstream-sync..upstream/main` → 0 (all main merged)
- `integrate/upstream-sync..upstream/staging` → 0 (all staging merged)
- `integrate/upstream-sync..upstream/dev` → 0 (all dev merged)
- `integrate/upstream-sync..backup/all-local-work-2026-08-05` → 0 (all local work present)

Merge commits: `b64aa7c2` (dev) → `3cbfa628` (staging) → `91afd9ba` (main) → `7a4e0ded` (docs/fix).
Post-integration re-merges after upstream moved: `3078cb47` (staging re-merge) → `ca6b2459` (main re-merge) →
`cacd4da2` (staging re-merge #2, includes new `d30899d4` JWT config).
Local work preserved on `backup/all-local-work-2026-08-05` (pushed to origin), incident fix as `26e09770`.

> **Regression found & fixed during the pre-push audit:** the original main-merge resolution dropped
> upstream's layering support gate + hardCap ceiling + unique stepIdx from
> `worker/src/manualPlanning/planMultiManualOrders.ts`, leaving HEAD with 6 failing planner tests.
> Fixed by rebuilding the file from upstream/main + re-inserting our teaser/no-TP block →
> **84/84 planner tests pass**. Full details in `docs/upstream-integration-2026-08-05.md` §4.3/§4.5.

---

## 1. Branch topology at start

None of the three upstream branches was an ancestor of another, and all diverged from local work:

```
local fix/reconnect-fix-staging   (48 commits incl. incident fix 26e09770)
upstream/main    head 850dfc2d    Stripe + Telegram + manual-planning (prod, bypassed normal flow)
upstream/staging head 5e4b57e2    rangeBroker pending fills + layering GA + trade-dupe fix
upstream/dev     head 2b82ee78    layering constraint sizing + Sentry + XAU pip restore
```

Why they diverged: main was shipped to production directly (Osodi hotfixes), staging accumulated the
rangeBroker/pending-fill stream, dev accumulated the layering feature stream. All three needed to be
recombined locally without losing our 48 commits.

---

## 2. upstream/dev — full commit-by-commit context

Dev is the integration branch for feature work (PRs #66/#69 land here via admin merge).

### eb6f041f — fix: cast layering fallback manual settings to ManualSettings type
- **Who:** BZetsu (2026-07-31)
- **Problem:** `configAccount.manual_settings` from Supabase was read as a raw object and passed around
  as `ManualSettings`. The type could not be guaranteed; `layering_mode` etc. were `string | undefined`,
  causing silent misreads and corrupt saves.
- **Why:** Layering code reads `manual_settings.layering_mode` everywhere; an untyped value breaks mode
  resolution.
- **Files:** `src/pages/dashboard/AccountConfigPage.tsx`
- **Conflict:** Yes (AccountConfigPage — see §5.1). Dev's `normalizeManualSettings` call is the stronger
  version of this same cast and was kept.

### aa3f502b — docs: changelog entry for staging layering type fix
- **Who:** BZetsu (2026-07-31). Changelog only; no code.

### d98d00c1 — fix(layering): empty allowlist means no restriction, not restrict-everyone
- **Who:** BZetsu (2026-07-31)
- **Problem:** Serious off-by-design bug. `allowlist().size === 0` was treated as "no accounts allowed"
  (deny-all) instead of "no restriction" (allow-all). With the flags removed for GA, an unset allowlist
  would have locked every account out of layering.
- **Why:** The allowlist is an opt-in list; when unset the feature must be available to everyone who has
  the plan.
- **Files:** `supabase/functions/layering-mode-capabilities/index.ts`, `supabase/functions/update-layering-settings/index.ts`

### e8b5dbc4 — docs: changelog entry for layering allowlist fix
- **Who:** BZetsu (2026-07-31). Changelog only.

### 99819542 — feat(layering): accounconfigpage ui fix
- **Who:** emmydapson (2026-07-31)
- **Problem:** AccountConfigPage layering-mode UI broke when a capability source was empty or an account
  had no plan row.
- **Why:** UI fix for the layering-modes feature being validated on staging.
- **Files:** `src/pages/dashboard/AccountConfigPage.tsx`, layering capability tests,
  `supabase/functions/update-layering-settings/index.ts`, migration `20260731120000_layering_plans.sql`,
  `worker/src/layeringPlanLifecycle.{ts,test.ts}`, `worker/src/manualPlanning/layeringPlanPersistence.test.ts`.

### d711f6c6 — feat(layering): fixed pr conflict and merge
- **Who:** emmydapson (2026-07-31). Intermediate conflict-resolution commit during the layering PR;
  no independent behavior.

### c6f12703 — feat(layering): Implemented the constraint-based layer sizing path (PR #69)
- **Who:** emmydapson (2026-08-02)
- **Problem:** Layer lot sizing was fixed per-leg; accounts with different balances got oversized or
  undersized baskets. Needed sizing derived from account constraints (balance, risk) with an optimization
  strategy.
- **Why:** The core layering feature — sizes layers via `worker/src/manualPlanning/layerSizingConstraints.ts`
  and exposes `layering_optimization_strategy` (`adjust_percent` / `reduce_layers` / `widen_step`).
  Removes the old per-mode execution flags (GA) and adds `updateLayeringSettings` support for the strategy.
- **Files (key):** `worker/src/manualPlanning/layerSizingConstraints.ts` (+test, 216 lines),
  `layeringModeCalculators.ts`, `layeringModes.ts`, `layeringPlanPersistence.ts`, `src/lib/layeringModes.ts`,
  `src/lib/updateLayeringSettings.ts`, `src/pages/dashboard/AccountConfigPage.tsx`, both layering edge
  functions, `20260731120000_layering_plans.sql`, `src/types/database.ts`.
- **Conflict:** Yes (AccountConfigPage, update-layering-settings — see §5.1/§5.2).

### c00387fe — feat(observability): add Sentry business issue reporting
- **Who:** emmydapson (2026-08-04)
- **Problem:** The worker only reported infra-level errors; business failures (a trade that should have
  opened but didn't, a management leg that failed, a signal dropped) were invisible. Impossible to diagnose
  "quiet" money-losing bugs in prod.
- **Why:** Adds `worker/src/observability/businessEvents.ts` — structured business-event reporting to
  Sentry across the trade lifecycle: `layeringPlanLifecycle`, `signalQueueConsumer`, `dispatch`,
  `managementExecutor`, `orderLegExecution`, `tradeSignalPush`, `userListener`, `virtualPendingMonitor`,
  `sessionManager`, `rangeBrokerPendingMonitor`, `openTradeReconcileMonitor`. 1166 insertions.
- **Files:** `worker/src/observability/businessEvents.{ts,test.ts}`, `docs/sentry-business-observability.md`,
  `worker/.env.example`, 21 files instrumented.
- **Conflict:** Not a content conflict, but touches files we also touched (`userListener.ts`,
  `signalQueueConsumer.ts`, `dispatch.ts`) — auto-merged cleanly because edits were in different regions
  (reconnect handling vs event calls).

### 2b82ee78 — fix(management): restore XAU signal pip precision
- **Who:** emmydapson (2026-08-04)
- **Problem:** Staging's `99aaaf42` changed metals pip from 0.01 → 0.1 price units. That was correct for
  the *broker/pip calculator* convention but broke *signal-pip* consumers: breakeven stop-loss offsets in
  auto-management started moving SL by 10× too much on XAUUSD.
- **Why:** Restore `signalPipPrice` semantics so metal SL offsets use 0.01 price units per pip; removes the
  `roundSignalPips` rounding helper that masked precision issues; tightens tests to pin exact offsets.
- **Files:** `worker/src/signalPip.ts`, `worker/src/autoManagement.test.ts`, `signalEntryRange.test.ts`,
  `signalStopUnits.test.ts`, `brokerRangeLadderPricing.test.ts`, `materializeBrokerRangePendingLegs.test.ts`, `CHANGELOG.md`.
- **Outcome:** This is the **canonical resolution** of the pip conflict between staging (0.1) and the
  management code. Because dev merged last, it correctly overrides staging's pip change for signal management.

---

## 3. upstream/staging — full commit-by-commit context

Three work streams: **rangeBroker / broker-pending fills** (Osodi, the largest), **layering GA** (from dev),
and the **trade-duplication incident fix**.

### 377a7238 — feat(layering): multi-trade order estimation with signal entry range support
- **Who:** Osodi (08-03)
- **Problem:** When a signal defines an entry range, the planner estimated total-open-trade count ignoring
  the range, so reserved range legs were not counted → cap violations / wrong lot split.
- **Why:** Adds `useSignalEntryRange` option so `estimateMultiTradeOrderCount` counts full reserved pendings
  when the entry range is used.
- **Files:** `src/lib/estimateMultiTradeOrders.{ts,test.ts}`, `AccountConfigPage.tsx`,
  `accountConfigPersistence.ts`, `computeMultiTradeOrderCount.{ts,test.ts}`, `normalizeManualSettings.ts`,
  `planMultiManualOrders.ts`, `rangeSplit.ts`, `rangePendingFireGuard.ts`, `slTpRefresh.ts`,
  `virtualPendingMaterialize.ts`, `manualPlanner.test.ts`.

### ed4d6f5e — feat(layering): normalize sizing strategy to 'adjust_percent'
- **Who:** Osodi (08-03)
- **Problem:** `layering_optimization_strategy` could be saved as invalid/old values or undefined, leaving
  the planner with no sizing strategy.
- **Why:** `normalizeLayeringModeSettings` now always yields `adjust_percent` unless explicitly
  `reduce_layers`/`widen_step`; UI and edge fn match.
- **Files:** `src/lib/layeringModes.{ts,test.ts}`, `AccountConfigPage.tsx`.

### 99aaaf42 — fix(pip): XAUUSD pip value 0.01 → 0.1 (trader convention)
- **Who:** Osodi (08-03)
- **Problem:** XAUUSD pip was computed as 0.01 price units (myfxbook convention) but retail traders treat
  1 pip = 0.1 on gold. SL/TP distances and step pips shown to users were off by 10× from their expectation.
- **Why:** Align pip math with trader convention. **This is the change dev `2b82ee78` later reverted in the
  signal-management path** — the convention change stayed in pip *calculators* but not in *signal-pip*
  consumers.
- **Files:** `src/lib/pipCalculator.ts`, `src/lib/pipMath.ts`, `src/lib/signalPip.ts`,
  `supabase/functions/_shared/signalPip.ts`, `worker/src/pipCalculator.ts`, `worker/src/pipMath.ts`,
  `worker/src/signalPip.ts`, `worker/src/managementScope.ts`, 6 test files.

### 63a2d6c2 — feat(tests): multi-trade order estimation and planning tests
- **Who:** Osodi (08-03)
- **Problem:** Math changes needed pinning; also fixes `loadBasketLegCap` to fall back to multi-range plan
  values when unset, and makes `materializeBrokerRangePendingLegs` remap prices for planned entries.
- **Files:** `estimateMultiTradeOrders.test.ts`, `planMultiManualOrders.ts`, `rangePendingFireGuard.ts`,
  `TradeExecutor.ts`, `slTpRefresh.ts`, `entryPrepare.ts`, `materializeBrokerRangePendingLegs.ts`,
  `rangePendingPriceRemap.ts` (+test), `rangeTradeExecutor.ts`, `manualPlanner.test.ts`.

### 064e856d — feat(range-layering): auto step functionality
- **Who:** Osodi (08-03)
- **Problem:** Users had to hand-set `range_step_pips`; a 0 value was invalid. Hand-picking a step that fills
  the range exactly with reserved legs was error-prone.
- **Why:** `range_step_pips = 0` now means **auto**: evenly space the reserved legs across the range distance.
  Adds `worker/src/manualPlanning/resolveRangeLayerStepPips.ts` (+test) and frontend
  `src/lib/resolveRangeLayerStepPips.ts` (+test).
- **Files:** `defaultManualSettings.ts`, `estimateMultiTradeOrders.{ts,test.ts}`, `AccountConfigPage.tsx`,
  `accountConfigPersistence.ts`, `computeMultiTradeOrderCount.{ts,test.ts}`, `normalizeManualSettings.{ts,test.ts}`,
  `planMultiManualOrders.ts`, `rangeSplit.ts`, `resolveRangeLayerStepPips.{ts,test.ts}`,
  `manualPlanning/types.ts`, `brokerRangeLadderPricing.ts`.

### 713953d5 — feat(i18n): step mode translations
- **Who:** Osodi (08-03)
- **Problem:** New Auto/Manual step-mode UI had English-only strings.
- **Why:** Adds "Auto"/"Manual" step-mode keys across ar, en, es, fr, ja, nl, pl, ru, sv locales + type.
- **Files:** 9 locale files + `types.ts` + `AccountConfigPage.tsx` + `accountConfigPersistence.ts` +
  `normalizeManualSettings.ts` + `planMultiManualOrders.ts` + `manualPlanner.test.ts`.

### d93bc07f — feat(range-layering): minimum auto step pips
- **Who:** Osodi (08-03)
- **Problem:** Auto step could pack reserved legs tighter than 1 pip → impossible/overlapping order prices.
- **Why:** Enforces a minimum auto step of 1 pip; `resolveRangeLayerStepPips` now returns fitted legs +
  effective step pips.
- **Files:** `src/i18n/.../en.ts`, `estimateMultiTradeOrders.{ts,test.ts}`, `resolveRangeLayerStepPips.ts`,
  `layerConcurrentFire.{ts,test.ts}`, `manualPlanner.test.ts`, `computeMultiTradeOrderCount.ts`,
  `rangeSplit.ts`, `resolveRangeLayerStepPips.{ts,test.ts}`.

### bb283f54 — feat(tests): manual order planning and range layering tests
- **Who:** Osodi (08-03)
- **Problem:** Behavior changes to step indices/trigger maps weren't covered; `buildRangeLayerTriggerMap`
  needed to support new cases (linear spacing, active legs).
- **Files:** `manualPlanner.test.ts`, `planMultiManualOrders.ts`, `rangeLayerTriggers.{ts,test.ts}`,
  `rangePendingLadderSync.{ts,test.ts}`, `brokerRangeLadderPricing.ts`, `materializeBrokerRangePendingLegs.{ts,test.ts}`.

### 3e4b2a67 — refactor(tradeExecutor): triggerPriceFor signature
- **Who:** Osodi (08-03)
- **Problem:** `triggerPriceFor` accepted a full `VirtualPendingLeg` but only used 3 fields; the dev-side test
  cleanup (`2b82ee78`) removed unused fields from test calls, so the type had to narrow.
- **Why:** Type safety: `Pick<VirtualPendingLeg, 'isBuy' | 'stepIdx' | 'stepPriceOffset'>`.
- **Files:** `worker/src/tradeExecutor/helpers.ts`. Auto-merged.

### befda34d — feat(tradeExecutor): introduce `blockNewEntry` option — THE INCIDENT FIX
- **Who:** Osodi (08-03)
- **Problem:** **Trade duplication incident (2026-08-04).** When a Telegram signal was edited/re-sent, the
  revision path re-ran entry execution. Because live-fast skipped the already-materialized probe, a revision
  could place a **second** market or broker-pending basket on top of the first. Signals were re-executed up
  to 75×. Full report: `docs/incident-2026-08-04-trade-duplication.md`.
- **Why:** Structural fix — a revision may refresh SL/TP but must never open new orders. Adds `blockNewEntry`
  to `sendOpts`; `prepareEntryExecution` skips new entries when a revision already materialized;
  `materializeBrokerRangePendingLegs` skips already-open step indices; new
  `worker/src/tradeExecutor/messageRevisionEntryGuard.ts` (+test).
- **Files:** `TradeExecutor.ts` (+83), `entryPrepare.ts` (+31),
  `materializeBrokerRangePendingLegs.{ts,test.ts}` (+82), `messageRevisionEntryGuard.{ts,test.ts}`.
- **Conflict:** Yes — TradeExecutor.ts and entryPrepare.ts (§5.2). **Took staging's fix** over our interim
  claim-reuse fix (our `26e09770`). See §5 comparison.

### 1184ec42 — feat(tradeExecutor): broker range pending legs + dedupe
- **Who:** Osodi (08-03)
- **Problem:** After a reconnect, materializing broker-pending range legs could double-open the same step
  (no reservation, no dedupe), and `OpenedOrders` errors were unhandled.
- **Why:** Adopts existing limit prices from live broker orders (prevents duplicates), adds error handling
  for dedupe failures, a reservation mechanism for unique price claims, and skips virtual ladder inserts in
  broker-pending mode to avoid races. Adds `brokerPendingOpenedDedupe.ts` (+test).
- **Files:** `materializeBrokerRangePendingLegs.ts`, `brokerPendingOpenedDedupe.{ts,test.ts}`, `slTpRefresh.ts`,
  migration `20260803120000_range_pending_broker_pending_unique_step.sql`.

### 37ec25b8 — feat(basket): broker pending orders + new fields
- **Who:** Osodi (08-03)
- **Problem:** Broker-pending legs were counted as active but not handled as naked (no SL/TP) until filled;
  closing-worse logic needed a close price for broker orders.
- **Why:** Adds `cwe_close_price` field; keeps broker pending orders naked while retaining desired stops for
  post-fill assignment; counts `broker_pending` in active pending. Adds `rangeBasketLayeringLock.ts` (+test).
- **Files:** `basketModFollowUp.ts`, `basketSlTpReconcile.ts`, `orderModifyBenign.test.ts`,
  `rangeBasketLayeringLock.{ts,test.ts}`, `rangeBasketTpSync.ts`, `rangeBrokerPendingMonitor.ts`,
  `rangeLayerBasketWatch.{ts,test.ts}`, `rangePendingLadderSync.{ts,test.ts}`, `rangePendingLegDelete.ts`,
  `signalRangeEntryService.ts`, `layeringModeBrokerPending.{ts,test.ts}`, `materializeBrokerRangePendingLegs.{ts,test.ts}`,
  `virtualPendingMonitor.ts`.

### 0234b975 — feat(trade): `delete_pendings` action
- **Who:** Osodi (08-03)
- **Problem:** Telegram trading-channel messages can ask to delete pending orders, but the intent parser had
  no such action.
- **Why:** Maps `delete_pendings` to an intent/action for both the AI prompt and JSON structure; wires handling
  across trade-management functions.
- **Note:** This commit also committed **compiled `worker/dist/*.js` build artifacts** (~90 files). These were
  excluded from our merge (see §6).
- **Files:** intent mapping, AI prompt, trade management logic, plus the dist artifacts.

### 245e91e3 — feat(rangeBroker): filled position resolution + stop assignment
- **Who:** Osodi (08-03)
- **Problem:** When a broker-pending range leg fills, the worker couldn't reliably match the filled ticket to
  the basket leg (comment/price matching was fragile), so stops were never assigned to the real position.
- **Why:** Adds `resolveFilledPositionTicket` + `readOpenedComment`; `markBrokerRangeLegFilled` now applies
  freshly assigned SL/TP to naked fills. Adds `brokerPendingFillStops.ts` (+test).
- **Files:** `brokerPendingFillStops.{ts,test.ts}`, `rangeBrokerPendingMonitor.ts`.

### f05d4467 — feat(basket): naked fills + reconcile logic
- **Who:** Osodi (08-03)
- **Problem:** Naked broker fills (a broker-pending order filled with no SL/TP attached) were skipped by the
  DB-only "already synced" check, so their stops were never reconciled.
- **Why:** Removes the DB-only skip in `runBasketLegModifies`; `syncRangeBasketTakeProfits` honors
  `forceLayeringRebalance`; adds `enqueueReconcileAfterBrokerFill`; VirtualPendingMonitor triggers reconcile
  on naked opens.
- **Files:** `basketSlTpReconcile.ts`, `nakedFillStopsPersist.test.ts`, `rangeBasketTpSync.ts`,
  `rangeBrokerPendingMonitor.ts`, `virtualPendingMonitor.ts`.

### 2f94682e — feat(rangeBroker): stop assignment for broker pending fills (iteration 2)
- **Who:** Osodi (08-03)
- **Problem:** After a naked broker-pending fill, SL/TP reassignment happened too late / was skipped.
- **Why:** `markBrokerRangeLegFilled` prioritizes SL/TP reassignment after a naked fill;
  `patchPendingRangeLegTakeProfits` and `setActivePendingRangeLegsTakeProfit` now include `broker_pending`
  status.
- **Files:** `brokerPendingFillStops.ts`, `brokerPendingFillTpRedistribute.test.ts`, `rangeBasketTpSync.ts`,
  `rangeBrokerPendingMonitor.ts`, `rangePendingLadderSync.test.ts`.

### 6d9b2d8a — refactor(rangeBroker): pending fill detection
- **Who:** Osodi (08-04)
- **Problem:** The previous fill-handling was a tangle; exclusion of already-booked tickets was broken, so a
  pending fill could be misidentified as opened or re-processed.
- **Why:** New `brokerPendingFillDetect.ts` (+test) cleanly decides opened vs closed fills and excludes
  already-booked tickets. Removes dead filled-position-resolution code.
- **Files:** `brokerPendingFillDetect.{ts,test.ts}`, `rangeBrokerPendingMonitor.ts`.

### 5e4b57e2 — feat(rangeBroker): pending stop synchronization
- **Who:** Osodi (08-04)
- **Problem:** Broker-pending stops went stale: a TP refresh skipped `broker_pending` legs, and naked
  broker-pending stops weren't healed even when open legs had SL/TP.
- **Why:** `patchPendingRangeLegTakeProfits` includes `broker_pending`; new `syncBrokerPendingStopsForBasket`
  in `brokerPendingStopsSync.ts` (+test); `healNakedBrokerPendingStops` heals from open-leg SL/TP.
- **Files:** `brokerPendingStopsSync.{ts,test.ts}`, `brokerPendingFillTpRedistribute.test.ts`,
  `rangeBasketTpSync.ts`, `rangeBrokerPendingMonitor.ts`, `rangePendingLadderSync.{ts,test.ts}`,
  `layeringModeBrokerPending.ts`, `materializeBrokerRangePendingLegs.ts`.

### 4a4d2cd4 — merge upstream/dev into staging (Emma's constraint sizing) — LAYERING GA
- **Who:** BZetsu (08-02)
- **Problem:** Layering modes were feature-flagged (kill-switch + per-mode env flags). The feature was ready
  for GA; the flags kept it off.
- **Why:** Brings dev's `c6f12703` + allowlist fix + optimization strategy into staging and **removes the
  flags**: `configurationAllowed = advancedAllowed && listed` (allowlist only).
- **Conflict:** Yes — `supabase/functions/update-layering-settings/index.ts` (this is the exact same conflict
  we hit in §5.1/§5.2). Upstream resolved it the same way we eventually did: **take GA, drop flags**.

---

## 4. upstream/main — full commit-by-commit context

Main is production. These were shipped to prod ahead of dev/staging (hotfix bypass), which is why they
conflict with our branch state.

### df5180d8 — fix(worker): prevent unhandled TelegramSessionInvalidError crash during reconnect
- **Who:** BZetsu (2026-07-31)
- **Problem:** `forceReconnect` awaited `warmEntityCache()` with no try/catch. When a session died
  mid-reconnect (401 AUTH_KEY_UNREGISTERED), the rejection escaped through the fire-and-forget
  `requestReconnect('update_loop_timeout')` caller and **killed the whole worker**. 4 crashes in 20 min on
  2026-07-31.
- **Why:** `forceReconnect` now catches session-invalid during post-connect warmup, marks disconnected,
  traces `recovery_invalidated`, schedules a deferred retry; `requestReconnect` attaches a rejection handler
  so a failing cycle can never surface as an unhandled rejection.
- **Files:** `worker/src/userListener.ts`
- **Note:** This is the **same root cause** as our local `05b05961` + docs `c56cb7cb` — both sides fixed it
  independently. Ours auto-merged (our fix is identical in spirit); the doc commit stayed ours.

### e785c798 — feat(worker): manual order planning + execution logic
- **Who:** Osodi (08-05)
- **Problem 1 — teaser signals:** A signal with no TP (teaser) was burst-split into N full-lot clones (one
  per "TP group") → massive oversize on the first order. Fix: null-TP groups fall back to a single full-lot
  immediate order; range virtuals may still layer.
- **Problem 2 — duplicate legs:** identical immediate legs were placed twice. Fix: `collapseIdenticalLegs`
  dedupes identical immediate legs in order execution.
- **Problem 3 — claim failures:** a duplicate-leg or dispatch-claim failure was silent. Fix: error handling +
  logging (`dispatch_claim_error` row).
- **Files:** `worker/src/manualPlanning/planMultiManualOrders.ts`, `worker/src/tradeExecutor/orderLegExecution.ts`,
  `worker/src/tradeExecutor/TradeExecutor.ts`, `worker/src/tradeExecutor/entryPrepare.ts`,
  `worker/src/tradeExecutor/signalBrokerDispatchClaim.ts` (+test), `collapseIdenticalLegs.test.ts`,
  `singleStyleHardBlock.test.ts`, `manualPlanner.test.ts`.
- **Conflict:** Yes — planMultiManualOrders.ts, signalBrokerDispatchClaim.ts, TradeExecutor.ts (§5.3).

### 8e8f9504 — feat: Telegram channel management + error handling
- **Who:** Osodi (08-05)
- **Problem:** Channel upserts had no plan-limit enforcement and poor error feedback; channel toggling
  failures left the UI in a stale state.
- **Why:** New `upsert-telegram-channel` edge function (217 lines) enforces plan limits; new
  `telegramChannelIdentity.ts` + `telegramChannelApi.ts`; ChannelsPage/CopierEnginePage/ChannelSelectStep
  now surface limit errors and refresh subscriptions; migrations
  `20260805120000_fix_signal_reconcile_sweep_cron_vault.sql` and
  `20260805130000_enforce_plan_broker_channel_limits.sql`.
- **Files:** `src/context/BrokerAccountsContext.tsx`, `src/context/SubscriptionContext.tsx`,
  `src/lib/telegramChannelApi.ts`, `src/pages/dashboard/ChannelsPage.tsx`, `CopierEnginePage.tsx`,
  `onboarding/steps/ChannelSelectStep.tsx`, `supabase/config.toml`, `_shared/subscriptionAccess.ts`,
  `_shared/telegramChannelIdentity.ts`, `fxsocket-broker/index.ts`, `signal-reconcile-sweep/index.ts`,
  `upsert-telegram-channel/index.ts`, 2 migrations.

### 072ab533 — fix: Telegram channel upsert error handling
- **Who:** Osodi (08-05)
- **Problem:** Users who were already over the plan limit (channels created before enforcement) could not
  self-heal; the upsert error was confusing.
- **Why:** Adds `scripts/purgeUserOverLimitAccounts.ts` — recovery script to purge accounts over plan
  limits; clearer limit-violation messaging in the upsert path.
- **Files:** `scripts/purgeUserOverLimitAccounts.ts`.

### 850dfc2d — feat: Stripe subscription reconciliation + entitlement management
- **Who:** Osodi (08-05)
- **Problem:** Entitlement drift: multiple subscriptions per customer could overwrite each other, a lower
  tier could overwrite a higher one, and users kept entitlements after cancel/non-payment. `signal-reconcile-sweep`
  cron was also misconfigured (secrets not in vault → sweep failing silently).
- **Why:** New `reconcile-stripe-entitlement` edge function picks the best active subscription per customer;
  Stripe webhook keeps local entitlement consistent across subscriptions; checkout-session prevents stacking
  Basic on top of Advanced; `signal-reconcile-sweep` cron fixed to use Vault secrets. Adds `stripeEntitlementPick`
  (tested), `docs/stripe-setup.md`.
- **Files:** `supabase/functions/reconcile-stripe-entitlement/index.ts` (new, 106 lines),
  `supabase/functions/stripe-webhook/index.ts` (+159), `create-checkout-session/index.ts`,
  `supabase/functions/_shared/stripeSubscriptionSync.ts`, `docs/stripe-setup.md`,
  `scripts/restore_ramandeep_channels.sql`, migration `20260805120000_fix_signal_reconcile_sweep_cron_vault.sql`.

---

## 5. Conflicts and resolutions (full detail)

### 5.1 dev merge (`b64aa7c2`) — 3 conflicts

| File | Our side (HEAD) | Upstream side (dev) | Why each side changed | Resolution |
|---|---|---|---|---|
| `docs/PROJECT_MEMORY.md` | Cumulative changelog through 08-05 (superset, includes incident docs) | Stale through 07-31 | Both sides append changelog entries | Took **ours** (no info lost; dev entries were subsumed) |
| `src/pages/dashboard/AccountConfigPage.tsx` | `(configAccount.manual_settings ?? {}) as ManualSettings` cast (our `eb6f041f`-equivalent) | `normalizeManualSettings(..., { accountBalance })` + `layering_optimization_strategy` defaulting | Our cast was a quick fix; dev's normalize does full validation + defaults | Took **dev** (newer constraint-based sizing; supersedes the cast) |
| `supabase/functions/update-layering-settings/index.ts` | Fail-closed gates: global `LAYERING_MODES_EXECUTION_ENABLED`, `KILL_SWITCH`, per-mode flags | Flags removed (feature GA) | We kept flags for safety; dev intentionally GA'd | Took **ours** initially — REVISITED in staging merge (5.2) |

### 5.2 staging merge (`3cbfa628`) — 4 conflicts

| File | Our side (HEAD) | Upstream side (staging) | Why each side changed | Resolution |
|---|---|---|---|---|
| `docs/PROJECT_MEMORY.md` | Cumulative changelog through 08-05 | Staging-specific notes through 08-02 | Both sides append changelog | Took **ours** (superset) |
| `supabase/functions/update-layering-settings/index.ts` | Fail-closed kill-switch + per-mode flags | Flags removed (deliberate GA, documented in upstream 08-02 changelog) | GA decision | Took **staging** (user-approved: "Accept upstream GA"). `configurationAllowed = advancedAllowed && listed` |
| `worker/src/tradeExecutor/TradeExecutor.ts` | Interim incident fix: revision reuses existing claim + `execution_claim_reused` event (our `26e09770`) | Complete fix: `blockNewEntry` + SL/TP-only revision refresh + poll-for-materialization (5s) + wait for in-flight first entry (60s) | Both fix the same trade-duplication bug, different mechanisms | Took **staging** (more robust, upstream-merged, already running on staging) |
| `worker/src/tradeExecutor/entryPrepare.ts` | `sameSignalRefresh` declared early (line 311) with hard early-return on revisions | Declares `sameSignalRefresh` + `blockNewEntry` before basket-refresh block | Both touched the same revision-routing region | **Hybrid:** kept our early `sameSignalRefresh` (line 311), took staging's `blockNewEntry` declaration only (avoiding duplicate declaration) |

### 5.3 main merge (`91afd9ba`) — 3 conflicts

| File | Our side (HEAD) | Upstream side (main) | Why each side changed | Resolution |
|---|---|---|---|---|
| `worker/src/manualPlanning/planMultiManualOrders.ts` | Older burst-cap logic (`burstCap = immediateLegs` default) | Newer: teaser/no-TP handling block + burst-cap refactor (defaults `ABS_MAX_LEGS`) | Main shipped the teaser/no-TP oversize fix to prod | Took **main** (newer production code) |
| `worker/src/tradeExecutor/signalBrokerDispatchClaim.ts` | Fail-closed doc + `return false` on uncertain claim (from our incident fix) | Adds `dispatch_claim_error` row to `trade_execution_logs` on claim-insert failure + exports `isDuplicateKeyError` | Ours: fail-closed safety; theirs: observability | **Combined:** kept our fail-closed doc/behavior + their error logging + export |
| `worker/src/tradeExecutor/TradeExecutor.ts` | Staging's complete incident fix (`blockNewEntry`) | Older unconditional `manualDispatchAlreadyMaterialized` probe at top of `sendOrder` | Main's probe predates the duplication fix | Took **ours** (staging's fix supersedes main's older probe) |

### 5.4 Post-merge type fix (worker) — `7a4e0ded`

After all merges, `worker/src/tradeExecutor/entryPrepare.ts` failed `tsc`:
`Property 'success' does not exist on type 'MergeOutcome'` at our early-return block (§5.2 hybrid).
`MergeOutcome` is a discriminated union `{ handled: false } | { handled: true; success: boolean }`.
Staging's later block narrows `handled` first; ours accessed `.success` directly.
Fixed to `openedOrMerged: paramOutcome.handled === true && paramOutcome.success === true`.

---

## 6. The incident-fix comparison (why staging's fix won)

Both sides fixed the trade-duplication bug (signal re-executed up to 75× on revision path because the
dispatch claim was skipped). See `docs/incident-2026-08-04-trade-duplication.md`.

| Aspect | Our interim fix | Upstream/staging fix (chosen) |
|---|---|---|
| Mechanism | Reuse existing dispatch claim on revision | `blockNewEntry` threaded into `runRangeEntry`/`runSingleEntry` |
| New-orders prevention | Indirect (claim reuse) | Structural — revision cannot place new orders by construction |
| Claim-lost race | Not handled | Polls 5s for materialization, then SL/TP-only refresh |
| In-flight first entry | Not handled | Waits up to 60s |
| New helpers | `revisionIdempotency.test.ts` | `messageRevisionEntryGuard.ts`, `rangePendingPriceRemap.ts`, `brokerPendingOpenedDedupe.ts` |
| Status | Interim, not upstream-approved | Upstream-merged, already running on staging |

Note: our `execution_claim_reused` pipeline-event name remains in `worker/src/pipelineTimestamps.ts`
but is no longer emitted by the chosen fix (harmless; kept for schema compatibility).

---

## 7. Our local work preserved on the backup branch

`backup/all-local-work-2026-08-05` = 48 commits ahead of `upstream/main`. Highlights:

| Commit | What it was | Relationship to upstream |
|---|---|---|
| `26e09770` fix(worker): unconditional claim on revision path + amend-only merge routing | Our interim trade-duplication fix + 22 files of docs/migrations/tests | **Superseded** by staging's `blockNewEntry` fix in TradeExecutor/entryPrepare; our fail-closed `claimSignalBrokerDispatch` behavior was kept |
| `05b05961` fix(worker): TelegramSessionInvalidError crash | Same root cause as main's `df5180d8` | Both fixed independently; auto-merged (identical in spirit) |
| `c56cb7cb` docs: incident report 2026-07-31 listener crash-loop | Documentation | Kept |
| Layering foundation commits (`bc41de43`, `bd53c474`, `f41762b6`, `405e22fb`, `40e72fb3`) | Our own layering-modes work | Partially superseded by dev's constraint-based sizing (`c6f12703`); our AccountConfigPage layering UI merged with theirs |
| Popular Channels / Discover feature (9 commits) | Search/sort/filter UI for PopularChannelsPage | No upstream counterpart — fully kept |
| `delete_pendings` support (`873be370`) | Our own `delete_pendings` intent support | Same feature as staging's `0234b975` — both kept, auto-merged into different files (worker intent mapping vs staging's AI prompt) |
| Auth/lease/reconnect fixes (`a4271891`, `d9128a36`, `8e4ac087`, `b3f3baf2`) | Listener lease + AUTH_KEY_DUPLICATED cooldown | No upstream counterpart — fully kept |
| `a383cf5a` fail-closed Sentry monitoring | Worker Sentry hardening | Extended by dev's `c00387fe` business events |
| `eeff68a7` httpServer debug logging + `88482b46` docs | Telegram auth endpoint debugging | No upstream counterpart — kept |
| Docs: `incident-2026-08-04-trade-duplication.md`/`.pdf`, `verification-luis-2026-08-04-duplicates.*`, `staging-environment.md`, etc. | Incident + env documentation | Kept |
| Migrations: `20260724120000_signals_pipeline_ts.sql` (2 lines), `20260805000000_trades_idempotency_guard.sql` (51 lines) | Pipeline timestamps + trade idempotency guard | Kept |

Nothing from the backup branch was lost — 0 commits are missing from `integrate/upstream-sync`.

---

## 8. Items deliberately NOT merged / excluded

- **`worker/dist/**` build artifacts** — `0234b975` and other staging commits committed compiled `.js` files.
  These were **stashed** (`stash: "build artifacts dist/worker-dist (2026-08-05)"`) and excluded from merges,
  per user instruction. Dirty `worker/dist` working-tree changes are **still uncommitted** on
  `integrate/upstream-sync` right now.
- **Our `execution_claim_reused` approach** was superseded by staging's `blockNewEntry` — no code was deleted,
  it just isn't the active path anymore. Our `signalBrokerDispatchClaim` fail-closed `return false` was kept.

---

## 9. Problems solved — regression-risk map

| Change | Problem it solves | Regression risk if wrong |
|---|---|---|
| `d98d00c1` allowlist fix | Empty allowlist must not lock everyone out | Locking out all layering accounts |
| `c6f12703` constraint sizing | Layering must size by account constraints, not fixed lots | Wrong lot sizes / account overexposure |
| `befda34d` blockNewEntry | **Trade duplication**: revision re-dispatch opened a second basket | Duplicate trades (the 08-04 incident) |
| `1184ec42` brokerPendingOpenedDedupe | Broker-pending steps double-opened after reconnect | Duplicate pending orders |
| `5e4b57e2`/`6d9b2d8a`/`245e91e3`/`2f94682e` broker pending fills | Broker-pending positions not detected / stops not set after partial fills | Stops missing on real positions, naked fills |
| `99aaaf42` pip 0.1 + dev `2b82ee78` restore | XAUUSD pip size consistency | SL/TP offsets off by 10× |
| `e785c798` teaser/no-TP planner | Null-TP signals burst-split into N full-lot clones | Oversize orders on teaser signals |
| `850dfc2d` Stripe reconciliation | Subscription drift: users kept entitlements after cancel/non-payment | Free accounts keeping paid features |
| `8e8f9504` Telegram channel limits | Channels created beyond plan limits; no enforcement | Plan-limit bypass |
| `df5180d8`/`2b82ee78` listener | `TelegramSessionInvalidError` crash-loop | Listener down = missed trades |
| `c00387fe` Sentry business events | No visibility into business-level failures | Silent failures in prod |
| `064e856d`/`d93bc07f` auto step | Hand-set step pips that don't fill range distance | Overlapping/oversized pending orders |

---

## 10. Open verification items (regression audit)

### Completed (verified on HEAD during pre-push audit)

1. ✅ **Worker typecheck** — `npx tsc -b worker/tsconfig.json` exit 0 (incl. entryPrepare `MergeOutcome` fix, §5.4).
2. ✅ **Planner suite** — `manualPlanner.test.ts` **84/84 pass** on HEAD. This exposed and confirmed the
   main-merge regression (was 78/84) — fixed by rebuilding the file from upstream/main + teaser re-insert (§4.5).
3. ✅ **No conflict markers** — `git grep -n '^<<<<<<< '` → 0 results.
4. ✅ **Superset check** — `upstream/{dev,staging,main}` are all ancestors of HEAD (safe fast-forward push).
5. ⚠️ **Broker pending fills** (`brokerPendingFillDetect`, `brokerPendingFillStops`,
   `brokerPendingFillTpRedistribute`, `basketEffectiveStops`) — **hang on HEAD AND on plain
   upstream/staging** (pre-existing upstream test-runner issue, not a merge regression). Isolated runs also
   hang; full worker suite cannot complete. Does not block the push.

---

## 11. Security notes

- No secrets were written to this document or PROJECT_MEMORY.md.
- The layering kill-switch removal is a deliberate GA change from upstream; operators must be aware that
  static/dynamic layering is no longer behind a per-mode flag on this branch.
- The trade-duplication fix is a correctness/security hardening — it prevents runaway order duplication on
  production accounts.
- Stripe reconciliation enforces paid entitlements server-side; the `signal-reconcile-sweep` cron now uses
  Vault secrets (previously misconfigured → silent failures).
