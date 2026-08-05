# Upstream Integration Audit — 2026-08-05

Purpose: track exactly what was pulled from `upstream/main`, `upstream/staging`, and `upstream/dev`,
what conflicts arose, how each was resolved, and what remains to review/verify. This is the reference
document for auditing the `integrate/upstream-sync` branch before any promotion.

## 1. State before this session

- Working branch: `fix/reconnect-fix-staging` (local, 47 commits ahead of `upstream/main`).
- Uncommitted in the working tree (critical incident fixes NOT in any branch):
  - `worker/src/tradeExecutor/TradeExecutor.ts` — revision claim reuse fix
  - `worker/src/tradeExecutor/basketMerge/mergeRouting.ts` — amend-only merge routing
  - `worker/src/tradeExecutor/entryPrepare.ts` — revision route-to-modify-only
  - `worker/src/tradeExecutor/signalBrokerDispatchClaim.ts` — claim reuse on revision
  - `worker/src/pipelineTimestamps.ts` — new `execution_claim_reused` event name
  - `docs/PROJECT_MEMORY.md` — cumulative changelog through 2026-08-05
  - New files: `worker/src/logger.ts`, `worker/src/tradeExecutor/revisionIdempotency.test.ts`,
    `worker/scripts/post-test-signals.ts`, 2 migrations, multiple docs/PDFs
- Dirty build artifacts: `dist/` and `worker/dist/` were rebuilt locally (tracked in git).
- Local `dev`/`staging`/`main` refs were stale (behind upstream).

## 2. What was pulled (the three upstream branches)

Fetched: `upstream/dev`, `upstream/staging`, `upstream/main`. All three had diverged from each other
(none was an ancestor of another) and from local work.

