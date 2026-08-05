# Merge Tracking — 2026-08-05: upstream/main + staging + dev integration

Purpose: for every merge performed today, record **what** code was pushed, **who** pushed
it, **where** it conflicted with our local work, **how** each conflict was resolved,
**what problem** each change solves, and the **regression risk** left behind. This is the
reference for auditing regressions after the integration.

Branch under test: `integrate/upstream-sync` (built on `backup/all-local-work-2026-08-05`).

- Merge commits:
  - `b64aa7c2` merge dev
  - `3cbfa628` merge staging
  - `91afd9ba` merge main
  - `13b9171a` docs finalize
- Backup of local work: `backup/all-local-work-2026-08-05` (contains incident fix `26e09770`, 48 local commits).
- All three upstream branches are fully contained in HEAD (`rev-list --count HEAD..upstream/{main,staging,dev}` = 0 each).

---

## 1. Branch topology at start

All three upstream branches had fully diverged — none was an ancestor of another, and all
three diverged from our local work:

```
local fix/reconnect-fix-staging  (48 commits incl. incident fix)
upstream/main    head 850dfc2d   (Stripe reconciliation + Telegram channels + manual-planning)
upstream/staging head 5e4b57e2   (rangeBroker pending fills + layering GA + delete_pendings + pip)
upstream/dev     head 2b82ee78   (layering constraint sizing + Sentry + XAU pip restore)
```

---

## 2. Who pushed what, per branch

### 2.1 upstream/dev (merged first, `b64aa7c2`)

Dev is the integration branch for feature work; PRs land here via admin merge.

| Commit | Author | Date | What it does / problem it fixes |
|---|---|---|---|
| `eb6f041f` fix: cast layering fallback manual settings to ManualSettings type | BZetsu | 07-31 | Fixes type/edge error when `configAccount.manual_settings` is read as raw object; cast to proper `ManualSettings`. |
| `aa3f502b` docs: changelog entry for staging layering type fix | BZetsu | 07-31 | Changelog only. |
| `d98d00c1` fix(layering): empty allowlist means no restriction, not restrict-everyone | BZetsu | 07-31 | Corrects a serious off-by-design bug: an **empty** account allowlist should grant everyone access, not deny everyone. |
| `e8b5dbc4` docs: changelog entry for layering allowlist fix | BZetsu | 07-31 | Changelog only. |
| `99819542` feat(layering): accounconfigpage ui fix | emmydapson | 07-31 | AccountConfigPage UI fix for layering modes + capability gating. |
| `d711f6c6` feat(layering): fixed pr conflict and merge | emmydapson | 07-31 | Conflict fix commit during layering PR. |
| `c6f12703` feat(layering): Implemented the constraint-based layer sizing path | emmydapson | 08-02 | **Core layering feature**: layer sizes derived from account constraints (`layerSizingConstraints.ts`, `adjust_percent` optimization strategy) instead of fixed per-leg lots. |
| `c00387fe` feat(observability): add Sentry business issue reporting | emmydapson | 08-04 | Adds `businessEvents.ts` — structured business-event reporting to Sentry (trade lifecycle events, failures). |
| `2b82ee78` fix(management): restore XAU signal pip precision | emmydapson | 08-04 | **Regression fix for the staging pip change**: restores `signalPipPrice` semantics so metal breakeven offsets use 0.01 price units per pip after staging merged the 0.1 convention. |

Note: `c6f12703`, `99819542`, `d98d00c1`, `eb6f041f` also exist on `upstream/staging`
(merged staging-side via `4a4d2cd4`). Only `c00387fe` and `2b82ee78` are dev-exclusive.

### 2.2 upstream/staging (merged second, `3cbfa628`)

Staging is the validation environment; admins promote feature PRs here. Three work
streams: layering GA (from dev), rangeBroker/broker-pending fills (Osodi), and the
trade-duplication incident fix.

| Commit | Author | Date | What it does / problem it fixes |
|---|---|---|---|
| `377a7238` feat(layering): multi-trade order estimation with signal entry range support | Osodi | 08-03 | Planner uses signal entry range in lot estimation. |
| `ed4d6f5e` feat(layering): normalize sizing strategy to 'adjust_percent' | Osodi | 08-03 | All accounts default to `adjust_percent` strategy. |
| `99aaaf42` fix(pip): XAUUSD pip value 0.01 → 0.1 (trader convention) | Osodi | 08-03 | **Behavior change**: metals pip size changed to match retail trader convention. This is what dev `2b82ee78` later partially reverted in signal management. |
| `63a2d6c2` feat(tests): multi-trade order estimation tests | Osodi | 08-03 | Tests for the planning math. |
| `064e856d` feat(range-layering): auto step functionality | Osodi | 08-03 | New `resolveRangeLayerStepPips.ts`; auto step derivation for range layers. |
| `713953d5` feat(i18n): step mode translations | Osodi | 08-03 | i18n keys for step mode across 10 locales. |
| `d93bc07f` feat(range-layering): minimum auto step pips | Osodi | 08-03 | Enforces minimum step pips; order estimation enhancements. |
| `bb283f54` feat(tests): manual order planning and range layering tests | Osodi | 08-03 | Test expansion. |
| `3e4b2a67` refactor(tradeExecutor): `triggerPriceFor` signature | Osodi | 08-03 | Signature change to drop unused fields (syncs with dev `2b82ee78` test cleanup). |
| `befda34d` feat(tradeExecutor): introduce `blockNewEntry` option | Osodi | 08-03 | **Incident fix**: revision dispatches may refresh SL/TP but must not open a second market/pending basket. Adds `messageRevisionEntryGuard.ts`. |
| `1184ec42` feat(tradeExecutor): broker range pending legs handling + dedupe | Osodi | 08-03 | Adds `brokerPendingOpenedDedupe.ts` (dedupe already-opened broker pending steps) + unique-step migration. |
| `37ec25b8` feat(basket): broker pending orders + new fields | Osodi | 08-03 | `rangeBasketLayeringLock.ts`; broker pending order tracking, field additions. |
| `0234b975` feat(trade): `delete_pendings` action + intent handling | Osodi | 08-03 | New trade intent action; **note: this commit also commits worker/dist build artifacts**. |
| `245e91e3` feat(rangeBroker): filled position resolution + stop assignment | Osodi | 08-03 | `brokerPendingFillStops.ts` — stops for broker-pending fills. |
| `f05d4467` feat(basket): naked fills + reconcile logic | Osodi | 08-03 | `nakedFillStopsPersist.test.ts`; naked-fill handling in `basketSlTpReconcile`, `rangeBasketTpSync`. |
| `2f94682e` feat(rangeBroker): stop assignment for broker pending fills | Osodi | 08-03 | `brokerPendingFillStops.ts` iteration 2. |
| `6d9b2d8a` refactor(rangeBroker): pending fill handling decision logic | Osodi | 08-04 | `brokerPendingFillDetect.ts` — detects broker-pending fills cleanly. |
| `5e4b57e2` feat(rangeBroker): pending stop synchronization | Osodi | 08-04 | `brokerPendingStopsSync.ts` — syncs stops on broker pending positions. |
| `4a4d2cd4` merge upstream/dev into staging (Emma's constraint sizing) | BZetsu | 08-02 | **Layering GA**: brought dev's `c6f12703` + allowlist fix into staging. Conflict: removed kill-switch/flags from `update-layering-settings` (`configurationAllowed`). |

### 2.3 upstream/main (merged third, `91afd9ba`)

Main is production. The commits below were shipped to prod ahead of dev/staging in some
cases (bypassing normal flow), which is why they conflict with our branch state.

| Commit | Author | Date | What it does / problem it fixes |
|---|---|---|---|
| `df5180d8` fix(worker): prevent unhandled TelegramSessionInvalidError crash during reconnect | BZetsu | 07-31 | Listener crash-loop fix (same root cause as our `c56cb7cb` docs + `05b05961`). |
| `e785c798` feat(worker): enhance manual order planning + execution logic | Osodi | 08-05 | `planMultiManualOrders`: **teaser/no-TP → single full-lot order**, no burst-split of null-TP groups. `collapseIdenticalLegs.ts` (dedupe identical immediate legs). `singleStyleHardBlock` logic. |
| `8e8f9504` feat: Telegram channel management + error handling | Osodi | 08-05 | New `upsert-telegram-channel` edge fn, `telegramChannelIdentity.ts`, `telegramChannelApi.ts`; channel upsert error handling; plan broker/channel limits migration. |
| `072ab533` fix: Telegram channel upsert error handling | Osodi | 08-05 | `purgeUserOverLimitAccounts.ts` — recovery script for accounts over plan limits. |
| `850dfc2d` feat: Stripe subscription reconciliation + entitlements | Osodi | 08-05 | `reconcile-stripe-entitlement` edge fn, Stripe subscription sync, entitlement enforcement (`subscriptionAccess.ts`), checkout-session, webhook + cron migration. |

---

## 3. Conflicts and resolutions

### 3.1 dev merge (`b64aa7c2`) — 3 conflicts

| File | Ours (local work) | Dev/theirs | Resolution |
|---|---|---|---|
| `docs/PROJECT_MEMORY.md` | 48-commit cumulative changelog | dev changelog entries | Took **ours** (superset). |
| `src/pages/dashboard/AccountConfigPage.tsx` | Our layering UI work (flag-based selectable modes) | Emma's `normalizeManualSettings(..., { accountBalance })` + `layering_optimization_strategy` defaulting to `adjust_percent` | Took **dev's** normalize + strategy handling (supersedes flag-gating). |
| `supabase/functions/update-layering-settings/index.ts` | Kept fail-closed kill-switch/flags | dev removed flags (GA) | **Initially kept ours** at dev merge; **reverted to GA** at staging merge (see 3.2). |

### 3.2 staging merge (`3cbfa628`) — 4 conflicts

| File | Ours | Staging/theirs | Resolution |
|---|---|---|---|
| `docs/PROJECT_MEMORY.md` | Cumulative changelog | staging changelog entries | Took **ours**. |
| `supabase/functions/update-layering-settings/index.ts` | Fail-closed gates (kill switch, `LAYERING_MODES_EXECUTION_ENABLED`, per-mode flags) | GA — `configurationAllowed = advancedAllowed && listed` only | **Took staging's GA** (user-approved). Flags removed. |
| `worker/src/tradeExecutor/TradeExecutor.ts` | Interim incident fix: unconditional claim on revision path + `execution_claim_reused` | Full incident fix: `blockNewEntry` + SL/TP-only revision refresh + 5s materialization poll + 60s in-flight wait | Took **staging's** complete fix (supersedes ours). |
| `worker/src/tradeExecutor/entryPrepare.ts` | `sameSignalRefresh` early-return block + `signalBrokerDispatchClaim` claim reuse | staging's `blockNewEntry` routing | **Hybrid**: kept our early-return block + took staging's `blockNewEntry` declaration/guard below it. |

### 3.3 main merge (`91afd9ba`) — 3 conflicts

| File | Ours | Main/theirs | Resolution |
|---|---|---|---|
| `worker/src/manualPlanning/planMultiManualOrders.ts` | Our planner (no null-TP special-case) | `e785c798`: teaser/no-TP → single full-lot order; no burst-split of null-TP groups | Took **main's** newer handling. |
| `worker/src/tradeExecutor/signalBrokerDispatchClaim.ts` | Fail-closed `return false` + expanded doc | `e785c798`: exported `isDuplicateKeyError` + best-effort `dispatch_claim_error` log | **Combined**: kept fail-closed `return false` + doc AND added main's `trade_execution_logs` error insert + export. |
| `worker/src/tradeExecutor/TradeExecutor.ts` | Staging's `blockNewEntry` fix (from 3.2) | main's older single `manualDispatchAlreadyMaterialized` probe | Took **ours** (staging fix supersedes main's older probe). |

### 3.4 Post-merge type fix (worker)

After all merges, `worker/src/tradeExecutor/entryPrepare.ts` failed `tsc`:
`Property 'success' does not exist on type 'MergeOutcome'` at our early-return block.
`MergeOutcome` is a discriminated union `{ handled: false } | { handled: true; success: boolean }`.
Staging's later block narrows `handled` first; ours accessed `.success` directly.
Fixed to `openedOrMerged: paramOutcome.handled === true && paramOutcome.success === true`.

---

## 4. Problems each change solves (regression-risk map)

| Change | Problem it solves | Regression risk if wrong |
|---|---|---|
| `d98d00c1` allowlist fix | Empty allowlist must not lock everyone out | Locking out all layering accounts |
| `c6f12703` constraint sizing | Layering must size by account constraints, not fixed lots | Wrong lot sizes / account overexposure |
| `befda34d` blockNewEntry | **Trade duplication**: revision re-dispatch opened a second basket | Duplicate trades (the 08-04 incident) |
| `1184ec42` brokerPendingOpenedDedupe | Broker-pending steps double-opened after reconnect | Duplicate pending orders |
| `5e4b57e2`/`6d9b2d8a`/`245e91e3`/`2f94682e` broker pending fills | Broker-pending positions not detected / stops not set after partial fills | Stops missing on real positions, naked fills |
| `99aaaf42` pip 0.1 + dev `2b82ee78` restore | XAUUSD pip size consistency | SL/TP offsets off by 10× |
| `e785c798` teaser/no-TP planner | Null-TP signals burst-split into N full-lot clones | 10× oversize orders on teaser signals |
| `850dfc2d` Stripe reconciliation | Subscription drift: users kept entitlements after cancel/non-payment | Free accounts keeping paid features |
| `8e8f9504` Telegram channel limits | Channels created beyond plan limits; no enforcement | Plan-limit bypass |
| `df5180d8`/`2b82ee78` listener | `TelegramSessionInvalidError` crash-loop | Listener down = missed trades |
| `c00387fe` Sentry business events | No visibility into business-level failures | Silent failures in prod |

---

## 5. Items deliberately NOT merged / excluded

- **`worker/dist/**` build artifacts** — `0234b975` and other staging commits committed compiled
  `.js` files. These were **stashed** (`stash: "build artifacts dist/worker-dist (2026-08-05)"`)
  and excluded from merges, per user instruction. Dirty `worker/dist` working-tree changes
  are **still uncommitted** on `integrate/upstream-sync` right now.
- **Our `execution_claim_reused` approach** was superseded by staging's `blockNewEntry` — no
  code was deleted, it just isn't the active path anymore. Our `signalBrokerDispatchClaim`
  fail-closed `return false` was kept.

---

## 6. Open verification items (regression audit)

Confirmed safe to test these paths specifically:

1. **Worker typecheck** — currently BLOCKED: last `tsc -b` run timed out (did not complete).
   The entryPrepare fix above is applied but not yet verified.
2. **Trade duplication incident paths**:
   - `layeringModeBrokerPending`, `materializeBrokerRangePendingLegs`
   - `rangePendingPriceRemap`, `messageRevisionEntryGuard`, `brokerPendingOpenedDedupe`
   - `revisionIdempotency` — our test may need updating for the accepted staging fix.
3. **XAU pip precision**: `signalPip.test.ts`, `pipCalculator.test.ts`, `autoManagement.test.ts`.
4. **Layering GA**: `layeringModes.test.ts`, `estimateMultiTradeOrders.test.ts`, `layerSizingConstraints.test.ts`.
5. **Planner teaser/no-TP**: `planMultiManualOrders` tests incl. empty-TP fallback.
6. **Broker pending fills**: `brokerPendingFillDetect.test.ts`, `brokerPendingFillStops.test.ts`,
   `brokerPendingStopsSync.test.ts`, `nakedFillStopsPersist.test.ts`, `brokerPendingFillTpRedistribute.test.ts`,
   `rangePendingLadderSync.test.ts`.
7. **Frontend**: `tsc -b`, lint, vitest (layering UI, i18n, pip).
8. **Edge functions**: `update-layering-settings`, `layering-mode-capabilities`, Stripe set
   (`reconcile-stripe-entitlement`, `stripe-webhook`, `create-checkout-session`), Telegram set
   (`upsert-telegram-channel`).

Run:

```bash
npm run lint
npm run build          # frontend tsc -b + vite build
npm run test:vitest
npm run test:node
npm run test:worker    # npm --prefix worker test
deno test supabase/functions/_shared/<file>.test.ts
```

---

## 7. Stale / needs-update references

- `docs/upstream-integration-2026-08-05.md` — integration audit doc; section 6 (verification
  checklist) and the "expected next" section were written mid-work. This doc is the updated,
  complete reference.