### upstream/dev (11 commits not in local HEAD)
- `2b82ee78` fix(management): restore XAU signal pip precision
- `c00387fe` feat(observability): add Sentry business issue reporting
- `511cfc0e` / `c6f12703` / `907b17ae` / `d711f6c6` / `99819542` layering: constraint-based layer sizing
  (PRs #66, #69)
- `e8b5dbc4` / `aa3f502b` changelog entries
- `d98d00c1` fix(layering): empty allowlist = no restriction
- `eb6f041f` fix: cast layering fallback manual settings to ManualSettings

New files: `worker/src/manualPlanning/layerSizingConstraints.ts` (+test), `worker/src/observability/businessEvents.ts` (+test),
`docs/sentry-business-observability.md`.

### upstream/staging (41 commits not in local HEAD; 32 after the dev merge)
Primary themes (rangeBroker work stream):
- `5e4b57e2` / `6d9b2d8a` / `2f94682e` / `245e91e3` — broker pending stop synchronization
- `f05d4467` / `37ec25b8` — basket naked-fill reconciliation, broker pending handling
- `0234b975` — `delete_pendings` action + intent handling
- `1184ec42` / `befda34d` — broker range pending legs handling, `blockNewEntry` option
- `3e4b2a67` — triggerPriceFor signature change
- `d93bc07f` / `064e856d` — auto step pips, range step handling
- `99aaaf42` — XAUUSD pip value fix
- Layering refinement + tests across `worker/src/tradeExecutor/*`

New files (32): `messageRevisionEntryGuard.ts` (+test), `rangePendingPriceRemap.ts` (+test),
`brokerPendingOpenedDedupe.ts` (+test), `rangePendingFireGuard.ts` (+test), `rangePendingLadderSync.ts` (+test),
`rangePendingLegDelete.ts` rewrite, `virtualPendingMaterialize.ts`, etc.
Migrations: `20260803120000_range_pending_broker_pending_unique_step.sql`.

### upstream/main (6 commits not in local HEAD)
- `850dfc2d` feat: Stripe subscription reconciliation and entitlement management
- `072ab533` / `8e8f9504` — Telegram channel upsert + error handling
- `e785c798` feat(worker): manual order planning and execution logic
- `ede00c4f` (merge PR #67) + `df5180d8` — listener-crash reconnect fix (same fix as our `05b05961`)

New files: `supabase/functions/reconcile-stripe-entitlement/index.ts`,
`supabase/functions/upsert-telegram-channel/index.ts` (217 lines), `src/lib/telegramChannelApi.ts`,
`src/lib/stripeEntitlementPick.test.ts`, `scripts/purgeUserOverLimitAccounts.ts`,
2 migrations (`20260805120000_fix_signal_reconcile_sweep_cron_vault.sql`,
`20260805130000_enforce_plan_broker_channel_limits.sql`).

## 3. What was done with local work

1. Created backup branch `backup/all-local-work-2026-08-05` from `fix/reconnect-fix-staging`.
2. Committed the uncommitted incident fix as `26e09770` (22 files, +2540/−46).
3. Pushed backup branch to `origin` (https://github.com/BZetsu/TScopier branch `backup/all-local-work-2026-08-05`).
4. Stashed the dirty `dist/` + `worker/dist/` build artifacts (stash "build artifacts dist/worker-dist (2026-08-05)") so merges start clean.
5. Fast-forwarded local `dev` → `upstream/dev` (`2b82ee78`).
6. Created integration branch `integrate/upstream-sync` from the backup branch.
7. Merged `upstream/dev` → `integrate/upstream-sync` (commit `b64aa7c2`).
8. Merged `upstream/staging` → `integrate/upstream-sync` (IN PROGRESS — staged, not committed).
9. `upstream/main` merge → still pending.

## 4. Conflicts and resolutions

### 4.1 dev merge (commit b64aa7c2) — 3 conflicts

| File | Our side (HEAD) | Upstream side (dev) | Resolution |
|---|---|---|---|
| `docs/PROJECT_MEMORY.md` | Cumulative changelog through 08-05 (superset) | Stale (through 07-31) | Took **ours** (no info lost) |
| `src/pages/dashboard/AccountConfigPage.tsx` | `(configAccount.manual_settings ?? {}) as ManualSettings` cast | `normalizeManualSettings(..., { accountBalance })` | Took **dev** (newer constraint-based sizing) |
| `supabase/functions/update-layering-settings/index.ts` | Fail-closed gates: global `LAYERING_MODES_EXECUTION_ENABLED`, `KILL_SWITCH`, per-mode flags | Flags removed (feature GA) | Took **ours** initially — REVISITED in staging merge (see 4.2) |

### 4.2 staging merge (in progress) — 4 conflicts

| File | Our side (HEAD) | Upstream side (staging) | Resolution |
|---|---|---|---|
| `docs/PROJECT_MEMORY.md` | Cumulative changelog through 08-05 | Staging-specific notes through 08-02 | Took **ours** (superset) |
| `supabase/functions/update-layering-settings/index.ts` | Fail-closed kill-switch + per-mode flags | Flags removed (deliberate GA, documented in upstream 08-02 changelog) | Took **staging** (user-approved: "Accept upstream GA") |
| `worker/src/tradeExecutor/TradeExecutor.ts` | Interim incident fix: revision reuses existing claim + `execution_claim_reused` event | Complete fix: `blockNewEntry` + SL/TP-only revision refresh + poll-for-materialization (5s) + wait for in-flight first entry (60s) | Took **staging** (more robust, upstream-approved) |
| `worker/src/tradeExecutor/entryPrepare.ts` | `sameSignalRefresh` declared early (line 311) with hard early-return on revisions | Declares `sameSignalRefresh` + `blockNewEntry` before basket-refresh block | **Hybrid:** kept our early `sameSignalRefresh` (line 311), took staging's `blockNewEntry` declaration only (avoiding duplicate declaration) |

## 5. The incident-fix comparison (why staging's fix won)

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

## 6. Audit checklist (to review before any promotion)

- [ ] Verify the merged `TradeExecutor.ts` `sendOrder` block (lines ~1426–1600) end-to-end:
  - [ ] Revision waits for in-flight entry (60s), never opens second basket
  - [ ] `blockNewEntry` propagated into `effectiveSendOpts`
  - [ ] Claim-lost revision → 5s poll → SL/TP-only refresh via `revisionOnlyOpts`
  - [ ] Non-revision path still takes/emits `execution_claimed`
- [ ] Confirm `entryPrepare.ts` has no duplicate `sameSignalRefresh` declaration (line 311 + conflict site) — TS compile.
- [ ] Confirm `update-layering-settings` no longer reads `LAYERING_*` flags; layering gated by allowlist + advanced plan only.
- [ ] Check whether `LAYERING_*` env vars/secrets are still set anywhere (now ignored) — decide whether to clean up.
- [ ] Confirm `AccountConfigPage.tsx` uses `normalizeManualSettings(..., { accountBalance })` for fallback manual.
- [ ] Run worker typecheck + unit tests (especially `layeringModeBrokerPending`, `materializeBrokerRangePendingLegs`, `rangePendingPriceRemap`, `messageRevisionEntryGuard`, `brokerPendingOpenedDedupe`, `revisionIdempotency`).
- [ ] Run frontend `tsc -b`, `npm run lint`, vitest + node:test.
- [ ] Run `npm run test:worker`.
- [ ] Deno test edge-function shared libs (pip calculator etc.).
- [ ] Review `supabase/functions/update-layering-settings/index.ts` final merged content.
- [ ] Review both new migrations from main (`fix_signal_reconcile_sweep_cron_vault`,
      `enforce_plan_broker_channel_limits`) and the staging migration (`range_pending_broker_pending_unique_step`).
- [ ] Confirm no `<<<<<<<` / `>>>>>>>` markers anywhere (`git grep -n '^<<<<<<< '`).
- [ ] After all 3 merges committed: `git diff` against each `upstream/*` to confirm nothing was dropped
      (`git diff backup/all-local-work-2026-08-05..integrate/upstream-sync` should contain only upstream additions).

## 7. Files involved

- Branches: `backup/all-local-work-2026-08-05`, `integrate/upstream-sync`, `dev`
- Merged commits: `b64aa7c2` (dev), staging merge (pending), main merge (pending)
- Incident fix commit: `26e09770`
- Key resolved files: `worker/src/tradeExecutor/TradeExecutor.ts`, `worker/src/tradeExecutor/entryPrepare.ts`,
  `supabase/functions/update-layering-settings/index.ts`, `src/pages/dashboard/AccountConfigPage.tsx`, `docs/PROJECT_MEMORY.md`

## 8. What is expected to happen next

1. Commit the staged staging merge.
2. Merge `upstream/main` (Stripe/Telegram/manual-planning) into `integrate/upstream-sync`; resolve conflicts.
3. Run the full audit checklist (§6).
4. Update `docs/PROJECT_MEMORY.md` with this session.
5. Push `integrate/upstream-sync` to origin; open PR against `upstream/dev` for admin review, or keep local per admin preference.

## 9. Security notes

- No secrets were written to this document or PROJECT_MEMORY.md.
- The layering kill-switch removal is a deliberate GA change from upstream; operators must be aware
  that static/dynamic layering is no longer behind a per-mode flag on this branch.
- The trade-duplication fix is a correctness/security hardening — it prevents runaway order duplication on production accounts.
